// F-13 — the local-backup plumbing, tested without a browser.
//
//   node --test tests/
//
// Uses Node's built-in test runner so this needs no new dependency. The module is plain ESM and
// only touches window/indexedDB/localStorage INSIDE functions, so it imports cleanly here and the
// few globals it needs are stubbed per test.
//
// What is deliberately NOT tested here: showDirectoryPicker and the IndexedDB round trip. Both are
// browser APIs with no faithful Node stand-in, and a fake that merely agreed with my own
// assumptions would prove nothing. Those are covered by the manual browser checks in
// TESTING_GUIDE.md. What IS tested is everything that can be got wrong in pure logic: the
// staleness arithmetic, and the write path's error taxonomy — the part that decides whether a
// failure is reported honestly or silently looks like success.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isSupported, istDayOf, ranToday, lastRunLabel, getLastRun, setLastRunNow,
  writeBackup, checkPermission, requestPermission, LocalBackupError, BACKUP_FILENAME
} from '../src/localBackup.js';

// ── stubs ───────────────────────────────────────────────────────────────────
function withLocalStorage(impl) {
  const prev = globalThis.localStorage;
  globalThis.localStorage = impl;
  return () => { globalThis.localStorage = prev; };
}
const memoryStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k)
  };
};

// A directory handle just real enough to exercise the write path.
function fakeDir(opts = {}) {
  const state = { written: null, closed: false, aborted: false, created: [] };
  return {
    state,
    name: 'Backups',
    async queryPermission() { return opts.permission || 'granted'; },
    async requestPermission() { return opts.requestResult || 'granted'; },
    async getFileHandle(name, options) {
      state.created.push({ name, options });
      if (opts.getFileHandleError) throw opts.getFileHandleError;
      return {
        async createWritable() {
          if (opts.createWritableError) throw opts.createWritableError;
          return {
            async write(blob) {
              if (opts.writeError) throw opts.writeError;
              state.written = blob;
            },
            async close() {
              if (opts.closeError) throw opts.closeError;
              state.closed = true;
            },
            async abort() { state.aborted = true; }
          };
        }
      };
    }
  };
}
const err = (name) => Object.assign(new Error(name), { name });

// ── feature detection ───────────────────────────────────────────────────────
test('isSupported is false without showDirectoryPicker (Firefox, Safari)', () => {
  const prev = globalThis.window;
  globalThis.window = {};
  assert.equal(isSupported(), false);
  globalThis.window = { showDirectoryPicker: () => {} };
  assert.equal(isSupported(), true);
  globalThis.window = prev;
});

// ── "has it run today?" ─────────────────────────────────────────────────────
test('the day boundary is IST, not UTC', () => {
  // 00:20 IST on 30 Aug is 18:50Z on the 29th. Using the UTC day would call that "yesterday" and
  // nag for a backup that had just run — the same class of bug as the Transaction History filter.
  assert.equal(istDayOf(new Date('2026-08-29T18:50:00.000Z')), '2026-08-30');
  assert.equal(istDayOf(new Date('2026-08-29T18:29:00.000Z')), '2026-08-29');
});

test('ranToday is false when nothing has ever run', () => {
  assert.equal(ranToday(null), false);
});

test('ranToday is true only for a run on the current IST day', () => {
  const now = new Date();
  assert.equal(ranToday(now), true);
  assert.equal(ranToday(new Date(now.getTime() - 36 * 3600 * 1000)), false);
});

test('lastRunLabel reads as staleness, not as a date to subtract', () => {
  assert.equal(lastRunLabel(null), 'never');
  assert.match(lastRunLabel(new Date()), /^today at /);
  const y = new Date(Date.now() - 24 * 3600 * 1000);
  assert.match(lastRunLabel(y), /^(yesterday at |1 days ago)/);
  const old = new Date(Date.now() - 5 * 24 * 3600 * 1000);
  assert.match(lastRunLabel(old), /^\d+ days ago$/);
});

// ── the timestamp ───────────────────────────────────────────────────────────
test('the timestamp round-trips through storage', () => {
  const restore = withLocalStorage(memoryStorage());
  try {
    assert.equal(getLastRun(), null);
    const when = setLastRunNow();
    const read = getLastRun();
    assert.ok(read instanceof Date);
    assert.equal(read.toISOString(), when.toISOString());
    assert.equal(ranToday(read), true);
  } finally { restore(); }
});

test('storage being blocked degrades to "never run", it does not throw', () => {
  const restore = withLocalStorage({
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); }
  });
  try {
    assert.doesNotThrow(() => setLastRunNow());
    assert.equal(getLastRun(), null);        // over-reminds, never falsely reassures
  } finally { restore(); }
});

test('a corrupt stored value is treated as never run', () => {
  const s = memoryStorage();
  s.setItem('cylinderpro:last_local_backup_at', 'not-a-date');
  const restore = withLocalStorage(s);
  try { assert.equal(getLastRun(), null); } finally { restore(); }
});

// ── permission ──────────────────────────────────────────────────────────────
test('a handle with no permission API reports "gone" rather than crashing', async () => {
  assert.equal(await checkPermission(null), 'gone');
  assert.equal(await checkPermission({}), 'gone');
  assert.equal(await requestPermission(null), 'gone');
});

test('a handle that throws on query reports "gone"', async () => {
  const h = { queryPermission() { throw err('NotFoundError'); } };
  assert.equal(await checkPermission(h), 'gone');
});

// ── the write ───────────────────────────────────────────────────────────────
test('a successful write uses the fixed filename and creates it', async () => {
  const dir = fakeDir();
  await writeBackup(dir, 'ZIPBYTES');
  assert.deepEqual(dir.state.created, [{ name: BACKUP_FILENAME, options: { create: true } }]);
  assert.equal(dir.state.written, 'ZIPBYTES');
  assert.equal(dir.state.closed, true);
});

test('the same filename every run, so it overwrites instead of accumulating', async () => {
  const dir = fakeDir();
  await writeBackup(dir, 'FIRST');
  await writeBackup(dir, 'SECOND');
  assert.equal(dir.state.created.length, 2);
  assert.equal(dir.state.created[0].name, dir.state.created[1].name);
  assert.equal(dir.state.written, 'SECOND');
});

test('a missing folder is reported as "gone", naming what happened', async () => {
  const dir = fakeDir({ getFileHandleError: err('NotFoundError') });
  const e = await writeBackup(dir, 'x').catch((x) => x);
  assert.ok(e instanceof LocalBackupError);
  assert.equal(e.kind, 'gone');
  assert.match(e.message, /moved, renamed or deleted/);
});

test('a refused folder is reported as "permission", not as a generic failure', async () => {
  const e = await writeBackup(fakeDir({ getFileHandleError: err('NotAllowedError') }), 'x').catch((x) => x);
  assert.equal(e.kind, 'permission');
});

test('permission withdrawn mid-write is still reported as permission', async () => {
  const e = await writeBackup(fakeDir({ writeError: err('NotAllowedError') }), 'x').catch((x) => x);
  assert.equal(e.kind, 'permission');
});

test('a full disk says so', async () => {
  const e = await writeBackup(fakeDir({ writeError: err('QuotaExceededError') }), 'x').catch((x) => x);
  assert.equal(e.kind, 'space');
  assert.match(e.message, /disk space/);
});

test('a failed write aborts, so a half-file never replaces a good backup', async () => {
  const dir = fakeDir({ writeError: err('QuotaExceededError') });
  await writeBackup(dir, 'x').catch(() => {});
  assert.equal(dir.state.aborted, true);
  assert.equal(dir.state.closed, false);
});

test('a failure at close() is a failure — nothing is committed until close resolves', async () => {
  const dir = fakeDir({ closeError: err('InvalidStateError') });
  const e = await writeBackup(dir, 'x').catch((x) => x);
  assert.ok(e instanceof LocalBackupError);
  assert.equal(dir.state.closed, false);
});

test('every failure is thrown, never swallowed — a caller cannot mistake one for success', async () => {
  for (const opts of [
    { getFileHandleError: err('NotFoundError') },
    { getFileHandleError: err('NotAllowedError') },
    { createWritableError: err('NotAllowedError') },
    { createWritableError: err('InvalidStateError') },
    { writeError: err('QuotaExceededError') },
    { writeError: err('NotAllowedError') },
    { writeError: err('AnythingElse') },
    { closeError: err('InvalidStateError') }
  ]) {
    const e = await writeBackup(fakeDir(opts), 'x').then(() => null, (x) => x);
    assert.ok(e instanceof LocalBackupError, 'expected a LocalBackupError for ' + JSON.stringify(Object.keys(opts)));
    assert.ok(['permission', 'gone', 'space', 'write'].includes(e.kind), 'unknown kind ' + e.kind);
  }
});
