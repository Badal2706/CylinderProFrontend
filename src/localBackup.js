// F-13 — local auto-backup folder.
//
// One-time folder pick, then a click writes the backup ZIP straight into that folder with no save
// dialog. This module owns ONLY the browser plumbing: storing the folder handle, checking its
// permission, and writing a blob into it. It never fetches anything and never decides what a
// backup contains — the server still produces the identical ZIP from GET /profile/backup, and the
// caller hands us the finished blob. That separation is deliberate: if this file is wrong, the
// worst case is a file that does not get written, never a wrong or partial backup.
//
// WHY IndexedDB AND NOT localStorage. A FileSystemDirectoryHandle is not a string. localStorage
// stores strings only, so a handle put there comes back as "[object FileSystemDirectoryHandle]"
// and is useless. IndexedDB stores it by structured clone, which preserves the live handle across
// reloads and even across browser restarts. The timestamp beside it IS a string, so that stays in
// localStorage where it is trivial to read.
//
// CHROME AND EDGE ONLY. Firefox and Safari do not implement showDirectoryPicker. `isSupported()`
// is the single gate; the caller renders nothing at all when it is false, rather than showing a
// button that cannot work.

const DB_NAME = 'cylinderpro-local-backup';
const DB_VERSION = 1;
const STORE = 'handles';
const HANDLE_KEY = 'backup-folder';

// Always the same filename, so each run OVERWRITES in place instead of leaving the user with a
// folder full of dated copies they then have to reason about. The newest backup is the only one.
export const BACKUP_FILENAME = 'cylinderpro-backup.zip';

const LAST_RUN_KEY = 'cylinderpro:last_local_backup_at';

export function isSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

// ─── IndexedDB, kept as small as it can possibly be: one store, one key ──────
function openDb() {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let out;
    try { out = fn(store); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('IndexedDB transaction aborted'));
  });
}

// Every read is best-effort: a browser in private mode, or with site data blocked, throws on
// indexedDB.open. That is a reason to fall back to the manual download button, never to break the
// settings page, so failures resolve to "no folder configured".
export async function loadFolder() {
  if (!isSupported()) return null;
  try {
    const db = await openDb();
    const rec = await tx(db, 'readonly', (s) => s.get(HANDLE_KEY));
    db.close();
    if (!rec || !rec.handle) return null;
    // `name` was stored alongside so the UI can say "Backing up to: Documents" without touching
    // the handle (reading handle.name is cheap, but the stored copy also survives a handle that
    // later fails to resolve, so the error message can still name the folder).
    return { handle: rec.handle, name: rec.name || rec.handle.name || 'the chosen folder' };
  } catch {
    return null;
  }
}

export async function saveFolder(handle) {
  const db = await openDb();
  await tx(db, 'readwrite', (s) => s.put({ handle, name: handle.name, saved_at: new Date().toISOString() }, HANDLE_KEY));
  db.close();
}

export async function clearFolder() {
  try {
    const db = await openDb();
    await tx(db, 'readwrite', (s) => s.delete(HANDLE_KEY));
    db.close();
  } catch { /* nothing stored, or storage unavailable — either way there is no folder now */ }
}

// ─── Permission ─────────────────────────────────────────────────────────────
// 'granted' ready to write | 'prompt' needs a click to re-grant | 'denied' refused
// 'gone' the handle no longer resolves (folder moved/deleted, or storage lost)
export async function checkPermission(handle) {
  if (!handle || typeof handle.queryPermission !== 'function') return 'gone';
  try {
    return await handle.queryPermission({ mode: 'readwrite' });
  } catch {
    return 'gone';
  }
}

// MUST be called from inside a click handler — the browser only grants a permission prompt on a
// user gesture, and an await before this in the same handler can lose that gesture.
export async function requestPermission(handle) {
  if (!handle || typeof handle.requestPermission !== 'function') return 'gone';
  try {
    return await handle.requestPermission({ mode: 'readwrite' });
  } catch {
    return 'gone';
  }
}

export async function pickFolder() {
  // Throws AbortError when the user closes the picker; the caller treats that as "changed my
  // mind", not as a failure worth reporting.
  return window.showDirectoryPicker({ mode: 'readwrite', id: 'cylinderpro-backup' });
}

// ─── The write ──────────────────────────────────────────────────────────────
// Resolves on success; throws a LocalBackupError whose .kind names the failure so the caller can
// show something specific. Never resolves on a partial write: close() is what commits the file,
// and any throw before it leaves the previous backup untouched.
export class LocalBackupError extends Error {
  constructor(kind, message) { super(message); this.name = 'LocalBackupError'; this.kind = kind; }
}

export async function writeBackup(handle, blob) {
  let fileHandle;
  try {
    fileHandle = await handle.getFileHandle(BACKUP_FILENAME, { create: true });
  } catch (e) {
    if (e && e.name === 'NotAllowedError') {
      throw new LocalBackupError('permission', 'Permission to write to that folder was refused.');
    }
    // NotFoundError here means the DIRECTORY is gone, not the file — the file is being created.
    throw new LocalBackupError('gone',
      'That folder could not be opened. It may have been moved, renamed or deleted.');
  }

  let writable;
  try {
    writable = await fileHandle.createWritable();
  } catch (e) {
    if (e && e.name === 'NotAllowedError') {
      throw new LocalBackupError('permission', 'Permission to write to that folder was refused.');
    }
    throw new LocalBackupError('write', 'The backup file could not be opened for writing.');
  }

  try {
    await writable.write(blob);
    await writable.close();          // nothing is committed until this resolves
  } catch (e) {
    // Abort so a half-written file is not left in place of a good previous backup.
    try { await writable.abort(); } catch { /* already closed or gone */ }
    if (e && (e.name === 'QuotaExceededError' || /quota|space/i.test(e.message || ''))) {
      throw new LocalBackupError('space', 'There was not enough free disk space to write the backup.');
    }
    if (e && e.name === 'NotAllowedError') {
      throw new LocalBackupError('permission', 'Permission to write to that folder was withdrawn mid-write.');
    }
    throw new LocalBackupError('write', 'The backup could not be written to that folder.');
  }
}

// ─── "Has it run today?" ────────────────────────────────────────────────────
// Today means the IST calendar day, the same day this whole application means everywhere else
// (R69/R142). Using the browser's local day would put the boundary somewhere else for a user
// travelling, and disagree with every date the reports show.
const IST_OFFSET_MS = 330 * 60 * 1000;
export function istDayOf(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function getLastRun() {
  try {
    const raw = localStorage.getItem(LAST_RUN_KEY);
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }   // storage blocked — treat as "never run", which only over-reminds
}

// Called ONLY after a write has committed. A failed write must never move this forward, or a
// failure would look exactly like a success the next time the page loads.
export function setLastRunNow() {
  const now = new Date();
  try { localStorage.setItem(LAST_RUN_KEY, now.toISOString()); } catch { /* non-fatal */ }
  return now;
}

export function ranToday(lastRun) {
  if (!lastRun) return false;
  return istDayOf(lastRun) === istDayOf(new Date());
}

// "today at 6:42 pm" / "yesterday at 8:10 pm" / "3 days ago" — the staleness is the point, so
// anything older than yesterday is reported in whole days rather than a date the reader has to
// subtract in their head.
export function lastRunLabel(lastRun) {
  if (!lastRun) return 'never';
  const today = istDayOf(new Date());
  const then = istDayOf(lastRun);
  const time = lastRun.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true
  });
  if (then === today) return `today at ${time}`;
  const days = Math.round((Date.parse(today) - Date.parse(then)) / 86400000);
  if (days === 1) return `yesterday at ${time}`;
  return `${days} days ago`;
}
