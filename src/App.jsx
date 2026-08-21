import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { TransactionEntry, StepUpVerificationModal, displayContact } from './components.jsx';
import { CustomerDetail, Payments, CylinderInventory, CylinderAgingReport, TransactionHistory, Reports, PaymentForm, FillingListPage } from './pages.jsx';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

// Gas type -> valid capacities. Single source of truth for every gas/capacity
// dropdown in the UI. Keep in sync with backend config/mongodb.js & seedCylinders.js.
// Fixed display order for gas types in EVERY dropdown; capacities are ascending within each.
export const GAS_CAPACITIES = {
  'Oxygen':            ['1.5 m3', '6 m3', '7 m3', '10 m3'],
  'Nitrogen':          ['1.5 m3', '6 m3', '7 m3', '10 m3'],
  'Argon':             ['7 m3', '10 m3'],
  'CO2':               ['2 KG', '4.5 KG', '6 KG', '9 KG', '15 KG', '18 KG', '22 KG', '30 KG', '45 KG'],
  'Nitrous Oxide':     ['2 KG', '17 m3', '30 KG'],
  'Acetylene':         ['7 m3'],
  'Helium':            ['1.5 m3', '7 m3', '10 m3'],
  'HCL':               ['5 KG', '32 KG'],
  'MIX':               ['7 m3']
};
export const GAS_TYPE_LIST = Object.keys(GAS_CAPACITIES);

// Hydrate the gas → sizes catalog from the backend (Phase 10): the GasCapacity collection is
// the runtime source of truth (user-managed in Profile). The static map above is only the
// pre-hydration fallback. Mutates the exported objects in place so every consumer
// (TransactionEntry, CylinderModal, imports) picks up the live catalog.
export async function loadGasCatalog() {
  try {
    const res = await apiFetch(`${API_URL}/masters/gas-capacities`);
    if (!res.ok) return;
    const map = await res.json();
    if (!map || typeof map !== 'object') return;
    Object.keys(GAS_CAPACITIES).forEach(k => { delete GAS_CAPACITIES[k]; });
    Object.assign(GAS_CAPACITIES, map);
    GAS_TYPE_LIST.length = 0;
    GAS_TYPE_LIST.push(...Object.keys(map));
  } catch { /* keep the static fallback */ }
}

// User-facing label for a transaction direction. DB values stay GIVEN/RECEIVED/SWAP;
// the UI shows Filled/Empty. Single source of truth for the display rename.
export function directionText(d) {
  if (d === 'GIVEN') return 'FILLED';
  if (d === 'RECEIVED') return 'EMPTY';
  if (d === 'TRANSFER') return 'TRANSFER';
  return d; // SWAP (and any other) unchanged
}

// ── Business sites (multi-location cylinder tracking) ──
// Mirrors backend/config/locations.js — keep both in sync manually (same convention as GAS_CAPACITIES).
export const LOCATIONS = ['AT_PLANT_CHANDISAR', 'AT_PALANPUR_OFFICE', 'AT_CHHAPI_OFFICE'];
export const LOCATION_LABELS = {
  AT_PLANT_CHANDISAR: 'Chandisar Plant',
  AT_PALANPUR_OFFICE: 'Palanpur Office',
  AT_CHHAPI_OFFICE: 'Chhapi Office'
};
export function locationText(loc) { return LOCATION_LABELS[loc] || loc || '—'; }

// ─── Active Location — per-browser preference (Phase 32) ───
// The default site for new transactions and location-aware report tabs is now stored PER
// BROWSER in localStorage, not shared on the account. Switching it in one browser never changes
// what any other browser/device defaults to. First visit (no stored value) falls back to
// Chandisar Plant. Everything else on the settings page (Manager Name / Contact / Challan
// Prefix per site) remains shared/global on the account.
const ACTIVE_LOCATION_KEY = 'cylinderpro_active_location';
export function getActiveLocation() {
  try {
    const v = localStorage.getItem(ACTIVE_LOCATION_KEY);
    if (v && LOCATIONS.includes(v)) return v;
  } catch { /* localStorage unavailable */ }
  return 'AT_PLANT_CHANDISAR'; // sensible first-visit default
}
export function setActiveLocation(loc) {
  try { if (LOCATIONS.includes(loc)) localStorage.setItem(ACTIVE_LOCATION_KEY, loc); } catch { /* ignore */ }
}
// Cylinder stock_state display label (IN_STOCK / AT_CUSTOMER).
export function stockStateText(s) { return s === 'AT_CUSTOMER' ? 'At Customer' : 'In Stock'; }
// Full state label for a cylinder document — maintenance is an independent flag that
// displays as its own state even though stock_state stays IN_STOCK underneath.
export function cylinderStateText(c) {
  if (c && c.under_maintenance) return 'Under Maintenance';
  return stockStateText(c && c.stock_state);
}
// GAS_TYPES is the single shared gas-type→capacity constant referenced across the app.
export const GAS_TYPES = GAS_CAPACITIES;
// All distinct capacities across every gas type (for places that need a flat list)
export const ALL_CAPACITIES = [...new Set(Object.values(GAS_CAPACITIES).flat())];

// Sort an array of gas-type objects/names into the canonical display order above.
// `nameOf` extracts the gas-type name from each element (default: identity / .gas_type_name).
export function sortGasTypes(list, nameOf) {
  const order = GAS_TYPE_LIST;
  const key = (g) => {
    const n = nameOf ? nameOf(g) : (typeof g === 'string' ? g : g.gas_type_name);
    const i = order.indexOf(n);
    return i === -1 ? order.length : i; // unknown/legacy names sort last
  };
  return [...(list || [])].sort((a, b) => key(a) - key(b));
}
// Sort capacity labels ascending by their numeric value (keeps mixed units grouped sensibly).
export function sortCapacities(list, labelOf) {
  const num = (s) => parseFloat(String(labelOf ? labelOf(s) : s).replace(/[^0-9.]/g, '')) || 0;
  return [...(list || [])].sort((a, b) => num(a) - num(b));
}

// ─── Date formatting ───
// The business runs on IST, so EVERY date and time in the UI is rendered in Asia/Kolkata
// regardless of the device's own timezone — a phone or laptop set to another zone must never
// show a different day or hour than the plant does. Times are 12-hour with AM/PM.
// Always returns DD/MM/YYYY — do not inline date formatting anywhere else.
export const IST_TZ = 'Asia/Kolkata';
function istParts(dt) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TZ, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  }).formatToParts(dt).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
}
export function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  const p = istParts(dt);
  return `${p.day}/${p.month}/${p.year}`;
}
// "4:53 PM" in IST.
export function formatTime(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  const p = istParts(dt);
  return `${p.hour}:${p.minute} ${String(p.dayPeriod || '').toUpperCase()}`;
}
export function formatDateTime(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${formatDate(d)} ${formatTime(d)}`;
}
// YYYY-MM-DD for <input type="date"> — the IST calendar day, not the UTC one (which is a day
// behind between midnight and 5:30 AM IST).
export function istDateInput(d = new Date()) {
  const p = istParts(new Date(d));
  return `${p.year}-${p.month}-${p.day}`;
}
// HH:MM (24h) for <input type="time"> — IST wall-clock.
export function istTimeInput(d = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TZ, hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(d));
}

// Avatar initials from a name ("Acme Gas Co" -> "AG").
export function initialsOf(name) {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]).join('').toUpperCase() || 'U';
}

// ─── Global toast notifications ───
export function showToast(message, type = 'error') {
  window.dispatchEvent(new CustomEvent('app-toast', { detail: { message, type } }));
}

export function Toaster() {
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    let counter = 0;
    const onToast = (e) => {
      const id = ++counter;
      const t = { id, message: e.detail.message, type: e.detail.type || 'error' };
      setToasts(prev => [...prev, t]);
      setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), 3000);
    };
    window.addEventListener('app-toast', onToast);
    return () => window.removeEventListener('app-toast', onToast);
  }, []);
  if (toasts.length === 0) return null;
  // success=green, error=red, warning/info=amber/blue
  const bg = { error: '#fef2f2', success: '#f0fdf4', warning: '#fffbeb', info: '#eff6ff' };
  const bd = { error: '#fca5a5', success: '#86efac', warning: '#fcd34d', info: '#93c5fd' };
  const fg = { error: '#b91c1c', success: '#15803d', warning: '#b45309', info: '#1d4ed8' };
  return (
    <div style={{position:'fixed', bottom:'1rem', right:'1rem', zIndex:9999, display:'flex', flexDirection:'column', gap:'0.5rem', maxWidth:'360px'}}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: bg[t.type] || bg.error, border: `1px solid ${bd[t.type] || bd.error}`,
          color: fg[t.type] || fg.error, padding:'0.75rem 1rem', borderRadius:'8px',
          boxShadow:'0 4px 12px rgba(0,0,0,0.12)', fontSize:'0.88rem', fontWeight:500
        }}>
          {t.type === 'success' ? '✓ ' : t.type === 'warning' ? '⚠ ' : t.type === 'info' ? 'ℹ ' : '⚠ '}{t.message}
        </div>
      ))}
    </div>
  );
}

// ─── Loading spinner ───
export function Spinner({ label = 'Loading…' }) {
  return (
    <div style={{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'2.5rem', color:'var(--text-muted)'}}>
      <div style={{
        width:'38px', height:'38px', border:'4px solid #e2e8f0', borderTopColor:'#2563eb',
        borderRadius:'50%', animation:'spin 0.8s linear infinite'
      }} />
      <div style={{marginTop:'0.75rem', fontSize:'0.85rem'}}>{label}</div>
    </div>
  );
}

// ─── Friendly empty state ───
export function EmptyState({ icon = '📭', message = 'No records found', hint }) {
  return (
    <div style={{textAlign:'center', padding:'2.5rem 1rem', color:'var(--text-muted)'}}>
      <div style={{fontSize:'2.25rem', marginBottom:'0.5rem'}}>{icon}</div>
      <div style={{fontSize:'0.95rem', fontWeight:500}}>{message}</div>
      {hint && <div style={{fontSize:'0.82rem', marginTop:'0.35rem'}}>{hint}</div>}
    </div>
  );
}

// ─── Modal accessibility: Escape to close, focus trap, restore focus on close ───
export function useModalA11y(onClose) {
  const ref = React.useRef(null);
  useEffect(() => {
    const prevFocus = document.activeElement;
    const el = ref.current;
    const selector = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose && onClose(); return; }
      if (e.key === 'Tab' && el) {
        const f = Array.from(el.querySelectorAll(selector)).filter(n => n.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const tmr = setTimeout(() => {
      if (el) { const f = el.querySelector(selector); if (f) f.focus(); }
    }, 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(tmr);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    };
  }, []);
  return ref;
}

// ─── Shared modal shell: blurred backdrop, click-outside, Escape, focus trap, consistent chrome ───
export function Modal({ title, danger = false, size, onClose, children }) {
  const ref = useModalA11y(onClose);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal-card ${size === 'lg' ? 'modal-lg' : ''} ${size === 'wide' ? 'modal-wide' : ''}`} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className={`modal-header ${danger ? 'danger' : ''}`}>
          <span>{title}</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// ─── Generic confirmation modal (replaces window.confirm) ───
export function ConfirmModal({ title = 'Are you sure?', message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = true, onConfirm, onCancel, loading = false }) {
  const ref = useModalA11y(onCancel);
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card" ref={ref} onClick={(e) => e.stopPropagation()} style={{maxWidth:'420px'}}>
        <div className={`modal-header ${danger ? 'danger' : ''}`}>
          <span>{danger ? '⚠️ ' : ''}{title}</span>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{marginBottom:'1.25rem'}}>{message}</p>
          <div className="btn-group" style={{justifyContent:'flex-end'}}>
            <button className="btn btn-secondary" onClick={onCancel} disabled={loading}>{cancelLabel}</button>
            <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={loading}>
              {loading ? 'Please wait…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── "View All" helper: returns [visibleSlice, hasMore, open, setOpen] ───
// Smart-hide: hasMore is false when the list already fits within `limit`, so callers
// render the full list with no "View All" button.
export function useViewAll(rows, limit) {
  const [open, setOpen] = useState(false);
  const list = Array.isArray(rows) ? rows : [];
  return [list.slice(0, limit), list.length > limit, open, setOpen];
}

// A small inline "View All (N)" trigger button.
export function ViewAllButton({ count, onClick }) {
  return (
    <div style={{textAlign:'center', marginTop:'0.75rem'}}>
      <button className="link-btn" style={{fontSize:'0.85rem'}} onClick={onClick}>
        View All ({count}) →
      </button>
    </div>
  );
}

// ─── Server-side pagination controls ───
export function Pagination({ pagination, onPageChange }) {
  if (!pagination || pagination.totalPages <= 1) return null;
  const { page, totalPages, total, limit } = pagination;
  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  const pages = [];
  const addPage = (n) => { if (!pages.includes(n) && n >= 1 && n <= totalPages) pages.push(n); };
  addPage(1);
  for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) addPage(i);
  addPage(totalPages);
  pages.sort((a, b) => a - b);

  const items = [];
  for (let i = 0; i < pages.length; i++) {
    if (i > 0 && pages[i] - pages[i - 1] > 1) items.push('...');
    items.push(pages[i]);
  }

  return (
    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:'1rem', flexWrap:'wrap', gap:'0.5rem'}}>
      <span style={{fontSize:'0.82rem', color:'var(--text-muted)'}}>
        Showing {start}–{end} of {total}
      </span>
      <div style={{display:'flex', gap:'0.25rem', alignItems:'center'}}>
        <button className="btn btn-secondary" style={{padding:'0.25rem 0.5rem', fontSize:'0.8rem'}}
          disabled={page <= 1} onClick={() => onPageChange(page - 1)}>‹ Prev</button>
        {items.map((item, i) =>
          item === '...'
            ? <span key={`e${i}`} style={{padding:'0 0.25rem', color:'var(--text-muted)'}}>…</span>
            : <button key={item} className={`btn ${item === page ? 'btn-primary' : 'btn-secondary'}`}
                style={{padding:'0.25rem 0.55rem', fontSize:'0.8rem', minWidth:'2rem'}}
                onClick={() => onPageChange(item)}>{item}</button>
        )}
        <button className="btn btn-secondary" style={{padding:'0.25rem 0.5rem', fontSize:'0.8rem'}}
          disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>Next ›</button>
      </div>
    </div>
  );
}

// Debounce hook — delays updating a value until the caller stops changing it.
export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// Fetch every page of a paginated list endpoint and return the full array.
//
// Phase 24: the New Transaction form's cylinder and customer pickers used to request a single
// `?limit=200` page and then filter it in the browser. The server clamps limit to 200, so the
// cylinder picker only ever saw rotational numbers 1–200 out of 2,965 — a cylinder like 7617783
// was IN_STOCK at the right plant and still reported "no matching available cylinders", and 195
// of 395 customers were invisible to the customer picker. Both pickers now get the whole set,
// which keeps their existing client-side filters (and the strict location/stock-state rules
// they encode) working against complete data.
export async function fetchAllPages(baseUrl, { pageSize = 200 } = {}) {
  const join = baseUrl.includes('?') ? '&' : '?';
  const first = await apiFetch(`${baseUrl}${join}page=1&limit=${pageSize}`);
  const { ok, rows, pagination, error } = await readListResponse(first);
  if (!ok) { showToast(error); return []; }
  const totalPages = pagination ? pagination.totalPages : 1;
  if (totalPages <= 1) return rows;

  const rest = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, i) =>
      apiFetch(`${baseUrl}${join}page=${i + 2}&limit=${pageSize}`).then(readListResponse)
    )
  );
  const all = [...rows];
  for (const r of rest) {
    if (!r.ok) { showToast(r.error); break; }
    all.push(...r.rows);
  }
  return all;
}

// ─── Phase 26: prove control of the new inbox before the email is saved ───
// Nothing has been written to the account at this point. Cancelling, failing, or letting the
// code expire leaves the old email — and the existing authenticator — completely untouched.
export function VerifyNewEmailModal({ pending, onCancel, onVerified }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const res = await apiFetch(`${API_URL}/profile/email-change/verify`, {
        method: 'POST',
        body: JSON.stringify({ pending_token: pending.pending_token, code })
      });
      if (!res.ok) { setErr(await apiErrorMessage(res, 'That code did not match.')); return; }
      onVerified(await res.json());
    } finally { setBusy(false); }
  };

  return (
    <Modal title="Verify your new email" onClose={onCancel}>
      <p style={{ marginTop: 0, fontSize: '0.9rem' }}>
        We sent a 6-digit code to <strong>{pending.pending_email}</strong>. Enter it to confirm you
        can receive mail there.
      </p>
      <div className="alert" style={{ fontSize: '0.82rem' }}>
        Your account email has <strong>not</strong> changed yet. If you cancel or the code expires,
        your current email and authenticator stay exactly as they are.
      </div>
      <form onSubmit={submit}>
        <input className="form-control" inputMode="numeric" maxLength={6} placeholder="6-digit code"
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
        {err && <div className="alert alert-danger" style={{ marginTop: '0.5rem' }}>{err}</div>}
        <div className="modal-actions" style={{ marginTop: '0.9rem' }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>
            {busy ? 'Verifying…' : 'Verify and save email'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Phase 25: authenticator rotation after an account email change ───
// Shown immediately after the save. The user's EXISTING authenticator code keeps working the
// whole time — confirming here is what switches it over, so closing this dialog is safe and
// leaves 2FA fully intact (it just re-offers the rotation later).
export function TotpRotationModal({ rotation, onDone }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const confirm = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const res = await apiFetch(`${API_URL}/trusted-people/${rotation.person_id}/totp/rotation/confirm`, {
        method: 'POST', body: JSON.stringify({ code })
      });
      if (!res.ok) { setErr(await apiErrorMessage(res, 'That code did not match.')); return; }
      const data = await res.json();
      showToast(data.message, 'success');
      window.dispatchEvent(new CustomEvent('trusted-people-refresh'));
      onDone();
    } finally { setBusy(false); }
  };

  const later = async () => {
    // Discard the pending secret so a half-finished rotation can't linger. The working secret
    // is untouched, so the user's current authenticator continues to function.
    try {
      await apiFetch(`${API_URL}/trusted-people/${rotation.person_id}/totp/rotation/cancel`, { method: 'POST' });
    } catch {}
    onDone();
  };

  return (
    <Modal title="Update your authenticator" onClose={later}>
      <p style={{ marginTop: 0, fontSize: '0.9rem' }}>
        Your account email is now <strong>{rotation.email}</strong>. Scan this new QR code in your
        authenticator app, then enter a code from it to switch over.
      </p>
      <div style={{ textAlign: 'center', margin: '0.75rem 0' }}>
        <img src={rotation.qr} alt="New authenticator QR code" style={{ width: 190, height: 190 }} />
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', wordBreak: 'break-all', marginTop: '0.4rem' }}>
          Can't scan? Enter this key manually: <code>{rotation.secret}</code>
        </div>
      </div>
      {rotation.had_previous && (
        <div className="alert" style={{ fontSize: '0.82rem' }}>
          Your <strong>existing</strong> authenticator code still works until you confirm below —
          your account is never left without 2FA.
        </div>
      )}
      <form onSubmit={confirm}>
        <input className="form-control" inputMode="numeric" maxLength={6} placeholder="6-digit code"
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
        {err && <div className="alert alert-danger" style={{ marginTop: '0.5rem' }}>{err}</div>}
        <div className="modal-actions" style={{ marginTop: '0.9rem' }}>
          <button type="button" className="btn btn-secondary" onClick={later} disabled={busy}>
            Not now (keep current code)
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>
            {busy ? 'Verifying…' : 'Confirm new authenticator'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Today's date as YYYY-MM-DD in local time (the date filters compare local calendar days).
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Phase 25: the two dashboard charts ───
// Hand-rolled inline SVG rather than a charting library: the bundle is already 936 kB and one
// stacked bar plus one donut is far less code than the smallest chart dependency. Both read
// from /api/dashboard/cylinder-stock, which the dashboard already fetches — no extra request.
const GAS_COLORS = ['#2563EB', '#0891B2', '#7C3AED', '#DB2777', '#EA580C', '#16A34A', '#CA8A04', '#64748B'];

function StackedLocationBar({ byLocationState, onNavigate }) {
  const locs = LOCATIONS.filter(l => byLocationState && byLocationState[l]);
  if (!locs.length) return <EmptyState icon="📍" message="No cylinders to chart yet" />;
  const max = Math.max(...locs.map(l => (byLocationState[l].IN_STOCK || 0) + (byLocationState[l].AT_CUSTOMER || 0)), 1);

  return (
    <div>
      <div style={{ display: 'flex', gap: '1rem', fontSize: '0.78rem', marginBottom: '0.75rem' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#2563EB', borderRadius: 2, marginRight: 5 }} />In Stock</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#F59E0B', borderRadius: 2, marginRight: 5 }} />At Customer</span>
      </div>
      <div style={{ display: 'grid', gap: '0.85rem' }}>
        {locs.map(loc => {
          const inStock = byLocationState[loc].IN_STOCK || 0;
          const atCust = byLocationState[loc].AT_CUSTOMER || 0;
          const total = inStock + atCust;
          return (
            <div key={loc}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                <span>{LOCATION_LABELS[loc]}</span>
                <span style={{ color: 'var(--text-muted)' }}>{total.toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', height: 22, borderRadius: 4, overflow: 'hidden', background: 'var(--bg, #f1f5f9)' }}>
                <div title={`In stock: ${inStock}`} onClick={() => onNavigate('cylinders', { locFilters: [loc], stateFilters: ['IN_STOCK'] })}
                  style={{ width: `${(inStock / max) * 100}%`, background: '#2563EB', cursor: 'pointer' }} />
                <div title={`At customer: ${atCust}`} onClick={() => onNavigate('cylinders', { locFilters: [loc], stateFilters: ['AT_CUSTOMER'] })}
                  style={{ width: `${(atCust / max) * 100}%`, background: '#F59E0B', cursor: 'pointer' }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GasTypeDonut({ byGasType, onNavigate }) {
  const data = (byGasType || []).filter(d => d.count > 0);
  if (!data.length) return <EmptyState icon="⛽" message="No cylinders to chart yet" />;
  const total = data.reduce((s, d) => s + d.count, 0);

  // Donut drawn with stroke-dasharray on concentric circles — no path maths, no library.
  const R = 60, C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width="150" height="150" viewBox="0 0 150 150" role="img" aria-label="Cylinders by gas type">
        <g transform="rotate(-90 75 75)">
          {data.map((d, i) => {
            const len = (d.count / total) * C;
            const el = (
              <circle key={d.gas_type} cx="75" cy="75" r={R} fill="none"
                stroke={GAS_COLORS[i % GAS_COLORS.length]} strokeWidth="26"
                strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset}>
                <title>{`${d.gas_type}: ${d.count} (${((d.count / total) * 100).toFixed(1)}%)`}</title>
              </circle>
            );
            offset += len;
            return el;
          })}
        </g>
        <text x="75" y="71" textAnchor="middle" style={{ fontSize: '1.15rem', fontWeight: 700, fill: 'var(--text)' }}>
          {total.toLocaleString()}
        </text>
        <text x="75" y="88" textAnchor="middle" style={{ fontSize: '0.62rem', fill: 'var(--text-muted)' }}>cylinders</text>
      </svg>
      <div style={{ display: 'grid', gap: '0.3rem', fontSize: '0.8rem', flex: 1, minWidth: 160 }}>
        {data.map((d, i) => (
          <div key={d.gas_type} onClick={() => onNavigate('cylinders', { searchTerm: d.gas_type })}
            style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}
            title={`Show ${d.gas_type} cylinders`}>
            <span>
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 6, background: GAS_COLORS[i % GAS_COLORS.length] }} />
              {d.gas_type}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>
              {d.count.toLocaleString()} · {((d.count / total) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Phase 26: returns the two chart tiles as bare siblings (not wrapped in their own grid) so
// they sit in the SAME bento grid as the KPI tiles. Keeping them in a separate grid was what
// left a dead band between the two sections.
export function DashboardCharts({ stock, onNavigate }) {
  return (
    <>
      <div className="card bento-chart">
        <h2>Cylinders by Location</h2>
        <StackedLocationBar byLocationState={stock?.byLocationState} onNavigate={onNavigate} />
      </div>
      <div className="card bento-chart">
        <h2>Cylinders by Gas Type</h2>
        <GasTypeDonut byGasType={stock?.byGasType} onNavigate={onNavigate} />
      </div>
    </>
  );
}

// ─── Phase 24: initial batch + "View All (N)" + background batch-load ───
// Replaces infinite scroll on the big lists. Loads INITIAL_BATCH rows up front, reports the
// true server-side total, and only fetches the rest when the user asks for it.
//
// Two deliberate choices:
//  * Search/filter is always sent to the server (via buildUrl), never applied to the loaded
//    slice — otherwise searching before "View All" would silently miss most of the dataset.
//  * The background pass re-reads from page 1 at BACKGROUND_BATCH (the server's max limit)
//    rather than continuing at 50. 2,965 cylinders is 60 requests at 50/page, which alone
//    exceeds the 100 req/min limiter; at 200/page it is 15. Rows are appended in the same sort
//    order, so the already-visible rows keep their position and the scrollbar does not jump.
export const INITIAL_BATCH = 50;
const BACKGROUND_BATCH = 200; // server clamps `limit` to 200 (utils/paginate.js)

// Phase 29: an OPTIONAL cap for lists with unbounded growth (Transaction History). When
// `options.cap` is set, "View All" batch-loads only the most recent `cap` records, then stops
// auto-loading; beyond that the caller shows a "Load N more" control wired to `loadMore`, which
// fetches exactly `options.increment` older records per click. When no options are passed the
// behaviour is byte-identical to before — Customers and Cylinder Inventory are unaffected.
export function useBatchList(buildUrl, deps, options = {}) {
  const cap = Number(options.cap) || 0;              // 0 = uncapped (full background batch-load)
  const increment = Number(options.increment) || 100;
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingAll, setLoadingAll] = useState(false);
  const [loadedAll, setLoadedAll] = useState(false);
  const [capReached, setCapReached] = useState(false); // hit `cap` with more still on the server
  const [loadingMore, setLoadingMore] = useState(false);

  const buildRef = useRef(buildUrl);
  buildRef.current = buildUrl;              // always call the latest closure, never a stale one
  const reqRef = useRef(0);                 // guards against out-of-order responses
  const rowsRef = useRef([]);
  rowsRef.current = rows;                   // current length, read inside loadMore without stale closure
  const key = JSON.stringify(deps);

  const loadFirst = useCallback(async () => {
    const reqId = ++reqRef.current;
    setLoading(true); setLoadingAll(false); setLoadedAll(false); setCapReached(false); setLoadingMore(false);
    try {
      const res = await apiFetch(buildRef.current(1, INITIAL_BATCH));
      const { ok, rows: got, pagination, error } = await readListResponse(res);
      if (reqId !== reqRef.current) return;
      if (!ok) { showToast(error); setRows([]); setTotal(0); setLoadedAll(true); }
      else {
        setRows(got);
        setTotal(pagination ? pagination.total : got.length);
        setLoadedAll(!pagination || pagination.total <= got.length);
      }
    } catch (e) {
      console.error('List load failed:', e);
      setRows([]); setLoadedAll(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadFirst(); }, [key, loadFirst]);

  const loadAll = useCallback(async () => {
    const reqId = reqRef.current;           // pin to the filter state we started from
    setLoadingAll(true);
    const acc = [];
    try {
      // Capped lists batch-load only the most recent `cap` rows; uncapped lists load everything.
      const target = cap ? Math.min(total, cap) : total;
      const pages = Math.ceil(target / BACKGROUND_BATCH) || 1;
      for (let p = 1; p <= pages; p++) {
        const res = await apiFetch(buildRef.current(p, BACKGROUND_BATCH));
        const { ok, rows: got, error } = await readListResponse(res);
        if (reqId !== reqRef.current) return; // filters changed mid-load — abandon quietly
        if (!ok) { showToast(error); break; }
        acc.push(...got);
        const capped = cap ? acc.slice(0, cap) : acc;
        setRows([...capped]);               // grow in place; earlier rows keep their index
        if (got.length < BACKGROUND_BATCH) break;
        if (cap && capped.length >= cap) break;
      }
      if (reqId === reqRef.current) {
        const loaded = cap ? Math.min(acc.length, cap) : acc.length;
        // Reached the cap with more still on the server → switch to manual "Load N more".
        if (cap && total > cap && loaded >= cap) setCapReached(true);
        else setLoadedAll(true);
      }
    } catch (e) {
      console.error('Background list load failed:', e);
    }
    if (reqId === reqRef.current) setLoadingAll(false);
  }, [total, cap]);

  // Phase 29: explicit "Load `increment` more" for capped lists — fetches the next block of older
  // records (offset = rows already loaded). `cap` and `increment` are multiples of each other and
  // of the row count, so page math stays exact until the final (possibly short) block.
  const loadMore = useCallback(async () => {
    const reqId = reqRef.current;
    setLoadingMore(true);
    try {
      const offset = rowsRef.current.length;
      const pageNum = Math.floor(offset / increment) + 1;
      const res = await apiFetch(buildRef.current(pageNum, increment));
      const { ok, rows: got, error } = await readListResponse(res);
      if (reqId !== reqRef.current) return;
      if (!ok) { showToast(error); }
      else {
        setRows(prev => [...prev, ...got]);
        if (got.length < increment || offset + got.length >= total) setLoadedAll(true);
      }
    } catch (e) {
      console.error('Load-more failed:', e);
    }
    if (reqId === reqRef.current) setLoadingMore(false);
  }, [increment, total]);

  return { rows, total, loading, loadingAll, loadedAll, loadAll, reload: loadFirst,
           capReached, loadingMore, loadMore, increment };
}

// The "View All (N)" footer for a useBatchList-backed table.
// Phase 29: optional capped-mode props (cap/capReached/onLoadMore/loadingMore/increment). When
// `cap` is 0 (the default) none of the new branches fire and the output is unchanged — so
// Customers and Cylinder Inventory keep their exact "View All → full batch-load" footer.
export function BatchListFooter({ shown, total, loadedAll, loadingAll, onLoadAll, noun = 'records',
                                  cap = 0, capReached = false, onLoadMore, loadingMore = false, increment = 100 }) {
  if (loadingAll) {
    const target = cap ? Math.min(total, cap) : total;
    return <div style={{ textAlign: 'center', padding: '1rem' }}>
      <Spinner label={`Loading ${target.toLocaleString()} ${noun}… (${shown.toLocaleString()} so far)`} />
    </div>;
  }
  if (loadingMore) {
    return <div style={{ textAlign: 'center', padding: '1rem' }}>
      <Spinner label={`Loading ${increment} more…`} />
    </div>;
  }
  // Capped list: most recent `cap` auto-loaded, more remain → manual "Load N more" from here on.
  if (cap && capReached && shown < total) {
    const remaining = total - shown;
    return (
      <div style={{ textAlign: 'center', padding: '1rem' }}>
        <button className="btn btn-secondary" onClick={onLoadMore}>
          Load {Math.min(increment, remaining).toLocaleString()} more →
        </button>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
          Showing {shown.toLocaleString()} of {total.toLocaleString()} (most recent {cap.toLocaleString()} auto-loaded). Search covers all {total.toLocaleString()}.
        </div>
      </div>
    );
  }
  if (loadedAll || shown >= total) {
    return <div style={{ textAlign: 'center', padding: '1rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
      — showing all {shown.toLocaleString()} {noun} —
    </div>;
  }
  return (
    <div style={{ textAlign: 'center', padding: '1rem' }}>
      <button className="btn btn-secondary" onClick={onLoadAll}>
        View All ({total.toLocaleString()}) →
      </button>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
        Showing first {shown.toLocaleString()} of {total.toLocaleString()}. Search covers all {total.toLocaleString()}.
      </div>
    </div>
  );
}

// Infinite scroll sentinel — calls `onLoadMore` when scrolled into view.
export function InfiniteScroll({ hasMore, loading, onLoadMore }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!hasMore || loading) return;
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) onLoadMore();
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loading, onLoadMore]);
  return (
    <div ref={ref} style={{ textAlign: 'center', padding: '1rem' }}>
      {loading && <Spinner label="Loading more…" />}
      {!hasMore && !loading && <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>— End of list —</span>}
    </div>
  );
}

// ─── Focused list modal: full table + contextual search, internal scroll, blurred backdrop ───
// columns: [{ header, cell: (item, index) => node, thProps? }]
// searchKeys: array of strings (item keys) or functions (item => value) to match the query against.
// groupBy: optional (item) => label — inserts a full-width group header row whenever the label
// changes between consecutive rows (used for date grouping). rowTitle: optional (item) => string
// hover tooltip per row (same behavior as the opener page's table).
export function ListModal({ title, items, columns, searchKeys = [], searchPlaceholder = 'Search…', onClose, extraHeader = null, onRowClick = null, initialSearch = '', groupBy = null, rowTitle = null }) {
  const [q, setQ] = useState(initialSearch); // carries over the opener page's search term
  const ref = useModalA11y(onClose);
  const qq = q.trim().toLowerCase();
  const filtered = qq
    ? items.filter(it => searchKeys.some(k => {
        const v = typeof k === 'function' ? k(it) : it[k];
        return String(v == null ? '' : v).toLowerCase().includes(qq);
      }))
    : items;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-lg" ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{title} ({filtered.length})</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body-scroll">
          {searchKeys.length > 0 && (
            <div className="modal-search-sticky">
              <input
                className="form-control"
                placeholder={searchPlaceholder}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          )}
          {extraHeader}
          {filtered.length === 0 ? (
            <EmptyState message="No matching records" />
          ) : (
            <div className="table-container">
              <table>
                <thead><tr>{columns.map((c, i) => <th key={i}>{c.header}</th>)}</tr></thead>
                <tbody>
                  {filtered.map((it, ri) => {
                    const label = groupBy ? groupBy(it) : null;
                    const prevLabel = groupBy && ri > 0 ? groupBy(filtered[ri - 1]) : null;
                    const row = (
                      <tr key={ri}
                        title={rowTitle ? rowTitle(it) : undefined}
                        style={{ ...c_rowStyle(it), ...(onRowClick ? { cursor: 'pointer' } : {}) }}
                        onClick={onRowClick ? () => onRowClick(it) : undefined}>
                        {columns.map((c, ci) => <td key={ci}>{c.cell(it, ri)}</td>)}
                      </tr>
                    );
                    if (groupBy && label !== prevLabel) {
                      return (
                        <React.Fragment key={`g-${ri}`}>
                          <tr>
                            <td colSpan={columns.length} style={{background:'#f1f5f9', fontWeight:700, fontSize:'0.8rem', padding:'0.35rem 0.75rem'}}>
                              📅 {label}
                            </td>
                          </tr>
                          {row}
                        </React.Fragment>
                      );
                    }
                    return row;
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
// Optional row styling hook for ListModal rows (amber for cross-customer returns).
export function c_rowStyle(it) {
  if (it && (it.returned_via || it.returned_on_behalf_of)) return { background: '#fff7ed' };
  return {};
}

// Authenticated fetch — adds Bearer token from localStorage automatically
export async function apiFetch(url, options = {}) {
  const token = localStorage.getItem('authToken');
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(url, { ...options, headers });
  } catch (e) {
    showToast('Network error — is the server running?');
    throw e;
  }
  if (res.status === 401) {
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    window.dispatchEvent(new CustomEvent('auth-logout', {
      detail: { message: 'Your session has expired. Please log in again.' }
    }));
  }
  return res;
}

// Read a JSON error message from a failed response, falling back to a friendly default.
export async function apiErrorMessage(res, fallback = 'Something went wrong. Please try again.') {
  try {
    const data = await res.json();
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

// Read a paginated list endpoint's response safely. Returns rows as an ARRAY always —
// on a non-2xx the body is an error object ({error: "Too many requests…"} for a 429), and
// callers spread the result into their list, so returning it raw throws "x is not iterable"
// and takes the whole page down via the error boundary.
export async function readListResponse(res, fallback = 'Could not load this list. Please try again.') {
  let body = null;
  try { body = await res.json(); } catch { /* empty or non-JSON body */ }
  if (!res.ok) {
    const error = (body && body.error) || (res.status === 429
      ? 'Loading too fast — please wait a moment and try again.'
      : fallback);
    return { ok: false, rows: [], pagination: null, error };
  }
  const rows = Array.isArray(body) ? body
    : (Array.isArray(body && body.data) ? body.data : []);
  return { ok: true, rows, pagination: (body && body.pagination) || null, error: null };
}

// ─── Shared context-aware file-name helpers (print PDFs + Excel/ZIP exports) ───
// Format any date as DD-MM-YYYY for use in file names.
export function fileDateStr(d) {
  const dt = d ? new Date(d) : new Date();
  if (isNaN(dt.getTime())) return fileDateStr(new Date());
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${dt.getFullYear()}`;
}
// Strip filesystem-illegal/special characters from a dynamic part (customer name, bill no),
// then collapse whitespace to underscores.
export function sanitizeNamePart(s) {
  return String(s == null ? '' : s)
    .replace(/[\/\\:*?"<>|]/g, '')        // filesystem-illegal
    .replace(/[^a-zA-Z0-9_\- ]/g, '')      // any other special chars
    .trim()
    .replace(/\s+/g, '_');
}
// Build a context-aware base file name (NO extension). Callers append .xlsx/.zip or use as a print title.
// extras: { customerName, billNo, receiptNo, pageName, date }
export function getExportFileName(context, extras = {}) {
  const day = fileDateStr(extras.date);
  const cust = sanitizeNamePart(extras.customerName);
  const bill = sanitizeNamePart(extras.billNo);
  const rcpt = sanitizeNamePart(extras.receiptNo);
  const BRAND = 'GURUIndustries';
  switch (context) {
    case 'bill':               return `${cust}_${bill}_${day}`;
    case 'receipt':            return `Receipt_${cust}_${rcpt}_${day}`;
    case 'customer-ledger':    return `${cust}_Ledger_${day}`;
    case 'customer-history':   return `${cust}_History_${day}`;
    case 'aging-report':       return `CylinderAgingReport_${day}`;
    case 'outstanding':        return `OutstandingDues_${day}`;
    case 'daily-report':       return `DailyReport_${day}`;
    case 'over-limit':         return `OverLimitReport_${day}`;
    case 'cylinder-stock':     return `CylinderStockReport_${day}`;
    case 'deposit-report':     return `DepositReport_${day}`;
    case 'cylinder-inventory': return `CylinderInventory_${day}`;
    case 'payment-history':    return `PaymentHistory_${day}`;
    case 'transaction-history':return `TransactionHistory_${day}`;
    case 'ledger-report':      return cust ? `${cust}_Ledger_${day}` : `LedgerReport_${day}`;
    case 'data-export-zip':    return `${BRAND}_Export_${day}`;
    default:                   return `${BRAND}_${sanitizeNamePart(extras.pageName) || 'Export'}_${day}`;
  }
}
// Set document.title (browsers use it as the default PDF file name) before printing the CURRENT
// document, then restore it shortly after. For popup-based prints, use the name as the popup <title>.
export function setPrintTitle(name) {
  const original = document.title;
  document.title = name;
  setTimeout(() => { document.title = original; }, 1500);
}

// Excel export helper — uses SheetJS (loaded via CDN). `filename` is the base name (no extension);
// pass getExportFileName(...) for context-aware names.
export function exportToExcel(rows, filename, sheetName) {
  if (!rows || rows.length === 0) { showToast('No data to export', 'info'); return; }
  try {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, (sheetName || 'Data').substring(0, 31));
    XLSX.writeFile(wb, `${filename}.xlsx`);
  } catch (err) {
    console.error('Excel export error:', err);
    showToast('Excel export failed: ' + err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ONE-TIME BULK IMPORT (onboarding)
//
// SINGLE SOURCE OF TRUTH: the blank template and the upload parser both read the
// column list below. Headers written into the template === the keys the parser
// looks up, so the two can NEVER drift. Fill the unmodified template → zero format
// errors. Gas/capacity validation reuses GAS_CAPACITIES (no second hardcoded copy).
// ─────────────────────────────────────────────────────────────────────────────
export const IMPORT_SCHEMAS = {
  customers: {
    label: 'Customers',
    endpoint: 'customers',
    sheet: 'Customers',
    infoSheet: 'Instructions',
    // note = shown in the Instructions sheet; required drives the trailing "*" on the header.
    columns: [
      { key: 'company_name',     required: true,  note: 'Business / customer name.' },
      { key: 'customer_type',    required: false, note: 'REGULAR or ONE_TIME. Blank = REGULAR.' },
      { key: 'contact_person',   required: false, note: 'Primary contact person.' },
      { key: 'phone_primary',    required: true,  note: 'Main phone number.' },
      { key: 'phone_alternate',  required: false, note: 'Telephone / alternate number.' },
      { key: 'address',          required: false, note: 'Street address.' },
      { key: 'gst_number',       required: false, note: 'GSTIN, if any.' },
      { key: 'security_deposit', required: false, note: 'Number ≥ 0. Blank = 0.' },
      { key: 'holding_limit',    required: false, note: 'Number ≥ 0. Blank = 0.' }
    ],
    legend: {
      required: 'company_name, phone_primary',
      optional: 'everything else (customer_type blank = REGULAR; security_deposit/holding_limit blank = 0)'
    },
    // Clearly an example AND auto-skipped if left unmodified (exact match → ignored).
    example: {
      company_name: 'EXAMPLE — Acme Industries (delete this row)',
      customer_type: 'REGULAR',
      contact_person: 'Ramesh Kumar',
      phone_primary: '9876543210',
      phone_alternate: '0265-2345678',
      address: '12 GIDC Estate, Vadodara',
      gst_number: '24ABCDE1234F1Z5',
      security_deposit: 5000,
      holding_limit: 20
    }
  },
  cylinders: {
    label: 'Cylinders',
    endpoint: 'cylinders',
    sheet: 'Cylinders',
    infoSheet: 'Instructions',
    columns: [
      { key: 'rotational_number', required: true,  note: 'Primary unique ID (unique per account).' },
      { key: 'physical_number',   required: false, note: 'Unique per account when provided.' },
      { key: 'gas_type',          required: true,  note: 'Must match a VALID GAS TYPE exactly.' },
      { key: 'capacity',          required: true,  note: 'Must be valid FOR the row’s gas type.' },
      { key: 'location',          required: false, note: 'AT_PLANT_CHANDISAR, AT_PALANPUR_OFFICE or AT_CHHAPI_OFFICE. Blank = AT_PLANT_CHANDISAR.' },
      { key: 'stock_state',       required: false, note: 'IN_STOCK or AT_CUSTOMER. Blank = IN_STOCK.' }
    ],
    legend: {
      required: 'rotational_number, gas_type, capacity',
      optional: 'physical_number, location (blank = AT_PLANT_CHANDISAR), stock_state (blank = IN_STOCK)'
    },
    example: {
      rotational_number: 'EXAMPLE-ROT-001 (delete this row)',
      physical_number: 'PHY-001',
      gas_type: 'Oxygen',
      capacity: '7 m3',
      location: 'AT_PLANT_CHANDISAR',
      stock_state: 'IN_STOCK'
    }
  }
};

// Header text written into the template: required columns get a trailing "*".
export function importHeaderLabel(col) { return col.key + (col.required ? '*' : ''); }

// Normalize a header cell so starred/spaced/cased variants all map to the same field key.
// "Rotational Number", "rotational_number", "rotational_number*" → "rotationalnumber".
export function normalizeHeaderKey(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Case/space-insensitive normalizers (mirror backend/config/gasCapacities.js).
export function normalizeGasTypeFE(name) {
  const k = String(name == null ? '' : name).trim().toLowerCase();
  return GAS_TYPE_LIST.find(g => g.toLowerCase() === k) || null;
}
export function normalizeCapacityFE(gasCanonical, cap) {
  if (!gasCanonical) return null;
  const t = String(cap == null ? '' : cap).trim().toLowerCase().replace(/\s+/g, ' ');
  return (GAS_CAPACITIES[gasCanonical] || []).find(c => c.toLowerCase().replace(/\s+/g, ' ') === t) || null;
}
export function parseNonNegFE(v) {
  const s = String(v == null ? '' : v).trim();
  if (s === '') return { value: 0, ok: true };
  const n = Number(s);
  return (isFinite(n) && n >= 0) ? { value: n, ok: true } : { value: 0, ok: false };
}

// Levenshtein distance (small strings) for fuzzy "did you mean" suggestions.
export function levenshtein(a, b) {
  a = String(a); b = String(b);
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}
// Closest valid gas type to a misspelled input (or null if nothing is close enough).
export function closestGasType(input) {
  const s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  let best = null, bestD = Infinity;
  GAS_TYPE_LIST.forEach(g => {
    const d = levenshtein(s, g.toLowerCase());
    if (d < bestD) { bestD = d; best = g; }
  });
  // Accept as a suggestion only if reasonably close (≤ ~40% of the name length).
  return (best && bestD <= Math.max(2, Math.ceil(best.length * 0.4))) ? best : null;
}

// ── Per-row validators ──
// Collect ALL problems for a row as structured errors: { row, field, category, value, message }.
// `ctx` = { rowNum, existing:{rot,phy Sets}, seenRot:Map(key→firstRow), seenPhy:Map }.
export function validateCustomerRow(raw, ctx) {
  const g = (k) => String(raw[k] == null ? '' : raw[k]).trim();
  const errors = [];
  const row = ctx.rowNum;
  const push = (field, category, value, message) => errors.push({ row, field, category, value, message });

  const company_name = g('company_name');
  const phone_primary = g('phone_primary');
  if (!company_name) push('company_name', 'MISSING_REQUIRED', '', "missing required field 'company_name'.");
  if (!phone_primary) push('phone_primary', 'MISSING_REQUIRED', '', "missing required field 'phone_primary'.");

  const ctRaw = g('customer_type');
  let customer_type = ctRaw.toUpperCase().replace(/[\s-]+/g, '_');
  if (customer_type === '') customer_type = 'REGULAR';
  else if (customer_type !== 'REGULAR' && customer_type !== 'ONE_TIME')
    push('customer_type', 'INVALID_CUSTOMER_TYPE', ctRaw, `customer_type '${ctRaw}' is not valid — use REGULAR or ONE_TIME.`);

  const sd = parseNonNegFE(g('security_deposit'));
  if (!sd.ok) push('security_deposit', 'INVALID_NUMBER', g('security_deposit'), `security_deposit '${g('security_deposit')}' is not a number ≥ 0.`);
  const hl = parseNonNegFE(g('holding_limit'));
  if (!hl.ok) push('holding_limit', 'INVALID_NUMBER', g('holding_limit'), `holding_limit '${g('holding_limit')}' is not a number ≥ 0.`);

  const data = {
    company_name, customer_type, contact_person: g('contact_person'),
    phone_primary, phone_alternate: g('phone_alternate'), address: g('address'),
    gst_number: g('gst_number'), security_deposit: sd.value, holding_limit: hl.value
  };
  return { data, errors };
}
export function validateCylinderRow(raw, ctx) {
  const g = (k) => String(raw[k] == null ? '' : raw[k]).trim();
  const errors = [];
  const row = ctx.rowNum;
  const push = (field, category, value, message) => errors.push({ row, field, category, value, message });

  const rotational_number = g('rotational_number');
  const physical_number = g('physical_number');
  if (!rotational_number) push('rotational_number', 'MISSING_REQUIRED', '', "missing required field 'rotational_number'.");

  const gasRaw = g('gas_type');
  const gas = normalizeGasTypeFE(gasRaw);
  if (!gasRaw) push('gas_type', 'MISSING_REQUIRED', '', "missing required field 'gas_type'.");
  else if (!gas) {
    const sug = closestGasType(gasRaw);
    push('gas_type', 'INVALID_GAS_TYPE', gasRaw,
      `gas_type '${gasRaw}' is not recognized${sug ? ` — did you mean '${sug}'?` : '.'}`);
  }

  const capRaw = g('capacity');
  let capacity = null;
  if (!capRaw) push('capacity', 'MISSING_REQUIRED', '', "missing required field 'capacity'.");
  else if (gas) {
    capacity = normalizeCapacityFE(gas, capRaw);
    if (!capacity) push('capacity', 'INVALID_CAPACITY', capRaw, `capacity '${capRaw}' is not valid for gas_type '${gas}'.`);
  }

  if (rotational_number) {
    const rk = rotational_number.toLowerCase();
    if (ctx.existing.rot.has(rk)) push('rotational_number', 'DUPLICATE_IN_DB', rotational_number, `rotational_number '${rotational_number}' already exists in the system.`);
    else if (ctx.seenRot.has(rk)) push('rotational_number', 'DUPLICATE_IN_FILE', rotational_number, `duplicate rotational_number '${rotational_number}' (also in row ${ctx.seenRot.get(rk)}).`);
    else ctx.seenRot.set(rk, row);
  }
  if (physical_number) {
    const pk = physical_number.toLowerCase();
    if (ctx.existing.phy.has(pk)) push('physical_number', 'DUPLICATE_IN_DB', physical_number, `physical_number '${physical_number}' already exists in the system.`);
    else if (ctx.seenPhy.has(pk)) push('physical_number', 'DUPLICATE_IN_FILE', physical_number, `duplicate physical_number '${physical_number}' (also in row ${ctx.seenPhy.get(pk)}).`);
    else ctx.seenPhy.set(pk, row);
  }

  const locRaw = g('location');
  let location = locRaw.toUpperCase().replace(/[\s-]+/g, '_');
  if (location === '') location = 'AT_PLANT_CHANDISAR';
  else if (!LOCATIONS.includes(location)) {
    // Accept friendly spellings (matches backend normalizeLocation).
    if (location.includes('CHANDISAR') || location.includes('PLANT')) location = 'AT_PLANT_CHANDISAR';
    else if (location.includes('PALANPUR')) location = 'AT_PALANPUR_OFFICE';
    else if (location.includes('CHHAPI')) location = 'AT_CHHAPI_OFFICE';
    else push('location', 'INVALID_LOCATION', locRaw, `location '${locRaw}' is not valid — use ${LOCATIONS.join(', ')}.`);
  }

  const ssRaw = g('stock_state');
  let stock_state = ssRaw.toUpperCase().replace(/[\s-]+/g, '_');
  if (stock_state === '') stock_state = 'IN_STOCK';
  else if (stock_state !== 'IN_STOCK' && stock_state !== 'AT_CUSTOMER')
    push('stock_state', 'INVALID_STOCK_STATE', ssRaw, `stock_state '${ssRaw}' is not valid — use IN_STOCK or AT_CUSTOMER.`);

  const data = {
    rotational_number, physical_number,
    gas_type: gas || gasRaw, capacity: capacity || capRaw,
    location: LOCATIONS.includes(location) ? location : 'AT_PLANT_CHANDISAR',
    stock_state: stock_state === 'AT_CUSTOMER' ? 'AT_CUSTOMER' : 'IN_STOCK'
  };
  return { data, errors };
}

// Build + download a blank template: fillable table at A1 (required headers starred), with
// copy-paste reference lists + LEGEND placed to the RIGHT of the table on the same sheet, plus
// an Instructions sheet (field | required? | notes | example).
export function downloadImportTemplate(which) {
  const schema = IMPORT_SCHEMAS[which];
  const cols = schema.columns;
  const headers = cols.map(importHeaderLabel);
  const exampleRow = cols.map(c => schema.example[c.key] == null ? '' : schema.example[c.key]);

  const wsMain = XLSX.utils.aoa_to_sheet([headers, exampleRow]);

  // Reference block to the right of the data table (1-column gap).
  const refStartCol = cols.length + 1;
  const refBlock = which === 'customers' ? customerRefBlockAoA(schema) : cylinderRefBlockAoA(schema);
  XLSX.utils.sheet_add_aoa(wsMain, refBlock, { origin: { r: 0, c: refStartCol } });

  // Column widths: data columns + gap + 2 reference columns.
  const widths = cols.map(c => ({ wch: Math.max(16, importHeaderLabel(c).length + 3) }));
  widths.push({ wch: 3 });                                   // gap
  widths.push({ wch: 26 }, { wch: 34 });                     // reference cols
  wsMain['!cols'] = widths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsMain, schema.sheet);

  const wsInfo = XLSX.utils.aoa_to_sheet(instructionsAoA(schema));
  wsInfo['!cols'] = [{ wch: 22 }, { wch: 12 }, { wch: 52 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsInfo, schema.infoSheet);

  XLSX.writeFile(wb, `cylinderpro-${which}-import-template.xlsx`);
}

// Right-of-table reference block for the Cylinders sheet.
export function cylinderRefBlockAoA(schema) {
  const rows = [];
  rows.push(['LEGEND', '']);
  rows.push(['REQUIRED (must fill)', schema.legend.required]);
  rows.push(['OPTIONAL (may be blank)', schema.legend.optional]);
  rows.push(['(required headers end with *)', '']);
  rows.push(['', '']);
  rows.push(['VALID GAS TYPES', '']);
  GAS_TYPE_LIST.forEach(g => rows.push([g, '']));
  rows.push(['', '']);
  rows.push(['VALID CAPACITIES BY GAS TYPE', '']);
  rows.push(['Gas Type', 'Allowed Capacity']);
  GAS_TYPE_LIST.forEach(g => GAS_CAPACITIES[g].forEach(cap => rows.push([g, cap])));
  rows.push(['', '']);
  rows.push(['VALID LOCATION', '']);
  LOCATIONS.forEach(l => rows.push([l, LOCATION_LABELS[l]]));
  rows.push(['', '']);
  rows.push(['VALID STOCK STATE', '']);
  rows.push(['IN_STOCK', '']);
  rows.push(['AT_CUSTOMER', '']);
  return rows;
}
// Right-of-table reference block for the Customers sheet.
export function customerRefBlockAoA(schema) {
  return [
    ['LEGEND', ''],
    ['REQUIRED (must fill)', schema.legend.required],
    ['OPTIONAL (may be blank)', schema.legend.optional],
    ['(required headers end with *)', ''],
    ['', ''],
    ['VALID CUSTOMER TYPE', ''],
    ['REGULAR', ''],
    ['ONE_TIME', '']
  ];
}
// Instructions sheet: field | required? | notes | example, prefaced by the legend.
export function instructionsAoA(schema) {
  const rows = [
    [`CylinderPro — ${schema.label} Import — Instructions`, '', '', ''],
    ['REQUIRED:', schema.legend.required, '', ''],
    ['OPTIONAL:', schema.legend.optional, '', ''],
    ['Required headers are marked with a trailing "*". Optional fields may be left blank.', '', '', ''],
    ['', '', '', ''],
    ['Field', 'Required?', 'Notes', 'Example']
  ];
  schema.columns.forEach(c => {
    const ex = schema.example[c.key];
    rows.push([c.key, c.required ? 'REQUIRED' : 'optional', c.note || '', ex == null ? '' : String(ex)]);
  });
  rows.push(['', '', '', '']);
  rows.push(['Note', `Row 2 of the ${schema.sheet} sheet is an EXAMPLE — overwrite or delete it. If left exactly as-is it is ignored.`, '', '']);
  rows.push(['Note', 'Reference lists for valid values are on the right side of the data sheet — copy a value and paste it into a cell for an exact match.', '', '']);
  return rows;
}

// Read an .xlsx/.xls File into a SheetJS workbook.
export function readWorkbookFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try { resolve(XLSX.read(new Uint8Array(e.target.result), { type: 'array' })); }
      catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsArrayBuffer(file);
  });
}

// Parse + validate an uploaded file against a schema. Returns
// { rows: [{ rowNum, data, errors:[structured] }], blankSkipped, exampleSkipped }.
// Headers are matched by NORMALIZED name (case/space/underscore/"*"-insensitive), not position,
// so "Rotational Number", "rotational_number" and "rotational_number*" all map to the same key.
export async function parseImportFile(which, file, existing) {
  const schema = IMPORT_SCHEMAS[which];
  const wb = await readWorkbookFile(file);
  const wsName = wb.SheetNames.includes(schema.sheet) ? schema.sheet : wb.SheetNames[0];
  const ws = wb.Sheets[wsName];
  if (!ws) throw new Error('The file has no readable sheet.');

  // Read as a grid (blankrows kept) so the Excel row number stays exact even past blank rows.
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: '', raw: false });
  const headerRow = grid[0] || [];

  // Map each schema field key → the column index whose normalized header matches it.
  const colIndexByKey = {};
  schema.columns.forEach(c => {
    const want = normalizeHeaderKey(c.key);
    const idx = headerRow.findIndex(h => normalizeHeaderKey(h) === want);
    if (idx !== -1) colIndexByKey[c.key] = idx;
  });
  const missing = schema.columns.filter(c => c.required && colIndexByKey[c.key] === undefined).map(c => c.key);
  if (missing.length) {
    throw new Error(`This file is missing required column(s): ${missing.join(', ')}. Please use the downloaded template.`);
  }

  const cellOf = (gridRow, key) => {
    const idx = colIndexByKey[key];
    if (idx === undefined) return '';
    const v = gridRow[idx];
    return v == null ? '' : v;
  };
  const exampleTrim = {};
  schema.columns.forEach(c => { exampleTrim[c.key] = String(schema.example[c.key] == null ? '' : schema.example[c.key]).trim(); });

  const ctx = {
    existing: existing || { rot: new Set(), phy: new Set() },
    seenRot: new Map(), seenPhy: new Map()
  };
  const rows = [];
  let blankSkipped = 0, exampleSkipped = 0;

  // The reference lists sit to the RIGHT on the same rows, so a row can be "blank" in the data
  // columns yet hold reference text. Only scan down to the last row that has real DATA content,
  // so the reference-only tail isn't miscounted as blank rows.
  let lastDataIdx = 0;
  for (let i = 1; i < grid.length; i++) {
    const gr = grid[i] || [];
    if (schema.columns.some(c => String(cellOf(gr, c.key)).trim() !== '')) lastDataIdx = i;
  }

  for (let i = 1; i <= lastDataIdx; i++) {           // i=0 is the header
    const gridRow = grid[i] || [];
    const rowNum = i + 1;                            // Excel row (header is row 1, data starts at 2)
    const raw = {};
    schema.columns.forEach(c => { raw[c.key] = cellOf(gridRow, c.key); });

    const allBlank = schema.columns.every(c => String(raw[c.key]).trim() === '');
    if (allBlank) { blankSkipped++; continue; }
    const isExample = schema.columns.every(c => String(raw[c.key]).trim() === exampleTrim[c.key]);
    if (isExample) { exampleSkipped++; continue; }

    ctx.rowNum = rowNum;
    const out = which === 'customers' ? validateCustomerRow(raw, ctx) : validateCylinderRow(raw, ctx);
    rows.push({ rowNum, data: out.data, errors: out.errors });
  }

  return { rows, blankSkipped, exampleSkipped };
}

// Download a categorized .xlsx error report: row | field | category | value | message.
// `issues` = array of { row, field, category, value, message }.
export function downloadImportIssues(issues, baseName) {
  if (!issues.length) return;
  const aoa = [['Row', 'Field', 'Category', 'Value', 'Message']].concat(
    issues.map(x => [x.row, x.field || '', x.category || '', x.value == null ? '' : x.value, x.message || ''])
  );
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 7 }, { wch: 18 }, { wch: 20 }, { wch: 22 }, { wch: 70 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Errors');
  XLSX.writeFile(wb, `${baseName}.xlsx`);
}

// Auth Page Component
// ─── Phase 27: forgot-password recovery panel ───
// Two steps: (1) enter the account email → a code is sent to it; (2) enter that code — OR a
// code from an authenticator already enrolled on the account — plus the new password. The
// authenticator alternative is the escape hatch for when the inbox itself is unreachable.
export function ForgotPasswordPanel({ initialEmail = '', onCancel, onDone }) {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState(initialEmail);
  const [resetToken, setResetToken] = useState('');
  const [totpAvailable, setTotpAvailable] = useState(false);
  const [useTotp, setUseTotp] = useState(false);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const request = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await fetch(`${API_URL}/auth/forgot-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not start reset.'); return; }
      setResetToken(data.reset_token);
      setTotpAvailable(!!data.totp_available);
      setStep(2);
    } catch { setError('Network error. Is the server running?'); }
    finally { setBusy(false); }
  };

  const reset = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPw) { setError('The two passwords do not match.'); return; }
    setBusy(true); setError('');
    try {
      const body = { reset_token: resetToken, new_password: newPassword };
      if (useTotp) body.totp_code = code; else body.code = code;
      const res = await fetch(`${API_URL}/auth/forgot-password/reset`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Reset failed.'); return; }
      showToast(data.message || 'Password updated.', 'success');
      onDone();
    } catch { setError('Network error.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="auth-form">
      <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔑</div>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          {step === 1
            ? 'Enter your account email and we\'ll send a 6-digit code to reset your password.'
            : `Enter the code and choose a new password for ${email}.`}
        </p>
      </div>

      {step === 1 ? (
        <form onSubmit={request}>
          <div className="form-group">
            <label>Account Email</label>
            <input type="email" className="form-control" value={email} autoFocus
              onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" required />
          </div>
          {error && <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>{error}</div>}
          <button type="submit" className="btn btn-primary auth-submit" disabled={busy || !email}>
            {busy ? 'Sending…' : 'Send reset code'}
          </button>
        </form>
      ) : (
        <form onSubmit={reset}>
          <div className="alert" style={{ fontSize: '0.82rem' }}>
            If that email has an account, a code is on its way. Didn't get it?{' '}
            {totpAvailable
              ? <button type="button" className="link-btn" onClick={() => { setUseTotp(v => !v); setCode(''); setError(''); }}>
                  {useTotp ? 'use the emailed code instead' : 'use your authenticator app instead'}
                </button>
              : 'check spam, or try again in a moment.'}
          </div>
          <div className="form-group">
            <label>{useTotp ? 'Authenticator code' : 'Emailed code'}</label>
            <input type="text" className="form-control" value={code} autoFocus
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••" maxLength={6}
              style={{ textAlign: 'center', fontSize: '1.4rem', letterSpacing: '0.4rem' }} required />
          </div>
          <div className="form-group">
            <label>New Password</label>
            <input type="password" className="form-control" value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)} placeholder="Min 8 chars, a number and a symbol" required />
          </div>
          <div className="form-group">
            <label>Confirm New Password</label>
            <input type="password" className="form-control" value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)} placeholder="Re-enter new password" required />
          </div>
          {error && <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>{error}</div>}
          <button type="submit" className="btn btn-primary auth-submit" disabled={busy || code.length !== 6 || !newPassword}>
            {busy ? 'Updating…' : 'Reset password'}
          </button>
        </form>
      )}

      <button type="button" className="link-btn"
        style={{ marginTop: '0.75rem', display: 'block', textAlign: 'center', width: '100%' }}
        onClick={onCancel}>← Back to Sign In</button>
    </div>
  );
}

export function AuthPage({ onAuthSuccess, notice }) {
  const [mode, setMode] = useState('signin');
  const [formData, setFormData] = useState({ name: '', email: '', password: '', developer_token: '' });
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // 2FA / signup OTP verification state
  const [otpStep, setOtpStep] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [pendingToken, setPendingToken] = useState('');
  const [otpEmail, setOtpEmail] = useState('');
  const [showForgot, setShowForgot] = useState(false); // Phase 27: password recovery panel

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const body = mode === 'signup'
        ? { name: formData.name, email: formData.email, password: formData.password, developer_token: formData.developer_token }
        : { email: formData.email, password: formData.password, remember };

      const res = await fetch(`${API_URL}/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong');
      } else if (data.requires_2fa || data.requires_otp) {
        setPendingToken(data.pending_token);
        setOtpEmail(data.gatekeeper_email || data.email);
        setOtpStep(true);
        setOtpCode('');
      } else {
        onAuthSuccess(data);
      }
    } catch {
      setError('Network error. Is the server running?');
    }
    setLoading(false);
  };

  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const endpoint = mode === 'signin'
        ? `${API_URL}/auth/signin/verify-2fa`
        : `${API_URL}/auth/signup/confirm`;
      const body = { pending_token: pendingToken, code: otpCode, remember };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Verification failed');
      } else {
        onAuthSuccess(data);
      }
    } catch {
      setError('Network error');
    }
    setLoading(false);
  };

  const switchMode = () => {
    setMode(mode === 'signin' ? 'signup' : 'signin');
    setError('');
    setOtpStep(false);
    setOtpCode('');
    setPendingToken('');
    setShowForgot(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo">🔵</div>
          <h1>CylinderPro</h1>
          <p>Gas Cylinder Management System</p>
        </div>

        {notice && <div className="alert alert-warning" style={{marginBottom:'1rem'}}>{notice}</div>}

        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${mode === 'signin' ? 'active' : ''}`}
            onClick={() => { setMode('signin'); setError(''); setOtpStep(false); }}
          >Sign In</button>
          <button
            type="button"
            className={`auth-tab ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => { setMode('signup'); setError(''); setOtpStep(false); }}
          >Sign Up</button>
        </div>

        {showForgot ? (
          <ForgotPasswordPanel
            initialEmail={formData.email}
            onCancel={() => { setShowForgot(false); setError(''); }}
            onDone={() => { setShowForgot(false); setError(''); setMode('signin'); }}
          />
        ) : otpStep ? (
          <form onSubmit={handleOtpSubmit} className="auth-form">
            <div style={{textAlign:'center', marginBottom:'1rem'}}>
              <div style={{fontSize:'2rem', marginBottom:'0.5rem'}}>🔐</div>
              <p style={{fontSize:'0.9rem', color:'var(--text-muted)'}}>
                {mode === 'signin'
                  ? `Enter the 6-digit code sent to your email (${otpEmail})`
                  : `Enter the 6-digit approval code sent to the administrator (${otpEmail})`}
              </p>
            </div>
            <div className="form-group">
              <label>Verification Code</label>
              <input
                type="text"
                className="form-control"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••••"
                maxLength={6}
                autoFocus
                style={{textAlign:'center', fontSize:'1.5rem', letterSpacing:'0.5rem'}}
                required
              />
            </div>

            {mode === 'signin' && (
              <label style={{display:'flex', alignItems:'center', gap:'0.5rem', fontSize:'0.85rem', marginBottom:'1rem', cursor:'pointer'}}>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Remember this device for 3 months
              </label>
            )}

            {error && <div className="alert alert-danger" style={{marginBottom:'1rem'}}>{error}</div>}

            <button type="submit" className="btn btn-primary auth-submit" disabled={loading || otpCode.length !== 6}>
              {loading ? 'Verifying...' : 'Verify & Continue'}
            </button>
            <button type="button" className="link-btn" style={{marginTop:'0.75rem', display:'block', textAlign:'center', width:'100%'}}
              onClick={() => { setOtpStep(false); setError(''); }}>
              ← Back to {mode === 'signin' ? 'Sign In' : 'Sign Up'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="auth-form">
            {mode === 'signup' && (
              <>
                <div className="form-group">
                  <label>Developer Token</label>
                  <input
                    type="text"
                    className="form-control"
                    value={formData.developer_token}
                    onChange={(e) => setFormData({...formData, developer_token: e.target.value})}
                    placeholder="Enter developer access token"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Full Name</label>
                  <input
                    type="text"
                    className="form-control"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    placeholder="Your full name"
                    required
                  />
                </div>
              </>
            )}

            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                className="form-control"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                placeholder="your@email.com"
                required
              />
            </div>

            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                className="form-control"
                value={formData.password}
                onChange={(e) => setFormData({...formData, password: e.target.value})}
                placeholder={mode === 'signup' ? 'Minimum 8 characters' : 'Your password'}
                required
              />
            </div>

            {mode === 'signin' && (
              <label style={{display:'flex', alignItems:'center', gap:'0.5rem', fontSize:'0.85rem', marginBottom:'1rem', cursor:'pointer'}}>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Remember this device for 3 months
              </label>
            )}

            {error && <div className="alert alert-danger" style={{marginBottom: '1rem'}}>{error}</div>}

            <button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
              {loading ? 'Please wait...' : (mode === 'signin' ? 'Sign In' : 'Create Account')}
            </button>
            {mode === 'signin' && (
              <button type="button" className="link-btn"
                style={{marginTop:'0.75rem', display:'block', textAlign:'center', width:'100%', fontSize:'0.85rem'}}
                onClick={() => { setShowForgot(true); setError(''); }}>
                Forgot password?
              </button>
            )}
          </form>
        )}

        <p className="auth-switch">
          {mode === 'signin' ? "Don't have an account? " : "Already have an account? "}
          <button type="button" className="link-btn" onClick={switchMode}>
            {mode === 'signin' ? 'Sign Up' : 'Sign In'}
          </button>
        </p>
      </div>
    </div>
  );
}

// Clear All Data Modal
// Phase 21: password alone is no longer enough — clearing everything also needs an
// OWNER-ONLY step-up approval (no other trusted person can authorize it).
export function ClearDataModal({ onClose, onCleared }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [askOwner, setAskOwner] = useState(false);

  const doClear = async (auth) => {
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch(`${API_URL}/auth/clear-data`, {
        method: 'POST',
        headers: { 'x-step-up-token': auth.step_up_token },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong');
      } else {
        onCleared();
      }
    } catch {
      setError('Network error');
    }
    setLoading(false);
  };

  // Password submit now leads to the owner-approval step instead of firing directly.
  const handleClear = (e) => {
    e.preventDefault();
    setError('');
    setAskOwner(true);
  };

  const a11yRef = useModalA11y(onClose);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" ref={a11yRef} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header danger">
          <span>🗑️ Clear All Data</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="alert alert-danger">
            <strong>Warning: This action cannot be undone.</strong><br />
            All your customers, bills, and payments will be permanently deleted.
          </div>

          {!confirmed ? (
            <div style={{textAlign:'center', marginTop:'1rem'}}>
              <p style={{marginBottom:'1rem', color:'var(--text-2)'}}>
                Are you sure you want to delete all your data?
              </p>
              <div className="btn-group" style={{justifyContent:'center'}}>
                <button className="btn btn-danger" onClick={() => setConfirmed(true)}>
                  Yes, I want to clear all data
                </button>
                <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleClear} style={{marginTop:'1rem'}}>
              <div className="form-group">
                <label>Enter your password to confirm</label>
                <input
                  type="password"
                  className="form-control"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your account password"
                  autoFocus
                  required
                />
              </div>
              {error && <div className="alert alert-danger">{error}</div>}
              <div className="btn-group">
                <button type="submit" className="btn btn-danger" disabled={loading || !password}>
                  {loading ? 'Deleting...' : 'Continue to owner approval'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              </div>
              <p style={{fontSize:'0.78rem', color:'var(--text-muted)', marginTop:'0.5rem'}}>
                👑 Next step: only the account owner can approve clearing all data.
              </p>
            </form>
          )}
        </div>
        {askOwner && (
          <StepUpVerificationModal
            title="Owner approval — clear all data"
            context="permanently clear ALL business data (customers, transactions, payments, cylinders) for this account"
            ownerOnly
            onVerified={(auth) => { setAskOwner(false); doClear(auth); }}
            onClose={() => setAskOwner(false)}
          />
        )}
      </div>
    </div>
  );
}

// Outstanding Receivables Component
export function OutstandingReceivables({ onNavigate, onSelectCustomer }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  useEffect(() => { fetchOutstanding(); }, []);

  const fetchOutstanding = async () => {
    try {
      const res = await apiFetch(`${API_URL}/reports/outstanding`);
      setData(await res.json());
      setLoading(false);
    } catch (e) {
      console.error('Error fetching outstanding:', e);
      setLoading(false);
    }
  };

  const totalOutstanding = data.reduce((s, c) => s + (c.outstanding_amount || 0), 0);
  const totalBilled     = data.reduce((s, c) => s + (c.total_billed || 0), 0);
  const totalPaid       = data.reduce((s, c) => s + (c.total_paid || 0), 0);

  // Open the Record Payment modal for a customer.
  const openPayment = (item) => setSelectedCustomer(item);

  const [outVisible, outMore, outOpen, setOutOpen] = useViewAll(data, 5);

  // Column spec shared by the inline table and the "View All" modal.
  const outColumns = [
    { header: 'Customer', cell: (item) => item.customer_type === 'REGULAR'
        ? <span className="clickable" onClick={() => { onSelectCustomer(String(item.customer_id)); onNavigate('customer-detail'); }}>{item.company_name}</span>
        : <span>{item.company_name}</span> },
    { header: 'Type', cell: (item) => item.customer_type === 'ONE_TIME'
        ? <span className="badge badge-warning">One-Time</span> : <span className="badge badge-success">Regular</span> },
    { header: 'Contact', cell: (item) => item.contact_person || '-' },
    { header: 'Phone', cell: (item) => displayContact(item.phone_primary) || '-' },
    { header: 'Total Billed', cell: (item) => `₹${(item.total_billed || 0).toFixed(2)}` },
    { header: 'Total Paid', cell: (item) => `₹${(item.total_paid || 0).toFixed(2)}` },
    { header: 'Outstanding', cell: (item) => <strong style={{color:'#e74c3c'}}>₹{(item.outstanding_amount || 0).toFixed(2)}</strong> },
    { header: 'Action', cell: (item) => (
        <button className="btn btn-primary" style={{padding:'0.25rem 0.75rem', fontSize:'0.875rem'}}
          onClick={() => { setOutOpen(false); openPayment(item); }}>Record Payment</button>) }
  ];

  if (loading) return <Spinner label="Loading outstanding amounts…" />;

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card green">
          <h3>Total to Receive</h3>
          <div className="value">₹{totalOutstanding.toFixed(2)}</div>
        </div>
        <div className="stat-card blue">
          <h3>Total Billed</h3>
          <div className="value">₹{totalBilled.toFixed(2)}</div>
        </div>
        <div className="stat-card orange">
          <h3>Total Received So Far</h3>
          <div className="value">₹{totalPaid.toFixed(2)}</div>
        </div>
        <div className="stat-card purple">
          <h3>Customers with Dues</h3>
          <div className="value">{data.length}</div>
        </div>
      </div>

      <div className="card">
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem'}}>
          <h2 style={{margin:0}}>Outstanding Receivables — Money to Collect</h2>
          {data.length > 0 && (
            <button className="btn btn-secondary" onClick={() => exportToExcel(
              data.map((r,i) => ({
                'Sr.': i+1,
                'Customer': r.company_name,
                'Type': r.customer_type,
                'Contact': r.contact_person || '',
                'Phone': displayContact(r.phone_primary),
                'Total Billed': r.total_billed || 0,
                'Total Paid': r.total_paid || 0,
                'Outstanding': r.outstanding_amount || 0
              })), getExportFileName('outstanding'), 'Outstanding'
            )}>Export Excel</button>
          )}
        </div>
        {data.length === 0 ? (
          <div className="alert alert-success">No outstanding dues. All payments collected!</div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Sr.</th>
                  <th>Customer Name</th>
                  <th>Type</th>
                  <th>Contact</th>
                  <th>Phone</th>
                  <th>Total Billed</th>
                  <th>Total Paid</th>
                  <th>Outstanding</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {outVisible.map((item, index) => (
                  <tr
                    key={String(item.customer_id)}
                    style={selectedCustomer && selectedCustomer.customer_id === item.customer_id
                      ? {backgroundColor: '#e8f5e9'} : {}}
                  >
                    <td>{index + 1}</td>
                    <td>
                      {item.customer_type === 'REGULAR' ? (
                        <span className="clickable" onClick={() => {
                          onSelectCustomer(String(item.customer_id));
                          onNavigate('customer-detail');
                        }}>{item.company_name}</span>
                      ) : (
                        <span>{item.company_name}</span>
                      )}
                    </td>
                    <td>
                      {item.customer_type === 'ONE_TIME'
                        ? <span className="badge badge-warning">One-Time</span>
                        : <span className="badge badge-success">Regular</span>
                      }
                    </td>
                    <td>{item.contact_person || '-'}</td>
                    <td>{displayContact(item.phone_primary) || '-'}</td>
                    <td>₹{(item.total_billed || 0).toFixed(2)}</td>
                    <td>₹{(item.total_paid || 0).toFixed(2)}</td>
                    <td><strong style={{color: '#e74c3c'}}>₹{(item.outstanding_amount || 0).toFixed(2)}</strong></td>
                    <td>
                      <button
                        className="btn btn-primary"
                        style={{padding: '0.25rem 0.75rem', fontSize: '0.875rem'}}
                        onClick={() => openPayment(item)}
                      >
                        Record Payment
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{backgroundColor: '#34495e', color: 'white', fontWeight: 'bold'}}>
                  <td colSpan="5">TOTAL</td>
                  <td>₹{totalBilled.toFixed(2)}</td>
                  <td>₹{totalPaid.toFixed(2)}</td>
                  <td>₹{totalOutstanding.toFixed(2)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
            {outMore && <ViewAllButton count={data.length} onClick={() => setOutOpen(true)} />}
          </div>
        )}
      </div>

      {/* View All — full outstanding list with search */}
      {outOpen && (
        <ListModal
          title="Outstanding Receivables"
          items={data}
          columns={outColumns}
          searchKeys={['company_name']}
          searchPlaceholder="Search by customer name…"
          onClose={() => setOutOpen(false)}
        />
      )}

      {/* Record Payment — centered modal */}
      {selectedCustomer && (
        <Modal
          title={`Record Payment — ${selectedCustomer.company_name}`}
          size="wide"
          onClose={() => setSelectedCustomer(null)}
        >
          <p style={{color: '#7f8c8d', marginBottom: '1rem'}}>
            Outstanding: <strong style={{color: '#e74c3c'}}>₹{(selectedCustomer.outstanding_amount || 0).toFixed(2)}</strong>
            {selectedCustomer.customer_type === 'ONE_TIME' && (
              <span className="badge badge-warning" style={{marginLeft: '0.5rem', fontSize: '0.8rem'}}>One-Time</span>
            )}
          </p>
          <PaymentForm
            customerId={String(selectedCustomer.customer_id)}
            onSuccess={() => { setSelectedCustomer(null); fetchOutstanding(); }}
            onCancel={() => setSelectedCustomer(null)}
          />
        </Modal>
      )}
    </div>
  );
}

// Main App Component
export function App() {
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('authToken'));
  const [currentUser, setCurrentUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('currentUser')); } catch { return null; }
  });
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [navFilter, setNavFilter] = useState(null); // one-shot filter handed to the next page
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [authNotice, setAuthNotice] = useState('');
  // Bump to force a fully-fresh New Transaction form (remount → no pre-filled data).
  const [txnKey, setTxnKey] = useState(0);

  // Optional section id CustomerDetail scrolls to after loading (e.g. 'currently-holding'
  // when arriving from an AT_CUSTOMER row in Cylinder Inventory).
  const [customerScrollTo, setCustomerScrollTo] = useState(null);
  const openCustomer = (id, scrollTo = null) => { setSelectedCustomerId(id); setCustomerScrollTo(scrollTo); setCurrentPage('customer-detail'); };
  // Always start New Transaction from a clean slate.
  const goNewTransaction = () => { setTxnKey(k => k + 1); setCurrentPage('new-transaction'); };

  useEffect(() => {
    const handleLogout = (e) => {
      setAuthToken(null);
      setCurrentUser(null);
      if (e && e.detail && e.detail.message) setAuthNotice(e.detail.message);
    };
    window.addEventListener('auth-logout', handleLogout);
    return () => window.removeEventListener('auth-logout', handleLogout);
  }, []);

  // Load the live gas → sizes catalog once at startup (Phase 10).
  useEffect(() => { loadGasCatalog(); }, []);

  const handleAuthSuccess = (data) => {
    localStorage.setItem('authToken', data.token);
    localStorage.setItem('currentUser', JSON.stringify({ name: data.name, email: data.email }));
    setAuthToken(data.token);
    setCurrentUser({ name: data.name, email: data.email });
    setAuthNotice('');
  };

  const handleLogout = () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    setAuthToken(null);
    setCurrentUser(null);
  };

  if (!authToken) {
    return (
      <>
        <Toaster />
        <AuthPage onAuthSuccess={handleAuthSuccess} notice={authNotice} />
      </>
    );
  }

  // Phase 25: KPI cards navigate AND pre-apply a filter. onNavigate stays backwards compatible —
  // called with one argument it behaves exactly as before; the optional second argument is
  // consumed once by the destination page and then cleared, so it does not stick on the next visit.
  const navigateWithFilter = (page, filter = null) => {
    setNavFilter(filter);
    setCurrentPage(page);
  };
  const consumeNavFilter = () => { const f = navFilter; setNavFilter(null); return f; };

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard onNavigate={navigateWithFilter} />;
      case 'customers':
        return <CustomerMaster onNavigate={setCurrentPage} onSelectCustomer={setSelectedCustomerId}
          initialFilter={navFilter} onFilterConsumed={consumeNavFilter} />;
      case 'customer-detail':
        return <CustomerDetail customerId={selectedCustomerId} scrollTo={customerScrollTo} onBack={() => setCurrentPage('customers')} onSelectCustomer={openCustomer} />;
      case 'new-transaction':
        return <TransactionEntry key={txnKey}
          onBack={() => setCurrentPage('dashboard')}
          onViewCustomer={openCustomer}
          onNewTransaction={goNewTransaction} />;
      case 'payments':
        return <Payments onNavigate={setCurrentPage} />;
      case 'outstanding':
        return <OutstandingReceivables onNavigate={setCurrentPage} onSelectCustomer={setSelectedCustomerId} />;
      case 'cylinders':
        return <CylinderInventory onViewCustomer={(id) => openCustomer(id, 'currently-holding')}
          initialFilter={navFilter} onFilterConsumed={consumeNavFilter} />;
      case 'aging-report':
        return <CylinderAgingReport onViewCustomer={(id) => openCustomer(id, 'aging-history')} />;
      case 'transactions':
        return <TransactionHistory initialFilter={navFilter} onFilterConsumed={consumeNavFilter} />;
      case 'filling-list':
        return <FillingListPage />;
      case 'reports':
        return <Reports />;
      case 'profile':
        return <ProfilePage currentUser={currentUser} onUserUpdated={(u) => {
          setCurrentUser(u);
          localStorage.setItem('currentUser', JSON.stringify({ name: u.name, email: u.email }));
        }} onLoggedOut={handleLogout} />;
      default:
        return <Dashboard onNavigate={setCurrentPage} />;
    }
  };

  const pageTitles = {
    'dashboard':       'Dashboard',
    'new-transaction': 'New Transaction',
    'payments':        'Payments',
    'outstanding':     'Outstanding Dues',
    'customers':       'Customers',
    'customer-detail': 'Customer Detail',
    'cylinders':       'Cylinder Inventory',
    'aging-report':    'Cylinder Aging Report',
    'transactions':    'Transaction History',
    'filling-list':    'Filling List — Chandisar',
    'reports':         'Reports',
    'profile':         'Profile',
  };

  // Map the current page/view to the sidebar nav item that should stay highlighted.
  // Deep pages and the modals rendered within them inherit their parent page's highlight.
  const pageToNav = {
    'customer-detail': 'customers',   // Customer Detail + Customer Edit modal → Customers
    // all other currentPage values equal their own nav key
  };
  const activeNav = pageToNav[currentPage] || currentPage;

  const navItems = [
    { key: 'dashboard',       icon: '🏠', label: 'Dashboard' },
    { key: 'new-transaction', icon: '🧾', label: 'New Transaction' },
    { key: 'payments',        icon: '💰', label: 'Payments' },
    { key: 'outstanding',     icon: '📊', label: 'Outstanding' },
    { key: 'customers',       icon: '👥', label: 'Customers' },
    { key: 'cylinders',       icon: '🛢️', label: 'Cylinder Inventory' },
    { key: 'aging-report',    icon: '⏱️', label: 'Aging Report' },
    { key: 'filling-list',    icon: '⛽', label: 'Filling List' },
    { key: 'transactions',    icon: '📜', label: 'Transaction History' },
    { key: 'reports',         icon: '📈', label: 'Reports' },
  ];

  const today = new Date().toLocaleDateString('en-IN', { timeZone: IST_TZ, weekday:'long', year:'numeric', month:'long', day:'numeric' });

  return (
    <div className="app-shell">
      <Toaster />
      <div className={`sidebar-overlay${sidebarOpen ? ' open' : ''}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">🔵</div>
          <div className="sidebar-brand-name">CylinderPro</div>
          <div className="sidebar-brand-sub">Management System</div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-label">Menu</div>
          {navItems.map(item => (
            <button
              key={item.key}
              className={`nav-link ${activeNav === item.key ? 'active' : ''}`}
              onClick={() => { setSidebarOpen(false); item.key === 'new-transaction' ? goNewTransaction() : setCurrentPage(item.key); }}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        <div className="sidebar-footer">
          <button
            className={`sidebar-profile ${currentPage === 'profile' ? 'active' : ''}`}
            onClick={() => { setSidebarOpen(false); setCurrentPage('profile'); }}
            title="View profile"
          >
            <span className="profile-avatar">{initialsOf(currentUser?.name)}</span>
            <span style={{overflow:'hidden'}}>
              <span style={{display:'block', fontWeight:600, fontSize:'0.85rem', whiteSpace:'nowrap', textOverflow:'ellipsis', overflow:'hidden'}}>{currentUser?.name || 'User'}</span>
              <span style={{display:'block', fontSize:'0.72rem', opacity:0.75, whiteSpace:'nowrap', textOverflow:'ellipsis', overflow:'hidden'}}>{currentUser?.email || ''}</span>
            </span>
          </button>
        </div>
      </aside>

      <div className="main-content">
        <div className="topbar">
          <button className="mobile-hamburger" onClick={() => setSidebarOpen(o => !o)} aria-label="Menu">☰</button>
          <span className="topbar-title">{pageTitles[currentPage] || 'CylinderPro'}</span>
          <span className="topbar-date">{today}</span>
        </div>
        <SecurityReminderBanner onGoToProfile={() => setCurrentPage('profile')} />
        <div className="container">
          <PageErrorBoundary pageKey={currentPage}>
            {renderPage()}
          </PageErrorBoundary>
        </div>
      </div>

    </div>
  );
}

// ─── Page error boundary ───
// A render crash in one page must not blank the whole app. Resets on navigation
// (pageKey) or via the retry button.
export class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidUpdate(prevProps) {
    if (prevProps.pageKey !== this.props.pageKey && this.state.error) {
      this.setState({ error: null });
    }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="card" style={{textAlign:'center', padding:'2.5rem 1.5rem'}}>
          <div style={{fontSize:'2rem'}}>⚠️</div>
          <h2 style={{margin:'0.75rem 0 0.25rem'}}>This page hit an error</h2>
          <p style={{color:'var(--text-muted)', marginBottom:'1.25rem'}}>
            The rest of the app is fine. You can retry, or switch to another page from the sidebar.
          </p>
          <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Security reminder banner (Phase 17) ───
// Non-blocking: shows only when the login email (or a trusted person's email) has stayed
// unverified past the reminder threshold (default 3 days). Dismiss lasts for this session.
export function SecurityReminderBanner({ onGoToProfile }) {
  const [status, setStatus] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`${API_URL}/auth/security-status`);
        if (res.ok) setStatus(await res.json());
      } catch {}
    })();
  }, []);

  if (dismissed || !status) return null;
  const needsUser = status.remind_email_verify;
  const needsPeople = (status.unverified_people || []).length > 0;
  if (!needsUser && !needsPeople) return null;

  return (
    <div style={{background:'#FEF3C7', borderBottom:'1px solid #FDE68A', color:'#92400E',
      padding:'0.5rem 1.25rem', display:'flex', alignItems:'center', gap:'0.75rem', flexWrap:'wrap', fontSize:'0.85rem'}}>
      <span>⚠️
        {needsUser && <> Your login email <strong>{status.email}</strong> is not verified yet.</>}
        {needsPeople && <> Trusted {status.unverified_people.length === 1 ? 'person' : 'people'}{' '}
          <strong>{status.unverified_people.map(p => p.name).join(', ')}</strong> still {status.unverified_people.length === 1 ? 'has' : 'have'} an unverified email.</>}
        {' '}Everything keeps working — verifying just secures approvals.
      </span>
      <button className="btn btn-primary" style={{padding:'0.2rem 0.7rem', fontSize:'0.78rem'}}
        onClick={() => {
          // Phase 20: land on the SPECIFIC pending trusted-person row, not just the page top.
          try { sessionStorage.setItem('cp_scroll_pending_tp', '1'); } catch {}
          onGoToProfile();
        }}>
        Verify now
      </button>
      <button className="link-btn" style={{fontSize:'0.78rem'}} onClick={() => setDismissed(true)}>Dismiss</button>
    </div>
  );
}

// ─── Trusted People (Phase 17) ───
// The approval list used by step-up verification (Phase 18 wires it into gated actions).
// Add → email OTP → active. Each person enrolls their OWN authenticator (distinct secret).
export function TrustedPeopleSection() {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addForm, setAddForm] = useState({ name: '', email: '' });
  const [busy, setBusy] = useState(false);
  // OTP verification modal: { person, dev_code? }
  const [verify, setVerify] = useState(null);
  const [otpCode, setOtpCode] = useState('');
  // TOTP enrollment modal: { person, qr, otpauth_url }
  const [enroll, setEnroll] = useState(null);
  const [totpCode, setTotpCode] = useState('');
  const [removeTarget, setRemoveTarget] = useState(null);

  // Row briefly highlighted after "Verify now" on the banner deep-links here (Phase 20).
  const [highlightId, setHighlightId] = useState(null);

  const load = async () => {
    try {
      const res = await apiFetch(`${API_URL}/trusted-people`);
      if (res.ok) {
        const list = await res.json();
        setPeople(list);
        // Banner deep-link: scroll to the first unverified entry (the owner's bootstrap
        // entry first) and highlight it.
        let wantScroll = false;
        try { wantScroll = sessionStorage.getItem('cp_scroll_pending_tp') === '1'; } catch {}
        if (wantScroll) {
          try { sessionStorage.removeItem('cp_scroll_pending_tp'); } catch {}
          const target = list.find(p => !p.email_verified && p.is_bootstrap) || list.find(p => !p.email_verified);
          if (target) {
            setHighlightId(String(target.person_id));
            setTimeout(() => {
              document.getElementById(`tp-row-${target.person_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 120);
            setTimeout(() => setHighlightId(null), 4200);
          }
        }
      }
    } catch {}
    setLoading(false);
  };
  useEffect(() => {
    load();
    // Account Information saves sync the bootstrap entry — reload when that happens.
    const onRefresh = () => load();
    window.addEventListener('trusted-people-refresh', onRefresh);
    return () => window.removeEventListener('trusted-people-refresh', onRefresh);
  }, []);

  // List management is step-up-gated once someone CAN approve (Phase 18); the very first
  // add (no active people yet) stays open — otherwise no one could ever be enrolled.
  const [stepUpAsk, setStepUpAsk] = useState(null);
  const needsApproval = people.some(p => p.is_active);

  const doAdd = async (auth) => {
    setBusy(true);
    try {
      const res = await apiFetch(`${API_URL}/trusted-people`, {
        method: 'POST',
        headers: auth ? { 'x-step-up-token': auth.step_up_token } : {},
        body: JSON.stringify(addForm)
      });
      const data = await res.json();
      if (res.ok) {
        setAddForm({ name: '', email: '' });
        setVerify({ person: data.person });
        setOtpCode('');
        showToast(data.email_sent ? `Verification code sent to ${data.person.email}.` : (data.message || 'Could not send the email.'), data.email_sent ? 'success' : 'info');
        load();
      } else showToast(data.error || 'Could not add person.');
    } catch {}
    setBusy(false);
  };

  const addPerson = (e) => {
    e.preventDefault();
    if (!addForm.name.trim() || !addForm.email.trim()) { showToast('Name and email are required.'); return; }
    if (needsApproval) {
      setStepUpAsk({ title: `Approve adding ${addForm.name.trim()}`, context: `add trusted person "${addForm.name.trim()}" (${addForm.email.trim()})`, action: (auth) => doAdd(auth) });
    } else {
      doAdd(null);
    }
  };

  const resend = async (person) => {
    try {
      const res = await apiFetch(`${API_URL}/trusted-people/${person.person_id}/resend-otp`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) { setVerify({ person }); setOtpCode(''); showToast(data.message, data.email_sent ? 'success' : 'info'); }
      else showToast(data.error || 'Could not send code.');
    } catch {}
  };

  const confirmOtp = async () => {
    if (!verify) return;
    try {
      const res = await apiFetch(`${API_URL}/trusted-people/${verify.person.person_id}/verify-email`, {
        method: 'POST', body: JSON.stringify({ code: otpCode })
      });
      const data = await res.json();
      if (res.ok) { showToast(data.message, 'success'); setVerify(null); setOtpCode(''); load(); }
      else showToast(data.error || 'Verification failed.');
    } catch {}
  };

  const startEnroll = async (person) => {
    try {
      const res = await apiFetch(`${API_URL}/trusted-people/${person.person_id}/totp/enroll`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) { setEnroll({ person, qr: data.qr, otpauth_url: data.otpauth_url }); setTotpCode(''); }
      else showToast(data.error || 'Could not start enrollment.');
    } catch {}
  };

  // Phase 27: re-scan an already-enrolled authenticator on demand (e.g. the owner picked
  // "Not now" during an email-change rotation, or reinstalled their app). Uses the pending-secret
  // rotation, so the existing code keeps working until the new QR is confirmed.
  const [rescanRotation, setRescanRotation] = useState(null);
  const rescanAuthenticator = async (person) => {
    try {
      const res = await apiFetch(`${API_URL}/trusted-people/${person.person_id}/totp/rotation/begin`, { method: 'POST' });
      if (!res.ok) { showToast(await apiErrorMessage(res, 'Could not start re-scan.')); return; }
      setRescanRotation(await res.json());
    } catch {}
  };

  const confirmEnroll = async () => {
    if (!enroll) return;
    try {
      const res = await apiFetch(`${API_URL}/trusted-people/${enroll.person.person_id}/totp/confirm`, {
        method: 'POST', body: JSON.stringify({ code: totpCode })
      });
      const data = await res.json();
      if (res.ok) { showToast(data.message, 'success'); setEnroll(null); setTotpCode(''); load(); }
      else showToast(data.error || 'Code didn\'t match.');
    } catch {}
  };

  const doRemove = () => {
    const p = removeTarget;
    setRemoveTarget(null);
    const run = async (auth) => {
      try {
        const res = await apiFetch(`${API_URL}/trusted-people/${p.person_id}`, {
          method: 'DELETE', headers: auth ? { 'x-step-up-token': auth.step_up_token } : {}
        });
        const data = await res.json();
        if (res.ok) { showToast(data.message, 'success'); load(); }
        else showToast(data.error || 'Could not remove.');
      } catch {}
    };
    if (needsApproval) setStepUpAsk({ title: `Approve removing ${p.name}`, context: `remove trusted person "${p.name}" (${p.email}) — they will no longer be able to approve actions`, action: run });
    else run(null);
  };

  return (
    <div className="card">
      <h2>🛡️ Trusted People</h2>
      <p style={{color:'var(--text-muted)', fontSize:'0.82rem', marginTop:'-0.5rem', marginBottom:'1rem'}}>
        Up to 5 people who can approve sensitive actions — by a code emailed to them, or with their own
        Google Authenticator (each person scans their own QR; codes are never shared).
      </p>
      {loading ? <Spinner label="Loading…" /> : (
        <>
          {people.length > 0 && (
            <div className="table-container" style={{marginBottom:'1rem'}}>
              <table>
                <thead><tr><th>Name</th><th>Email</th><th>Email Verified</th><th>Authenticator</th><th>Added</th><th>Actions</th></tr></thead>
                <tbody>
                  {people.map(p => (
                    <tr key={p.person_id} id={`tp-row-${p.person_id}`}
                      style={highlightId === String(p.person_id) ? { background:'#FEF3C7', transition:'background 0.4s' } : undefined}>
                      <td>
                        <strong>{p.name}</strong>
                        {p.is_bootstrap && <span className="badge" style={{marginLeft:'0.4rem', fontSize:'0.62rem', background:'#dbeafe', color:'#2563EB'}}>👑 Owner</span>}
                        {!p.is_active && <span className="badge badge-warning" style={{marginLeft:'0.4rem', fontSize:'0.62rem'}}>Pending</span>}
                      </td>
                      <td>{p.email}</td>
                      <td>{p.email_verified
                        ? <span className="badge badge-success">✓ Verified</span>
                        : <button className="link-btn" style={{fontSize:'0.8rem'}} onClick={() => resend(p)}>Send code</button>}</td>
                      <td>{p.totp_enabled
                        ? <span style={{display:'inline-flex', alignItems:'center', gap:'0.5rem', flexWrap:'wrap'}}>
                            <span className="badge badge-success">✓ Enrolled</span>
                            <button className="link-btn" style={{fontSize:'0.75rem'}}
                              title="Scan a new QR code for this authenticator. The current code keeps working until you confirm the new one."
                              onClick={() => rescanAuthenticator(p)}>Re-scan</button>
                          </span>
                        : p.is_active
                          ? <button className="link-btn" style={{fontSize:'0.8rem'}} onClick={() => startEnroll(p)}>Enroll</button>
                          : <span style={{color:'var(--text-muted)', fontSize:'0.8rem'}}>Verify email first</span>}</td>
                      <td>{formatDate(p.added_at)}</td>
                      <td>
                        {p.is_bootstrap ? (
                          <span style={{color:'var(--text-muted)', fontSize:'0.75rem'}}
                            title="The account owner's entry follows Account Information and cannot be edited or removed here.">
                            Account owner — cannot be removed
                          </span>
                        ) : (
                          <button className="btn btn-danger" style={{padding:'0.2rem 0.55rem', fontSize:'0.78rem'}}
                            onClick={() => setRemoveTarget(p)}>Remove</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {people.length < 5 && (
            <form onSubmit={addPerson} className="form-row" style={{alignItems:'flex-end'}}>
              <div className="form-group" style={{marginBottom:0}}>
                <label>Name</label>
                <input className="form-control" value={addForm.name}
                  onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="Person's name" />
              </div>
              <div className="form-group" style={{marginBottom:0}}>
                <label>Email</label>
                <input type="email" className="form-control" value={addForm.email}
                  onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} placeholder="their@email.com" />
              </div>
              <button type="submit" className="btn btn-primary" disabled={busy} style={{flex:'0 0 auto'}}>
                {busy ? 'Sending…' : '+ Add Trusted Person'}
              </button>
            </form>
          )}
        </>
      )}

      {/* Email OTP verification */}
      {verify && (
        <Modal title={`Verify ${verify.person.name}'s email`} onClose={() => setVerify(null)}>
          <p style={{fontSize:'0.88rem'}}>Enter the 6-digit code sent to <strong>{verify.person.email}</strong>.</p>
          <input className="form-control" style={{fontSize:'1.3rem', letterSpacing:'0.4rem', textAlign:'center', maxWidth:'220px'}}
            maxLength={6} value={otpCode} placeholder="••••••"
            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmOtp(); } }} autoFocus />
          <div className="btn-group" style={{marginTop:'1rem'}}>
            <button className="btn btn-primary" onClick={confirmOtp} disabled={otpCode.length !== 6}>Verify</button>
            <button className="btn btn-secondary" onClick={() => resend(verify.person)}>Resend code</button>
            <button className="btn btn-secondary" onClick={() => setVerify(null)}>Later</button>
          </div>
        </Modal>
      )}

      {/* TOTP enrollment */}
      {enroll && (
        <Modal title={`Authenticator for ${enroll.person.name}`} onClose={() => setEnroll(null)}>
          <p style={{fontSize:'0.88rem'}}>
            1. Open <strong>Google Authenticator</strong> on {enroll.person.name}'s phone.<br/>
            2. Scan this QR code (it holds {enroll.person.name}'s own secret — no one else's).<br/>
            3. Enter the 6-digit code the app shows to finish.
          </p>
          <div style={{textAlign:'center', margin:'0.75rem 0'}}>
            <img src={enroll.qr} alt="TOTP QR code" style={{width:'190px', height:'190px', border:'1px solid var(--border)', borderRadius:'8px'}} />
          </div>
          <input className="form-control" style={{fontSize:'1.3rem', letterSpacing:'0.4rem', textAlign:'center', maxWidth:'220px', margin:'0 auto'}}
            maxLength={6} value={totpCode} placeholder="••••••"
            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmEnroll(); } }} />
          <div className="btn-group" style={{marginTop:'1rem', justifyContent:'center'}}>
            <button className="btn btn-primary" onClick={confirmEnroll} disabled={totpCode.length !== 6}>Confirm</button>
            <button className="btn btn-secondary" onClick={() => setEnroll(null)}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* Phase 27: on-demand re-scan reuses the email-change rotation modal (old code stays
          valid until the new QR is confirmed). */}
      {rescanRotation && (
        <TotpRotationModal rotation={rescanRotation} onDone={() => { setRescanRotation(null); load(); }} />
      )}

      {removeTarget && (
        <ConfirmModal
          title="Remove trusted person?"
          message={`Remove ${removeTarget.name} (${removeTarget.email}) from the trusted people list? They will no longer be able to approve actions.`}
          confirmLabel={needsApproval ? 'Continue to approval' : 'Remove'}
          onConfirm={doRemove}
          onCancel={() => setRemoveTarget(null)}
        />
      )}
      {stepUpAsk && (
        <StepUpVerificationModal title={stepUpAsk.title} context={stepUpAsk.context}
          message="Changing the trusted people list needs approval from a trusted person."
          onVerified={(auth) => { const a = stepUpAsk; setStepUpAsk(null); a.action(auth); }}
          onClose={() => setStepUpAsk(null)} />
      )}
    </div>
  );
}

// ─── Active Sessions / Devices (Phase 17) ───
export function SessionsSection({ onLoggedOut }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [revokeTarget, setRevokeTarget] = useState(null);

  const load = async () => {
    try {
      const res = await apiFetch(`${API_URL}/auth/sessions`);
      if (res.ok) setSessions(await res.json());
    } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Short readable browser/OS summary out of the raw user-agent string.
  const deviceLabel = (ua) => {
    if (!ua) return 'Unknown device';
    const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
    return `${browser}${os ? ' · ' + os : ''}`;
  };

  const doRevoke = async () => {
    const s = revokeTarget;
    setRevokeTarget(null);
    try {
      const res = await apiFetch(`${API_URL}/auth/sessions/${s.sid}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message, 'success');
        if (s.is_current) { onLoggedOut(); return; } // revoked ourselves — back to login
        load();
      } else showToast(data.error || 'Could not revoke.');
    } catch {}
  };

  return (
    <div className="card">
      <h2>💻 Currently Logged In Devices</h2>
      <p style={{color:'var(--text-muted)', fontSize:'0.82rem', marginTop:'-0.5rem', marginBottom:'1rem'}}>
        Every device with an active login. Revoking one immediately signs that device out.
      </p>
      {loading ? <Spinner label="Loading sessions…" /> : sessions.length === 0 ? (
        <p style={{color:'var(--text-muted)'}}>No active sessions.</p>
      ) : (
        <div className="table-container">
          <table>
            <thead><tr><th>Device</th><th>IP</th><th>Last Active</th><th>Signed In</th><th>Expires</th><th></th></tr></thead>
            <tbody>
              {sessions.map(s => (
                <tr key={s.sid}>
                  <td title={s.device}>
                    <strong>{deviceLabel(s.device)}</strong>
                    {s.is_current && <span className="badge badge-success" style={{marginLeft:'0.4rem', fontSize:'0.62rem'}}>This device</span>}
                    {s.remember && <span className="badge" style={{marginLeft:'0.4rem', fontSize:'0.62rem', background:'#dbeafe', color:'#2563EB'}}>Remembered</span>}
                  </td>
                  <td>{s.ip || '—'}</td>
                  <td>{formatDateTime(s.last_active)}</td>
                  <td>{formatDateTime(s.created_at)}</td>
                  <td>{formatDate(s.expires_at)}</td>
                  <td>
                    <button className="btn btn-danger" style={{padding:'0.2rem 0.55rem', fontSize:'0.78rem'}}
                      onClick={() => setRevokeTarget(s)}>Revoke</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {revokeTarget && (
        <ConfirmModal
          title={revokeTarget.is_current ? 'Sign out this device?' : 'Revoke this session?'}
          message={revokeTarget.is_current
            ? 'This is the device you are using right now — you will be signed out immediately.'
            : `Sign out ${deviceLabel(revokeTarget.device)} (${revokeTarget.ip || 'unknown IP'})? That device will need to log in again.`}
          confirmLabel={revokeTarget.is_current ? 'Sign me out' : 'Revoke'}
          onConfirm={doRevoke}
          onCancel={() => setRevokeTarget(null)}
        />
      )}
    </div>
  );
}

// Dashboard Component
export function Dashboard({ onNavigate }) {
  const [stats, setStats] = useState(null);
  const [overLimitCustomers, setOverLimitCustomers] = useState([]);
  const [cylinderStock, setCylinderStock] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [statsRes, overLimitRes, cylinderStockRes] = await Promise.all([
        apiFetch(`${API_URL}/dashboard/stats`),
        apiFetch(`${API_URL}/dashboard/over-limit`),
        apiFetch(`${API_URL}/dashboard/cylinder-stock`)
      ]);
      setStats(await statsRes.json());
      setOverLimitCustomers(await overLimitRes.json());
      setCylinderStock(await cylinderStockRes.json());
      setLoading(false);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      setLoading(false);
    }
  };

  if (loading) {
    return <Spinner label="Loading dashboard…" />;
  }

  // Phase 25: every card becomes a click-through. Content, colour, icon and layout are
  // unchanged — the only additions are cursor/role/keyboard affordances, so the cards look
  // exactly as before. No trend indicators, no sparklines.
  const cardProps = (label, go) => ({
    className: undefined, // set by caller
    role: 'button',
    tabIndex: 0,
    title: label,
    style: { cursor: 'pointer' },
    onClick: go,
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }
  });

  return (
    <div>
      {/* Phase 26: bento layout. Tile order, content, values, icons and click-through targets
          are exactly as Phase 25 left them — only the grid placement classes are new.
          4 cols: [4 KPIs] / [2 KPIs + in-stock×2] / [chart×2 + chart×2]. */}
      <div className="bento-grid">
        <div {...cardProps('View outstanding receivables', () => onNavigate('outstanding'))} className="stat-card green">
          <div className="stat-icon">💸</div>
          <div className="stat-body">
            <h3>Outstanding</h3>
            <div className="value">₹{(stats?.total_outstanding || 0).toFixed(0)}</div>
          </div>
        </div>
        <div {...cardProps('View all customers', () => onNavigate('customers'))} className="stat-card blue">
          <div className="stat-icon">👥</div>
          <div className="stat-body">
            <h3>Customers</h3>
            <div className="value">{stats?.total_customers || 0}</div>
          </div>
        </div>
        <div {...cardProps('View cylinders at customers', () => onNavigate('cylinders', { stateFilters: ['AT_CUSTOMER'] }))} className="stat-card orange">
          <div className="stat-icon">🔵</div>
          <div className="stat-body">
            <h3>Cylinders Out</h3>
            <div className="value">{stats?.total_cylinders_out || 0}</div>
          </div>
        </div>
        <div {...cardProps('View customers over their holding limit', () => onNavigate('customers', { statusFilter: 'OVER_LIMIT' }))} className="stat-card purple">
          <div className="stat-icon">⚠️</div>
          <div className="stat-body">
            <h3>Over Limit</h3>
            <div className="value">{overLimitCustomers.length}</div>
          </div>
        </div>
        <div {...cardProps("View today's transactions", () => onNavigate('transactions', { dateFilter: todayISO() }))} className="stat-card green">
          <div className="stat-icon">📋</div>
          <div className="stat-body">
            <h3>Today's Bills</h3>
            <div className="value">{stats?.today_transactions || 0}</div>
          </div>
        </div>
        <div {...cardProps('View customers and their deposits', () => onNavigate('customers'))} className="stat-card blue">
          <div className="stat-icon">🏦</div>
          <div className="stat-body">
            <h3>Security Deposit</h3>
            <div className="value">₹{(stats?.total_security_deposit || 0).toFixed(0)}</div>
          </div>
        </div>
        <div {...cardProps('View cylinders in stock', () => onNavigate('cylinders', { stateFilters: ['IN_STOCK'] }))} className="stat-card green bento-wide">
          <div className="stat-icon">🏭</div>
          <div className="stat-body">
            <h3>Cylinders in Stock</h3>
            <div className="value">{cylinderStock?.cylindersAtPlant || 0}</div>
            <div style={{fontSize:'0.72rem', color:'var(--text-muted)', marginTop:'0.25rem'}}>
              {cylinderStock?.cylindersAtPlant || 0} in stock / {cylinderStock?.totalCylinders || 0} total · {cylinderStock?.cylindersInRotation || 0} at customer
            </div>
          </div>
        </div>

        <DashboardCharts stock={cylinderStock} onNavigate={onNavigate} />
      </div>

      <div className="card">
        <h2>Quick Actions</h2>
        <div className="quick-actions-grid">
          <button className="quick-action-btn" onClick={() => onNavigate('new-transaction')}>
            <span className="qa-icon">🧾</span>
            <span className="qa-title">New Transaction</span>
            <span className="qa-sub">Create bill / delivery</span>
          </button>
          <button className="quick-action-btn" onClick={() => onNavigate('payments')}>
            <span className="qa-icon">💰</span>
            <span className="qa-title">Record Payment</span>
            <span className="qa-sub">Mark payment received</span>
          </button>
          <button className="quick-action-btn" onClick={() => onNavigate('outstanding')}>
            <span className="qa-icon">📊</span>
            <span className="qa-title">Outstanding Dues</span>
            <span className="qa-sub">View money to collect</span>
          </button>
          <button className="quick-action-btn" onClick={() => onNavigate('customers')}>
            <span className="qa-icon">👥</span>
            <span className="qa-title">Customers</span>
            <span className="qa-sub">Manage customer list</span>
          </button>
          <button className="quick-action-btn" onClick={() => onNavigate('aging-report')}>
            <span className="qa-icon">⏱️</span>
            <span className="qa-title">Cylinders Out (Aging)</span>
            <span className="qa-sub">How long cylinders have been out</span>
          </button>
        </div>
      </div>

      {overLimitCustomers.length > 0 && (
        <div className="card">
          <h2>⚠️ Over Limit Alert</h2>
          <div className="alert alert-warning">
            {overLimitCustomers.length} customer(s) are currently over their holding limit
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Customer Name</th>
                  <th>Cylinders Held</th>
                  <th>Holding Limit</th>
                  <th>Over By</th>
                  <th>Contact</th>
                </tr>
              </thead>
              <tbody>
                {overLimitCustomers.map(customer => (
                  <tr key={customer.customer_id} className="row-over-limit">
                    <td>{customer.company_name}</td>
                    <td>{customer.cylinders_held}</td>
                    <td>{customer.holding_limit}</td>
                    <td><strong>{customer.cylinders_held - customer.holding_limit}</strong></td>
                    <td>{displayContact(customer.phone_primary)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// Customer Master Component
export function CustomerMaster({ onNavigate, onSelectCustomer, initialFilter = null, onFilterConsumed }) {
  const [showForm, setShowForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState(initialFilter?.searchTerm || '');
  const debouncedSearch = useDebounce(searchTerm, 300);
  // Seeded from a dashboard KPI click, then cleared so it does not reapply on the next visit.
  const [statusFilter, setStatusFilter] = useState(initialFilter?.statusFilter || '');
  useEffect(() => { if (initialFilter && onFilterConsumed) onFilterConsumed(); }, []);

  // Search and status are sent to the server, so they always match against all customers —
  // not just the batch currently on screen.
  const buildUrl = (page, limit) => {
    let url = `${API_URL}/customers?page=${page}&limit=${limit}&`;
    if (debouncedSearch) url += `search=${encodeURIComponent(debouncedSearch)}&`;
    if (statusFilter) url += `status=${statusFilter}`;
    return url;
  };
  const {
    rows: customers, total, loading, loadingAll, loadedAll, loadAll, reload: fetchCustomers
  } = useBatchList(buildUrl, [debouncedSearch, statusFilter]);

  const [custOpen, setCustOpen] = useState(false);

  // Phase 26: reverse a soft delete. Only flips is_hidden — no bill, payment or transaction is
  // read or written on either side of hide/unhide.
  const [unhiding, setUnhiding] = useState(null);
  const unhideCustomer = async (customer) => {
    setUnhiding(customer.customer_id);
    try {
      const res = await apiFetch(`${API_URL}/customers/${customer.customer_id}/hidden`, {
        method: 'PATCH', body: JSON.stringify({ hidden: false })
      });
      if (!res.ok) { showToast(await apiErrorMessage(res, 'Could not unhide this customer.')); return; }
      const data = await res.json();
      showToast(data.message, 'success');
      fetchCustomers();
    } finally { setUnhiding(null); }
  };

  // Deposit and Status stay visible inside Customer Detail only (Phase 7).
  const custColumns = [
    { header: 'Sr. No.', cell: (c, i) => i + 1 },
    { header: 'Customer Name', cell: (c) => <span className="clickable" onClick={() => { onSelectCustomer(c.customer_id); onNavigate('customer-detail'); }}>{c.company_name}{c.is_filling_vendor ? ' 🏭' : ''}</span> },
    { header: 'Contact Person', cell: (c) => c.contact_person || '-' },
    { header: 'Phone', cell: (c) => displayContact(c.phone_primary) || '-' },
    { header: 'GST No.', cell: (c) => c.gst_number || '-' },
    { header: 'Holding Limit', cell: (c) => c.is_filling_vendor ? 'Unlimited' : c.holding_limit },
    { header: 'Cylinders Held', cell: (c) => c.cylinders_held },
    { header: 'Bill Amount', cell: (c) => `₹${(c.current_bill_amount || 0).toFixed(2)}` },
    { header: 'Action', cell: (c) => (
        <button className="btn btn-primary" style={{padding:'0.25rem 0.6rem', fontSize:'0.85rem'}}
          onClick={() => { setCustOpen(false); onSelectCustomer(c.customer_id); onNavigate('customer-detail'); }}>View Detail</button>
      ) }
  ];

  // NOTE: deliberately no `if (loading) return <Spinner/>` here. That early return sits above
  // the search input, so every debounced search refetch unmounted the input mid-typing and the
  // caret was lost after the first character. The spinner now renders in place of the table
  // only (see below), which keeps the input mounted and focused throughout.

  return (
    <div>
      <div className="card">
        <h2>Customer Master</h2>

        <div className="btn-group">
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : 'Add New Customer'}
          </button>
        </div>

        {showForm && (
          <CustomerForm
            onSuccess={() => {
              setShowForm(false);
              fetchCustomers();
            }}
            onCancel={() => setShowForm(false)}
          />
        )}
      </div>

      <div className="card">
        <div className="search-bar sticky">
          <input
            type="text"
            placeholder="Search by name, contact, or GST..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="form-control"
          />
        </div>

        <div className="btn-group">
          <button
            className={`btn ${statusFilter === '' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setStatusFilter('')}
          >All</button>
          <button
            className={`btn ${statusFilter === 'ACTIVE' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setStatusFilter('ACTIVE')}
          >Active</button>
          <button
            className={`btn ${statusFilter === 'OVER_LIMIT' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setStatusFilter('OVER_LIMIT')}
          >Over Limit</button>
          <button
            className={`btn ${statusFilter === 'ZERO_BALANCE' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setStatusFilter('ZERO_BALANCE')}
          >Zero Balance</button>
          <button
            className={`btn ${statusFilter === 'FILLING_VENDOR' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setStatusFilter('FILLING_VENDOR')}
          >🏭 Filling Vendor</button>
          {/* Phase 26: the dedicated view for reversing a soft delete. */}
          <button
            className={`btn ${statusFilter === 'HIDDEN' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setStatusFilter(statusFilter === 'HIDDEN' ? '' : 'HIDDEN')}
            title="Show customers that were hidden with Delete → Hide Customer"
          >🙈 Hidden</button>
        </div>

        {statusFilter === 'HIDDEN' && (
          <div className="alert" style={{ fontSize: '0.82rem' }}>
            These customers are hidden from active lists, search and transaction pickers. Their
            bills, payments and history are untouched — unhiding restores them exactly as they were.
          </div>
        )}

        <div style={{display:'flex', justifyContent:'flex-end', marginBottom:'0.5rem'}}>
          <button className="btn btn-secondary" onClick={() => exportToExcel(
            customers.map((c,i) => ({
              'Sr.': i+1,
              'Company Name': c.company_name,
              'Contact Person': c.contact_person || '',
              'Phone': displayContact(c.phone_primary),
              'Holding Limit': c.is_filling_vendor ? 'Unlimited' : (c.holding_limit || 0),
              'Cylinders Held': c.cylinders_held || 0,
              'Bill Amount': c.current_bill_amount || 0,
              'Security Deposit': c.security_deposit || 0,
              'Status': c.status || ''
            })), getExportFileName('default', { pageName: 'Customers' }), 'Customers'
          )}>Export Excel</button>
        </div>
        {loading ? (
          <Spinner label="Loading customers…" />
        ) : customers.length === 0 ? (
          <EmptyState icon="👥" message="No customers found" hint={searchTerm || statusFilter ? 'Try clearing the search or filters.' : 'Add your first customer above.'} />
        ) : (
        <div className="table-container" style={{marginTop: '1rem'}}>
          <table>
            <thead>
              <tr>
                <th>Sr. No.</th>
                <th>Customer Name</th>
                <th>Contact Person</th>
                <th>Phone</th>
                <th>Holding Limit</th>
                <th>Cylinders Held</th>
                <th>Bill Amount</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer, index) => (
                <tr
                  key={customer.customer_id}
                  className={customer.status === 'OVER LIMIT' ? 'row-over-limit' :
                             customer.current_bill_amount < 0 ? 'row-credit' : ''}
                >
                  <td>{index + 1}</td>
                  <td>{customer.company_name}{customer.is_filling_vendor ? ' 🏭' : ''}</td>
                  <td>{customer.contact_person}</td>
                  <td>{customer.phone_primary}</td>
                  <td>{customer.is_filling_vendor ? 'Unlimited' : customer.holding_limit}</td>
                  <td>{customer.cylinders_held}</td>
                  <td>₹{customer.current_bill_amount?.toFixed(2)}</td>
                  <td>
                    <div style={{display:'flex', gap:'0.4rem', flexWrap:'wrap'}}>
                      <button
                        className="btn btn-primary"
                        onClick={() => {
                          onSelectCustomer(customer.customer_id);
                          onNavigate('customer-detail');
                        }}
                      >
                        View Detail
                      </button>
                      {customer.is_hidden && (
                        <button className="btn btn-secondary" disabled={unhiding === customer.customer_id}
                          title="Restore this customer to active lists, search and pickers"
                          onClick={() => unhideCustomer(customer)}>
                          {unhiding === customer.customer_id ? 'Unhiding…' : '↩ Unhide'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <BatchListFooter shown={customers.length} total={total} loadedAll={loadedAll}
            loadingAll={loadingAll} onLoadAll={loadAll} noun="customers" />
        </div>
        )}
      </div>

      {custOpen && (
        <ListModal
          title="All Customers"
          items={customers}
          columns={custColumns}
          searchKeys={['company_name', 'contact_person', 'phone_primary', 'gst_number']}
          searchPlaceholder="Search by name, contact, phone, or GST…"
          onClose={() => setCustOpen(false)}
        />
      )}
    </div>
  );
}

// Customer Form Component
export function CustomerForm({ onSuccess, onCancel, customer = null }) {
  const [formData, setFormData] = useState({
    company_name: customer?.company_name || '',
    contact_person: customer?.contact_person || '',
    phone_primary: customer?.phone_primary || '',
    phone_alternate: customer?.phone_alternate || '',
    address: customer?.address || '',
    gst_number: customer?.gst_number || '',
    security_deposit: customer?.security_deposit || 0,
    holding_limit: customer?.holding_limit || 0,
    is_filling_vendor: !!customer?.is_filling_vendor,
    is_active: customer?.is_active !== undefined ? customer.is_active : 1
  });

  // Delete flow (Phase 24): null → 'choose' → 'hide-confirm' | 'hard-confirm'.
  const [deleteMode, setDeleteMode] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const handleHide = async () => {
    setDeleteBusy(true);
    try {
      const res = await apiFetch(`${API_URL}/customers/${customer.customer_id || customer._id}/hidden`, {
        method: 'PATCH',
        body: JSON.stringify({ hidden: true })
      });
      if (!res.ok) { showToast(await apiErrorMessage(res, 'Could not hide this customer.')); return; }
      const data = await res.json();
      showToast(data.message, 'success');
      setDeleteMode(null);
      onSuccess && onSuccess();
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleHardDelete = async () => {
    setDeleteBusy(true);
    try {
      const res = await apiFetch(
        `${API_URL}/customers/${customer.customer_id || customer._id}?confirm=DELETE`,
        { method: 'DELETE' }
      );
      if (!res.ok) { showToast(await apiErrorMessage(res, 'Could not delete this customer.')); return; }
      const data = await res.json();
      const d = data.deleted || {};
      showToast(
        `${data.message} (${d.bills || 0} bills, ${d.payments || 0} payments, ${d.rental_charges || 0} rental charges)`,
        'success'
      );
      setDeleteMode(null);
      onSuccess && onSuccess({ deleted: true });
    } finally {
      setDeleteBusy(false);
    }
  };

  // Up to 4 additional contacts (5 total incl. primary). Each: { name?, number }
  const [additionalContacts, setAdditionalContacts] = useState(
    Array.isArray(customer?.additional_contacts) ? customer.additional_contacts.map(c => ({ name: c.name || '', number: c.number || '' })) : []
  );

  const addContact = () => {
    if (additionalContacts.length >= 4) return;
    setAdditionalContacts([...additionalContacts, { name: '', number: '' }]);
  };
  const removeContact = (idx) => {
    setAdditionalContacts(additionalContacts.filter((_, i) => i !== idx));
  };
  const updateContact = (idx, field, value) => {
    setAdditionalContacts(additionalContacts.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  };

  const [errors, setErrors] = useState({});

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!formData.company_name.trim()) errs.company_name = 'Company / customer name is required';
    if (!formData.contact_person.trim()) errs.contact_person = 'Contact person is required';
    if (!formData.phone_primary.trim()) errs.phone_primary = 'Primary contact number is required';
    if (!String(formData.address).trim()) errs.address = 'Address is required';
    // Filling vendors have no holding limit (Phase 15) — the field is hidden and never required.
    if (!formData.is_filling_vendor && (formData.holding_limit === '' || formData.holding_limit === null || isNaN(formData.holding_limit))) errs.holding_limit = 'Holding limit is required';
    if (additionalContacts.some(c => !c.number || !c.number.trim())) errs.additional_contacts = 'Each additional contact must have a contact number (name is optional).';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const cleanedContacts = additionalContacts
      .filter(c => c.number && c.number.trim())
      .map(c => ({ name: (c.name || '').trim(), number: c.number.trim() }));
    try {
      const url = customer
        ? `${API_URL}/customers/${customer.customer_id}`
        : `${API_URL}/customers`;
      const method = customer ? 'PUT' : 'POST';

      const response = await apiFetch(url, {
        method,
        body: JSON.stringify({ ...formData, additional_contacts: cleanedContacts })
      });

      if (response.ok) {
        showToast(customer ? 'Customer updated successfully.' : 'Customer added successfully.', 'success');
        onSuccess();
      } else {
        showToast(await apiErrorMessage(response, 'Error saving customer'));
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate style={{marginTop: '1rem'}}>
      <div className="form-group">
        <label>Company / Customer Name *</label>
        <input type="text" name="company_name" value={formData.company_name}
          onChange={handleChange} className={`form-control ${errors.company_name ? 'input-error' : ''}`} />
        {errors.company_name && <div className="field-error">{errors.company_name}</div>}
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Contact Person *</label>
          <input type="text" name="contact_person" value={formData.contact_person}
            onChange={handleChange} className={`form-control ${errors.contact_person ? 'input-error' : ''}`} />
          {errors.contact_person && <div className="field-error">{errors.contact_person}</div>}
        </div>
        <div className="form-group">
          <label>Primary Contact Number *</label>
          <input type="tel" name="phone_primary" value={formData.phone_primary}
            onChange={handleChange} className={`form-control ${errors.phone_primary ? 'input-error' : ''}`} />
          {errors.phone_primary && <div className="field-error">{errors.phone_primary}</div>}
        </div>
      </div>

      <div className="form-group">
        <label>Telephone Number</label>
        <input type="tel" name="phone_alternate" value={formData.phone_alternate}
          onChange={handleChange} className="form-control" />
      </div>

      {/* Additional contacts — up to 4 extra (5 total incl. primary) */}
      <div className="form-group">
        <label>Additional Contacts</label>
        {additionalContacts.map((c, idx) => (
          <div key={idx} className="form-row" style={{alignItems:'flex-end', marginBottom:'0.5rem'}}>
            <div className="form-group" style={{marginBottom:0}}>
              <input type="text" placeholder="Name (optional)" value={c.name}
                onChange={(e) => updateContact(idx, 'name', e.target.value)} className="form-control" />
            </div>
            <div className="form-group" style={{marginBottom:0}}>
              <input type="tel" placeholder="Contact Number *" value={c.number}
                onChange={(e) => updateContact(idx, 'number', e.target.value)} className="form-control" />
            </div>
            <button type="button" className="btn btn-danger" style={{flex:'0 0 auto'}}
              onClick={() => removeContact(idx)} title="Remove contact">✕</button>
          </div>
        ))}
        {errors.additional_contacts && <div className="field-error">{errors.additional_contacts}</div>}
        {additionalContacts.length < 4 && (
          <button type="button" className="btn btn-secondary" style={{marginTop:'0.25rem'}} onClick={addContact}>
            + Add Contact
          </button>
        )}
      </div>

      <div className="form-group">
        <label>Address *</label>
        <textarea name="address" value={formData.address}
          onChange={handleChange} className={`form-control ${errors.address ? 'input-error' : ''}`} rows="3" />
        {errors.address && <div className="field-error">{errors.address}</div>}
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>GST Number</label>
          <input type="text" name="gst_number" value={formData.gst_number}
            onChange={handleChange} className="form-control" />
        </div>
        <div className="form-group">
          <label>Security Deposit</label>
          <input type="number" name="security_deposit" value={formData.security_deposit}
            onChange={handleChange} className="form-control" min="0" step="0.01" />
        </div>
      </div>

      {/* Hidden for filling vendors (Phase 15): their holding limit is unlimited by definition. */}
      {!formData.is_filling_vendor ? (
        <div className="form-group">
          <label>Holding Limit (Max Cylinders) *</label>
          <input type="number" name="holding_limit" value={formData.holding_limit}
            onChange={handleChange} className={`form-control ${errors.holding_limit ? 'input-error' : ''}`} min="0" />
          {errors.holding_limit && <div className="field-error">{errors.holding_limit}</div>}
        </div>
      ) : (
        <div className="form-group">
          <label>Holding Limit</label>
          <div style={{padding:'0.5rem 0.75rem', background:'var(--surface-alt, #f8f9fa)', border:'1px dashed var(--border)',
            borderRadius:'var(--radius-sm, 6px)', color:'var(--text-muted)', fontSize:'0.9rem'}}>
            ∞ Unlimited — filling vendors have no holding limit
          </div>
        </div>
      )}

      {/* Filling vendor (Phase 11): third-party filling station / partner. */}
      <div className="form-group">
        <label style={{display:'flex', alignItems:'center', gap:'0.5rem', cursor:'pointer'}}>
          <input type="checkbox" checked={!!formData.is_filling_vendor}
            onChange={(e) => setFormData(prev => ({ ...prev, is_filling_vendor: e.target.checked }))} />
          🏭 Filling Vendor
        </label>
        <small style={{color:'var(--text-muted)', fontSize:'0.78rem'}}>
          Cylinders sent to this customer go out for filling and come back filled. No holding limit applies;
          personal cylinders can also be sent to them for filling.
        </small>
      </div>

      <div className="btn-group">
        <button type="submit" className="btn btn-primary">
          {customer ? 'Update Customer' : 'Save Customer'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        {/* Delete is edit-only — there is nothing to delete while adding. */}
        {customer && (
          <button type="button" className="btn btn-danger" onClick={() => setDeleteMode('choose')}>
            Delete Customer
          </button>
        )}
      </div>

      {deleteMode && (
        <DeleteCustomerModal
          customer={customer}
          mode={deleteMode}
          setMode={setDeleteMode}
          busy={deleteBusy}
          onHide={handleHide}
          onHardDelete={handleHardDelete}
        />
      )}
    </form>
  );
}

// ─── Phase 24: two-mode customer delete ───
// Neither path can fire from a single click. "Hide" asks for one confirmation; "Permanently
// Delete" asks for a second, separate confirmation that names what will be destroyed, because
// it cascades to bills, payments and rental charges and cannot be undone.
function DeleteCustomerModal({ customer, mode, setMode, busy, onHide, onHardDelete }) {
  const name = customer?.company_name || 'this customer';

  if (mode === 'choose') {
    // The overflow came from .btn itself (index.html:346): `white-space: nowrap` kept the
    // descriptions on one line, and `display: inline-flex` laid the heading and description out
    // side by side instead of stacked. Overriding both is the actual fix — widening the modal
    // alone would not have stopped the horizontal scroll.
    const optionBtn = {
      textAlign: 'left', padding: '0.85rem 1rem', width: '100%',
      whiteSpace: 'normal', wordBreak: 'break-word', display: 'block', lineHeight: 1.45
    };
    return (
      <Modal title="Delete Customer" onClose={() => setMode(null)}>
        <p style={{ marginTop: 0 }}>What should happen to <strong>{name}</strong>?</p>
        <div style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem', maxWidth: '100%' }}>
          <button type="button" className="btn btn-secondary" style={optionBtn}
            onClick={() => setMode('hide-confirm')}>
            <strong>🙈 Hide Customer</strong>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.3rem', whiteSpace: 'normal' }}>
              Removes them from customer lists and transaction pickers. Every bill, payment and
              report entry stays exactly as it is. Reversible.
            </div>
          </button>
          <button type="button" className="btn btn-danger" style={optionBtn}
            onClick={() => setMode('hard-confirm')}>
            <strong>🗑️ Permanently Delete</strong>
            <div style={{ fontSize: '0.82rem', marginTop: '0.3rem', opacity: 0.92, whiteSpace: 'normal' }}>
              Erases the customer and cascade-deletes all their bills, transactions, payments and
              rental charges. Cannot be undone.
            </div>
          </button>
        </div>
        <div className="modal-actions" style={{ marginTop: '1rem' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setMode(null)}>Cancel</button>
        </div>
      </Modal>
    );
  }

  if (mode === 'hide-confirm') {
    return (
      <ConfirmModal
        title="Hide this customer?"
        message={`${name} will no longer appear in customer lists or transaction pickers. Their bills, payments and history remain fully intact, and you can unhide them later.`}
        confirmLabel={busy ? 'Hiding…' : 'Yes, hide customer'}
        danger={false}
        loading={busy}
        onConfirm={onHide}
        onCancel={() => setMode('choose')}
      />
    );
  }

  return (
    <ConfirmModal
      title="Permanently delete everything?"
      message={`This erases ${name} AND every bill, transaction, payment and rental charge belonging to them. Historical reports that included this customer will change. This cannot be undone — choose "Hide Customer" instead if you only want them out of the way.`}
      confirmLabel={busy ? 'Deleting…' : 'Permanently delete'}
      danger={true}
      loading={busy}
      onConfirm={onHardDelete}
      onCancel={() => setMode('choose')}
    />
  );
}

// ─── Profile Page (Change 8) ───
// One import panel (Customers OR Cylinders): download template → pick file → preview → commit.
export function ImportPanel({ which }) {
  const schema = IMPORT_SCHEMAS[which];
  const [fileName, setFileName] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null);     // { rows, blankSkipped, exampleSkipped } | { error }
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);      // { created, skipped:[], failed:[] }
  const fileRef = React.useRef(null);

  const resetFile = () => {
    setParsed(null); setResult(null); setFileName('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const onFile = async (e) => {
    const file = e.target.files[0];
    setParsed(null); setResult(null);
    if (!file) return;
    setFileName(file.name);
    setParsing(true);
    try {
      const existing = { rot: new Set(), phy: new Set() };
      if (which === 'cylinders') {
        const res = await apiFetch(`${API_URL}/cylinders?limit=200`);
        if (res.ok) {
          const raw = await res.json();
          const cyls = raw.data || raw;
          cyls.forEach(c => {
            if (c.rotational_number) existing.rot.add(String(c.rotational_number).toLowerCase());
            if (c.physical_number) existing.phy.add(String(c.physical_number).toLowerCase());
          });
        }
      }
      setParsed(await parseImportFile(which, file, existing));
    } catch (err) {
      setParsed({ error: err.message || 'Could not read this file.' });
    }
    setParsing(false);
  };

  const validRows = parsed && parsed.rows ? parsed.rows.filter(r => r.errors.length === 0) : [];
  const errorRows = parsed && parsed.rows ? parsed.rows.filter(r => r.errors.length > 0) : [];

  const doImport = async () => {
    if (!validRows.length) return;
    setImporting(true);
    try {
      const payload = { rows: validRows.map(r => ({ __row: r.rowNum, ...r.data })) };
      const res = await apiFetch(`${API_URL}/${schema.endpoint}/import`, { method: 'POST', body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Import failed.'); setImporting(false); return; }
      setResult(data);
      const sk = (data.skipped || []).length, fl = (data.failed || []).length;
      showToast(`Imported ${data.created} ${schema.label.toLowerCase()}.`
        + (sk ? ` ${sk} skipped (already exist).` : '')
        + (fl ? ` ${fl} failed.` : ''), (sk || fl) ? 'info' : 'success');
    } catch { showToast('Import failed.'); }
    setImporting(false);
  };

  // Flattened, row-ordered list of every structured problem (one entry per error).
  const allErrors = errorRows.reduce((acc, r) => acc.concat(r.errors), []);

  const downloadErrorRows = () => downloadImportIssues(allErrors, `${which}-import-errors`);
  const downloadFailedRows = () =>
    downloadImportIssues([
      ...(result.skipped || []).map(x => ({ row: x.row, field: '', category: 'SKIPPED', value: '', message: x.reason })),
      ...(result.failed || []).map(x => ({ row: x.row, field: '', category: 'FAILED', value: '', message: x.reason }))
    ], `${which}-import-failed`);

  const totalIssues = result ? (result.skipped || []).length + (result.failed || []).length : 0;

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '1rem', flex: '1 1 320px', minWidth: 0 }}>
      <h3 style={{ marginBottom: '0.5rem' }}>Import {schema.label}</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
        <button className="btn btn-secondary" onClick={() => downloadImportTemplate(which)}>⬇ Download Template</button>
        <button className="btn btn-secondary" onClick={() => fileRef.current && fileRef.current.click()}>📤 Choose File…</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={onFile} />
        {fileName && <span style={{ fontSize: '0.8rem', color: 'var(--text-2)' }}>{fileName}</span>}
        {(parsed || result) && <button className="link-btn" style={{ fontSize: '0.8rem' }} onClick={resetFile}>Reset</button>}
      </div>

      {parsing && <Spinner label="Reading file…" />}

      {parsed && parsed.error && <div className="alert alert-danger">{parsed.error}</div>}

      {parsed && parsed.rows && !result && (
        <div>
          <div style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
            <strong>{parsed.rows.length}</strong> data row{parsed.rows.length === 1 ? '' : 's'} ·{' '}
            <span style={{ color: 'var(--success)' }}>{validRows.length} valid</span> ·{' '}
            <span style={{ color: errorRows.length ? 'var(--danger)' : 'var(--text-muted)' }}>{errorRows.length} with errors</span>
            {(parsed.exampleSkipped || parsed.blankSkipped) ? (
              <span style={{ color: 'var(--text-muted)' }}>
                {' '}({parsed.exampleSkipped ? `${parsed.exampleSkipped} example` : ''}
                {parsed.exampleSkipped && parsed.blankSkipped ? ', ' : ''}
                {parsed.blankSkipped ? `${parsed.blankSkipped} blank` : ''} skipped)
              </span>
            ) : null}
          </div>

          {allErrors.length > 0 && (
            <div className="table-container" style={{ maxHeight: '260px', overflowY: 'auto', marginBottom: '0.5rem' }}>
              <table>
                <thead><tr>
                  <th style={{ width: '52px' }}>Row</th>
                  <th style={{ width: '120px' }}>Field</th>
                  <th style={{ width: '150px' }}>Category</th>
                  <th>Message</th>
                </tr></thead>
                <tbody>
                  {allErrors.map((e, i) => (
                    <tr key={`${e.row}-${e.field}-${i}`}>
                      <td>{e.row}</td>
                      <td style={{ fontSize: '0.78rem' }}>{e.field}</td>
                      <td><span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--danger)' }}>{e.category}</span></td>
                      <td style={{ fontSize: '0.8rem' }}>{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button className="btn btn-primary" onClick={doImport} disabled={importing || validRows.length === 0}>
              {importing ? 'Importing…' : `Import ${validRows.length} valid row${validRows.length === 1 ? '' : 's'}`}
            </button>
            {errorRows.length > 0 && (
              <button className="btn btn-secondary" onClick={downloadErrorRows}>⬇ Download error rows</button>
            )}
          </div>
          {errorRows.length > 0 && (
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              Fix the error rows and re-upload, or import the valid rows now.
            </p>
          )}
        </div>
      )}

      {result && (
        <div>
          <div className="alert alert-success" style={{ marginBottom: '0.5rem' }}>
            Created <strong>{result.created}</strong> · Skipped <strong>{(result.skipped || []).length}</strong> · Failed <strong>{(result.failed || []).length}</strong>
          </div>
          {totalIssues > 0 && (
            <button className="btn btn-secondary" onClick={downloadFailedRows}>⬇ Download failed rows</button>
          )}
          {/* Likely-duplicate names (Phase 11) — informational; the rows WERE imported. */}
          {(result.duplicate_warnings || []).length > 0 && (
            <div className="alert alert-warning" style={{ marginTop: '0.5rem', fontSize: '0.82rem' }}>
              <strong>⚠️ {result.duplicate_warnings.length} possible duplicate name{result.duplicate_warnings.length === 1 ? '' : 's'}</strong> (imported anyway — review and merge/delete if needed):
              <ul style={{ margin: '0.35rem 0 0 1.1rem', padding: 0 }}>
                {result.duplicate_warnings.slice(0, 12).map((w, i) => (
                  <li key={i}>Row {w.row}: “{w.company_name}” looks like “{w.similar_to}” ({w.where})</li>
                ))}
                {result.duplicate_warnings.length > 12 && <li>…and {result.duplicate_warnings.length - 12} more</li>}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Gas Types & Cylinder Sizes management (Phase 9, redesigned Phase 10) ───
// Gas types are added/removed independently; selecting a gas type reveals ITS OWN scoped
// size list (backed by the GasCapacity collection — the runtime source of truth). Removal
// of a size checks usage for that gas+size pair only. Still open (no auth) per plan.
export function MastersSection() {
  const [gasTypes, setGasTypes] = useState([]);   // GasType docs (ids needed for gas delete)
  const [catalog, setCatalog] = useState({});     // { gasName: [sizes] }
  const [selectedGas, setSelectedGas] = useState(null);
  const [newGas, setNewGas] = useState('');
  const [newSize, setNewSize] = useState('');
  const [confirmDel, setConfirmDel] = useState(null); // { kind: 'gas', item } | { kind: 'size', gas, label }
  const [busy, setBusy] = useState(false);
  // Catalog changes are step-up-gated (Phase 18): { title, action(auth) } while modal open.
  const [stepUpAsk, setStepUpAsk] = useState(null);

  const load = async () => {
    try {
      const [g, c] = await Promise.all([
        apiFetch(`${API_URL}/masters/gas-types`),
        apiFetch(`${API_URL}/masters/gas-capacities`)
      ]);
      if (g.ok) setGasTypes(await g.json());
      if (c.ok) setCatalog(await c.json());
    } catch {}
    loadGasCatalog(); // keep the app-wide GAS_CAPACITIES map in sync
  };
  useEffect(() => { load(); }, []);

  const addGas = () => {
    const value = newGas.trim();
    if (!value) return;
    setStepUpAsk({
      title: `Approve adding gas type "${value}"`,
      context: `add gas type "${value}" to the shared catalog`,
      action: async (auth) => {
        try {
          const res = await apiFetch(`${API_URL}/masters/gas-types`, {
            method: 'POST', headers: { 'x-step-up-token': auth.step_up_token }, body: JSON.stringify({ gas_type_name: value })
          });
          if (res.ok) { showToast(`Gas type "${value}" added.`, 'success'); setNewGas(''); setSelectedGas(value); load(); }
          else showToast(await apiErrorMessage(res, 'Could not add gas type'));
        } catch { showToast('Could not add gas type'); }
      }
    });
  };

  const addSize = () => {
    const value = newSize.trim();
    if (!value || !selectedGas) return;
    setStepUpAsk({
      title: `Approve adding size "${value}" to ${selectedGas}`,
      context: `add cylinder size "${value}" under ${selectedGas} in the shared catalog`,
      action: async (auth) => {
        try {
          const res = await apiFetch(`${API_URL}/masters/gas-capacities/${encodeURIComponent(selectedGas)}/sizes`, {
            method: 'POST', headers: { 'x-step-up-token': auth.step_up_token }, body: JSON.stringify({ size_label: value })
          });
          if (res.ok) { showToast(`Size "${value}" added to ${selectedGas}.`, 'success'); setNewSize(''); load(); }
          else showToast(await apiErrorMessage(res, 'Could not add size'));
        } catch { showToast('Could not add size'); }
      }
    });
  };

  // Confirm dialog → step-up approval → delete.
  const doDelete = () => {
    if (!confirmDel) return;
    const target = confirmDel;
    setConfirmDel(null);
    setStepUpAsk({
      title: target.kind === 'gas'
        ? `Approve removing gas type "${target.item.gas_type_name}"`
        : `Approve removing size "${target.label}" from ${target.gas}`,
      context: target.kind === 'gas'
        ? `remove gas type "${target.item.gas_type_name}" from the shared catalog`
        : `remove cylinder size "${target.label}" from ${target.gas} in the shared catalog`,
      action: async (auth) => {
        setBusy(true);
        try {
          let res;
          if (target.kind === 'gas') {
            res = await apiFetch(`${API_URL}/masters/gas-types/${target.item._id}`, {
              method: 'DELETE', headers: { 'x-step-up-token': auth.step_up_token }
            });
            if (res.ok && selectedGas === target.item.gas_type_name) setSelectedGas(null);
          } else {
            res = await apiFetch(
              `${API_URL}/masters/gas-capacities/${encodeURIComponent(target.gas)}/sizes?label=${encodeURIComponent(target.label)}`,
              { method: 'DELETE', headers: { 'x-step-up-token': auth.step_up_token } }
            );
          }
          if (res.ok) { showToast('Removed.', 'success'); load(); }
          else showToast(await apiErrorMessage(res, 'Could not remove'));
        } catch { showToast('Could not remove'); }
        setBusy(false);
      }
    });
  };

  const sizes = selectedGas ? (catalog[selectedGas] || []) : [];

  return (
    <div className="card">
      <h2>Gas Types &amp; Cylinder Sizes</h2>
      <p style={{fontSize:'0.82rem', color:'var(--text-muted)', margin:'0.4rem 0 0.75rem'}}>
        Select a gas type to manage its own list of cylinder sizes. A gas type or size can only be
        removed while no cylinder in inventory uses it — past bills always keep the type/size
        recorded at transaction time.
      </p>

      <h3 style={{fontSize:'0.95rem', marginBottom:'0.25rem'}}>Gas Types</h3>
      <div style={{display:'flex', gap:'0.4rem', maxWidth:'420px'}}>
        <input className="form-control" placeholder="New gas type (e.g. Argon)" value={newGas}
          onChange={(e) => setNewGas(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addGas(); }} />
        <button className="btn btn-primary" onClick={addGas} disabled={!newGas.trim()}>Add</button>
      </div>
      <div style={{display:'flex', flexWrap:'wrap', gap:'0.4rem', marginTop:'0.5rem'}}>
        {gasTypes.map(g => {
          const active = selectedGas === g.gas_type_name;
          return (
            <span key={g._id} style={{display:'inline-flex', alignItems:'center', gap:'0.35rem',
              border:`1px solid ${active ? 'var(--primary, #2563eb)' : 'var(--border)'}`,
              background: active ? 'rgba(37,99,235,0.08)' : 'transparent',
              borderRadius:'999px', padding:'0.2rem 0.4rem 0.2rem 0.7rem', fontSize:'0.85rem'}}>
              <button className="link-btn" style={{fontSize:'0.85rem', fontWeight: active ? 700 : 400}}
                title={`Manage sizes for ${g.gas_type_name}`}
                onClick={() => setSelectedGas(active ? null : g.gas_type_name)}>
                {g.gas_type_name} ({(catalog[g.gas_type_name] || []).length})
              </button>
              <button className="btn btn-danger" title="Remove gas type" style={{padding:'0 0.4rem', fontSize:'0.75rem', borderRadius:'999px'}}
                onClick={() => setConfirmDel({ kind: 'gas', item: g })}>✕</button>
            </span>
          );
        })}
        {gasTypes.length === 0 && <span style={{color:'var(--text-muted)', fontSize:'0.85rem'}}>None yet.</span>}
      </div>

      {selectedGas && (
        <div style={{marginTop:'1rem', paddingTop:'0.75rem', borderTop:'1px solid var(--border)'}}>
          <h3 style={{fontSize:'0.95rem', marginBottom:'0.25rem'}}>Cylinder Sizes — {selectedGas}</h3>
          <div style={{display:'flex', gap:'0.4rem', maxWidth:'420px'}}>
            <input className="form-control" placeholder={`New size for ${selectedGas} (e.g. 10 m3)`} value={newSize}
              onChange={(e) => setNewSize(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addSize(); }} />
            <button className="btn btn-primary" onClick={addSize} disabled={!newSize.trim()}>Add</button>
          </div>
          <div style={{display:'flex', flexWrap:'wrap', gap:'0.4rem', marginTop:'0.5rem'}}>
            {sizes.map(label => (
              <span key={label} style={{display:'inline-flex', alignItems:'center', gap:'0.35rem',
                border:'1px solid var(--border)', borderRadius:'999px', padding:'0.2rem 0.4rem 0.2rem 0.7rem', fontSize:'0.85rem'}}>
                {label}
                <button className="btn btn-danger" title={`Remove ${label} from ${selectedGas}`}
                  style={{padding:'0 0.4rem', fontSize:'0.75rem', borderRadius:'999px'}}
                  onClick={() => setConfirmDel({ kind: 'size', gas: selectedGas, label })}>✕</button>
              </span>
            ))}
            {sizes.length === 0 && <span style={{color:'var(--text-muted)', fontSize:'0.85rem'}}>No sizes yet — add the first one above.</span>}
          </div>
        </div>
      )}

      {confirmDel && (
        <ConfirmModal
          title={confirmDel.kind === 'gas' ? 'Remove gas type?' : 'Remove cylinder size?'}
          message={confirmDel.kind === 'gas'
            ? `Remove "${confirmDel.item.gas_type_name}" and its size list from the catalog? This is refused if any cylinder in inventory still uses it.`
            : `Remove "${confirmDel.label}" from ${confirmDel.gas}? Only ${confirmDel.gas} cylinders at ${confirmDel.label} block this — other gases using "${confirmDel.label}" are unaffected.`}
          confirmLabel="Continue to approval"
          loading={busy}
          onConfirm={doDelete}
          onCancel={() => setConfirmDel(null)}
        />
      )}
      {stepUpAsk && (
        <StepUpVerificationModal title={stepUpAsk.title} context={stepUpAsk.context}
          message="Catalog changes need approval from a trusted person."
          onVerified={(auth) => { const a = stepUpAsk; setStepUpAsk(null); a.action(auth); }}
          onClose={() => setStepUpAsk(null)} />
      )}
    </div>
  );
}

export function ImportDataSection() {
  return (
    <div className="card">
      <h2>Bulk Import (Onboarding)</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '-0.5rem', marginBottom: '1rem' }}>
        One-time setup for a new account. Download a template, fill it in, and upload the same file back —
        the format always matches. Records you upload are added to your account only.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
        <ImportPanel which="customers" />
        <ImportPanel which="cylinders" />
      </div>
    </div>
  );
}

export function ProfilePage({ currentUser, onUserUpdated, onLoggedOut }) {
  const [account, setAccount] = useState(null);
  const [business, setBusiness] = useState({ business_name:'', business_address:'', business_phone:'', gst_number:'', logo:'' });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showClear, setShowClear] = useState(false);
  // Location profiles (Phase 2): 3 fixed sites, each with manager/contact/challan prefix,
  // plus the user's active (default) location.
  // active_location comes from THIS browser (localStorage), not the shared account (Phase 32);
  // profiles (manager/contact/challan) still come from the server and stay shared.
  const [locData, setLocData] = useState({ active_location: getActiveLocation(), profiles: [] });
  const [pendingSwitch, setPendingSwitch] = useState(null); // location awaiting confirm dialog

  // Account form
  const [acct, setAcct] = useState({ name:'', phone:'', email:'', current_password:'' });
  const [acctErrors, setAcctErrors] = useState({});
  // Password form
  const [pw, setPw] = useState({ current_password:'', new_password:'', confirm_password:'' });
  const [pwErrors, setPwErrors] = useState({});

  const sessionInfo = (() => {
    let loginTime = null;
    try { loginTime = account?.last_login; } catch {}
    return { device: navigator.userAgent, loginTime };
  })();

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [aRes, bRes, lRes] = await Promise.all([
        apiFetch(`${API_URL}/profile`),
        apiFetch(`${API_URL}/profile/business`),
        apiFetch(`${API_URL}/profile/locations`)
      ]);
      if (aRes.ok) {
        const a = await aRes.json();
        setAccount(a);
        setAcct({ name: a.name || '', phone: a.phone || '', email: a.email || '', current_password: '' });
      }
      if (bRes.ok) setBusiness(await bRes.json());
      // Take the shared profiles from the server but keep Active Location per-browser (Phase 32).
      if (lRes.ok) { const ld = await lRes.json(); setLocData({ ...ld, active_location: getActiveLocation() }); }
    } catch (e) {
      showToast('Could not load profile.');
    }
    setLoading(false);
  };

  // ── Account save — step-up-gated like every other Profile section (Phase 20) ──
  const saveAccount = (e) => {
    e.preventDefault();
    const errs = {};
    if (!acct.name.trim()) errs.name = 'Name is required';
    if (acct.email !== account.email && !acct.current_password) errs.current_password = 'Enter your current password to change email';
    setAcctErrors(errs);
    if (Object.keys(errs).length) return;
    const emailChanged = acct.email !== account.email;
    setStepUpAsk({
      title: 'Approve saving Account Information',
      context: `save Account Information changes (name/phone/email for ${acct.email || 'this account'})`,
      action: async (auth) => {
        // Phase 26: an email change goes down the verify-first path — a code is sent to the NEW
        // address and nothing is saved until it is entered. Name/phone-only saves are unchanged.
        if (emailChanged) {
          try {
            const res = await apiFetch(`${API_URL}/profile/email-change/request`, {
              method: 'POST', headers: { 'x-step-up-token': auth.step_up_token },
              body: JSON.stringify({ email: acct.email, current_password: acct.current_password })
            });
            if (!res.ok) { showToast(await apiErrorMessage(res)); return; }
            const data = await res.json();
            setAcct(prev => ({ ...prev, current_password: '' }));
            setEmailVerify({ pending_email: data.pending_email, pending_token: data.pending_token });
          } catch {}
          return;
        }
        try {
          const res = await apiFetch(`${API_URL}/profile`, {
            method:'PUT', headers: { 'x-step-up-token': auth.step_up_token }, body: JSON.stringify(acct)
          });
          if (res.ok) {
            const data = await res.json();
            showToast('Profile updated.', 'success');
            onUserUpdated({ name: data.name, email: data.email });
            setAcct(prev => ({ ...prev, current_password: '' }));
            fetchAll();
            // The bootstrap Trusted Person mirrors these fields — tell that section to reload.
            window.dispatchEvent(new CustomEvent('trusted-people-refresh'));
            // Phase 25: an email change rotates the authenticator. Show the new QR straight
            // away — the previous code keeps working until this is confirmed.
            if (data.totp_rotation) setTotpRotation(data.totp_rotation);
          } else { showToast(await apiErrorMessage(res)); }
        } catch {}
      }
    });
  };

  // Phase 25: pending authenticator rotation after an email change.
  const [totpRotation, setTotpRotation] = useState(null);
  // Phase 26: pending new-email verification, shown before anything is saved.
  const [emailVerify, setEmailVerify] = useState(null);

  // ── Business save — step-up-gated (Phase 18): viewing is open, saving needs approval ──
  const [stepUpAsk, setStepUpAsk] = useState(null); // { title, action(auth) }
  const saveBusiness = (e) => {
    e.preventDefault();
    setStepUpAsk({
      title: 'Approve saving Business Information',
      context: 'save Business Information changes (name, address, GST, logo)',
      action: async (auth) => {
        try {
          const res = await apiFetch(`${API_URL}/profile/business`, {
            method:'PUT', headers: { 'x-step-up-token': auth.step_up_token }, body: JSON.stringify(business)
          });
          if (res.ok) showToast('Business profile saved.', 'success');
          else showToast(await apiErrorMessage(res));
        } catch {}
      }
    });
  };

  const onLogoChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 500 * 1024) { showToast('Logo must be under 500 KB.'); return; }
    const reader = new FileReader();
    reader.onload = () => setBusiness(prev => ({ ...prev, logo: reader.result }));
    reader.readAsDataURL(file);
  };

  // ── Location profiles (Phase 2) ──
  const setLocField = (location, field, value) => setLocData(prev => ({
    ...prev,
    profiles: prev.profiles.map(p => p.location === location ? { ...p, [field]: value } : p)
  }));

  // Phase 20: ONE shared save commits all three location profiles together (still step-up-gated).
  const saveAllLocationProfiles = () => {
    setStepUpAsk({
      title: 'Approve saving all Location Profiles',
      context: 'save changes to all 3 Location Profiles (manager, contact, challan prefix)',
      action: async (auth) => {
        try {
          const res = await apiFetch(`${API_URL}/profile/locations`, {
            method: 'PUT',
            headers: { 'x-step-up-token': auth.step_up_token },
            body: JSON.stringify({ profiles: locData.profiles.map(p => ({
              location: p.location, manager_name: p.manager_name, contact_number: p.contact_number, challan_prefix: p.challan_prefix
            })) })
          });
          if (res.ok) showToast('All location profiles saved.', 'success');
          else showToast(await apiErrorMessage(res));
        } catch { showToast('Could not save location profiles.'); }
      }
    });
  };

  // Switching only changes THIS browser's default/views — Phase 32: stored per-browser in
  // localStorage, never on the shared account, so other browsers/devices are unaffected.
  const confirmSwitch = () => {
    const target = pendingSwitch;
    setPendingSwitch(null);
    setActiveLocation(target); // localStorage, this browser only
    setLocData(prev => ({ ...prev, active_location: target }));
    showToast(`Active location for this browser switched to ${locationText(target)}.`, 'success');
  };

  // ── Password change — step-up-gated (Phase 19) ON TOP of the current-password check ──
  const changePassword = (e) => {
    e.preventDefault();
    const errs = {};
    if (!pw.current_password) errs.current_password = 'Required';
    if (pw.new_password.length < 8) errs.new_password = 'At least 8 characters';
    else if (!/[0-9]/.test(pw.new_password) || !/[^A-Za-z0-9]/.test(pw.new_password)) errs.new_password = 'Must include a number and a special character';
    if (pw.new_password !== pw.confirm_password) errs.confirm_password = 'Passwords do not match';
    setPwErrors(errs);
    if (Object.keys(errs).length) return;
    setStepUpAsk({
      title: 'Approve changing the account password',
      context: 'change the account password (everyone who signs in uses this password)',
      action: async (auth) => {
        try {
          const res = await apiFetch(`${API_URL}/profile/change-password`, {
            method:'POST', headers: { 'x-step-up-token': auth.step_up_token }, body: JSON.stringify(pw)
          });
          if (res.ok) { showToast('Password changed.', 'success'); setPw({ current_password:'', new_password:'', confirm_password:'' }); }
          else showToast(await apiErrorMessage(res));
        } catch {}
      }
    });
  };

  // ── Download all data (ZIP) ──
  const downloadData = async () => {
    setExporting(true);
    try {
      const res = await apiFetch(`${API_URL}/profile/export-data`);
      if (!res.ok) { showToast(await apiErrorMessage(res, 'Export failed.')); setExporting(false); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${getExportFileName('data-export-zip')}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      showToast('Export downloaded.', 'success');
    } catch { showToast('Export failed.'); }
    setExporting(false);
  };

  // ── Logout all sessions ──
  const logoutAll = async () => {
    try {
      const res = await apiFetch(`${API_URL}/profile/logout-all`, { method:'POST' });
      if (res.ok) { showToast('All sessions logged out.', 'success'); onLoggedOut(); }
      else showToast(await apiErrorMessage(res));
    } catch {}
  };

  if (loading) return <Spinner label="Loading profile…" />;

  return (
    <div>
      {/* A. Business Information */}
      <div className="card">
        <h2>Business Information</h2>
        <p style={{color:'var(--text-muted)', fontSize:'0.82rem', marginTop:'-0.5rem', marginBottom:'1rem'}}>
          Shown on bill headers and printed/PDF invoices.
        </p>
        <form onSubmit={saveBusiness}>
          <div className="form-row">
            <div className="form-group">
              <label>Business Name</label>
              <input className="form-control" value={business.business_name}
                onChange={(e) => setBusiness({...business, business_name: e.target.value})} />
            </div>
            <div className="form-group">
              <label>Business Phone</label>
              <input className="form-control" value={business.business_phone}
                onChange={(e) => setBusiness({...business, business_phone: e.target.value})} />
            </div>
          </div>
          <div className="form-group">
            <label>Business Address</label>
            <textarea className="form-control" rows="2" value={business.business_address}
              onChange={(e) => setBusiness({...business, business_address: e.target.value})} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>GST Number (for invoicing)</label>
              <input className="form-control" value={business.gst_number}
                onChange={(e) => setBusiness({...business, gst_number: e.target.value})} />
            </div>
            <div className="form-group">
              <label>Business Logo (optional)</label>
              <input type="file" accept="image/*" className="form-control" onChange={onLogoChange} />
            </div>
          </div>
          {business.logo && (
            <div style={{marginBottom:'1rem'}}>
              <img src={business.logo} alt="Logo" style={{maxHeight:'64px', borderRadius:'6px', border:'1px solid var(--border)'}} />
              <button type="button" className="link-btn" style={{marginLeft:'1rem', fontSize:'0.8rem'}}
                onClick={() => setBusiness({...business, logo:''})}>Remove logo</button>
            </div>
          )}
          <button type="submit" className="btn btn-primary">Save Business Info</button>
        </form>
      </div>

      {/* A2. Location Profiles — one card per fixed site (manager / contact / challan prefix) */}
      <div className="card">
        <h2>Location Profiles</h2>
        <p style={{color:'var(--text-muted)', fontSize:'0.82rem', marginTop:'-0.5rem', marginBottom:'1rem'}}>
          Per-site manager, contact number, and challan prefix. Business Information above stays shared across all sites.
        </p>
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(240px, 1fr))', gap:'1rem'}}>
          {locData.profiles.map(p => (
            <div key={p.location} style={{border:'1px solid var(--border)', borderRadius:'8px', padding:'0.9rem'}}>
              <div style={{fontWeight:700, marginBottom:'0.6rem'}}>
                📍 {locationText(p.location)}
                {locData.active_location === p.location && (
                  <span className="badge badge-success" style={{marginLeft:'0.5rem', fontSize:'0.62rem'}}>Active</span>
                )}
              </div>
              <div className="form-group">
                <label>Manager Name</label>
                <input className="form-control" value={p.manager_name}
                  onChange={(e) => setLocField(p.location, 'manager_name', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Contact Number</label>
                <input className="form-control" value={p.contact_number}
                  onChange={(e) => setLocField(p.location, 'contact_number', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Challan Prefix</label>
                <input className="form-control" value={p.challan_prefix} placeholder="e.g. C-"
                  onChange={(e) => setLocField(p.location, 'challan_prefix', e.target.value)} />
                <small style={{color:'var(--text-muted)', fontSize:'0.75rem'}}>
                  Locked onto challan numbers for bills at this site.
                </small>
              </div>
            </div>
          ))}
        </div>
        <div style={{marginTop:'1rem'}}>
          <button type="button" className="btn btn-primary" onClick={saveAllLocationProfiles}>
            Save All Location Profiles
          </button>
        </div>
      </div>

      {/* A3. Active Location — default site for new transactions and location-aware views */}
      <div className="card">
        <h2>Active Location</h2>
        <p style={{color:'var(--text-muted)', fontSize:'0.82rem', marginTop:'-0.5rem', marginBottom:'1rem'}}>
          The site you are currently operating as. New transactions default to it (still changeable per-transaction).
          Saved for <strong>this browser only</strong> — switching here never changes what other browsers or devices
          default to, and never alters existing bills, cylinders, or customers.
        </p>
        <div style={{display:'flex', gap:'0.6rem', flexWrap:'wrap'}}>
          {LOCATIONS.map(l => (
            <button key={l} type="button"
              className={`btn ${locData.active_location === l ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { if (locData.active_location !== l) setPendingSwitch(l); }}>
              {locData.active_location === l ? '✓ ' : ''}{locationText(l)}
            </button>
          ))}
        </div>
      </div>

      {/* B. Account Information */}
      <div className="card">
        <h2>Account Information</h2>
        <form onSubmit={saveAccount}>
          <div className="form-row">
            <div className="form-group">
              <label>Full Name</label>
              <input className={`form-control ${acctErrors.name ? 'input-error' : ''}`} value={acct.name}
                onChange={(e) => setAcct({...acct, name: e.target.value})} />
              {acctErrors.name && <div className="field-error">{acctErrors.name}</div>}
            </div>
            <div className="form-group">
              <label>Phone Number</label>
              <input className="form-control" value={acct.phone}
                onChange={(e) => setAcct({...acct, phone: e.target.value})} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Email Address</label>
              <input type="email" className="form-control" value={acct.email}
                onChange={(e) => setAcct({...acct, email: e.target.value})} />
            </div>
            {acct.email !== account.email && (
              <div className="form-group">
                <label>Current Password (to change email)</label>
                <input type="password" className={`form-control ${acctErrors.current_password ? 'input-error' : ''}`} value={acct.current_password}
                  onChange={(e) => setAcct({...acct, current_password: e.target.value})} />
                {acctErrors.current_password && <div className="field-error">{acctErrors.current_password}</div>}
              </div>
            )}
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Member Since</label>
              <input className="form-control" value={formatDate(account.member_since)} readOnly disabled />
            </div>
            <div className="form-group">
              <label>Last Login</label>
              <input className="form-control" value={account.last_login ? formatDateTime(account.last_login) : '—'} readOnly disabled />
            </div>
          </div>
          <button type="submit" className="btn btn-primary">Save Account Info</button>
        </form>
      </div>

      {/* C. Change Password */}
      <div className="card">
        <h2>Change Password</h2>
        <form onSubmit={changePassword}>
          <div className="form-group">
            <label>Current Password</label>
            <input type="password" className={`form-control ${pwErrors.current_password ? 'input-error' : ''}`} value={pw.current_password}
              onChange={(e) => setPw({...pw, current_password: e.target.value})} />
            {pwErrors.current_password && <div className="field-error">{pwErrors.current_password}</div>}
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>New Password</label>
              <input type="password" className={`form-control ${pwErrors.new_password ? 'input-error' : ''}`} value={pw.new_password}
                onChange={(e) => setPw({...pw, new_password: e.target.value})} />
              {pwErrors.new_password
                ? <div className="field-error">{pwErrors.new_password}</div>
                : <div style={{fontSize:'0.76rem', color:'var(--text-muted)', marginTop:'0.25rem'}}>Min 8 chars, incl. a number and a special character.</div>}
            </div>
            <div className="form-group">
              <label>Confirm New Password</label>
              <input type="password" className={`form-control ${pwErrors.confirm_password ? 'input-error' : ''}`} value={pw.confirm_password}
                onChange={(e) => setPw({...pw, confirm_password: e.target.value})} />
              {pwErrors.confirm_password && <div className="field-error">{pwErrors.confirm_password}</div>}
            </div>
          </div>
          <button type="submit" className="btn btn-primary">Change Password</button>
        </form>
      </div>

      {/* C2. Trusted People (Phase 17) — step-up approval list */}
      <TrustedPeopleSection />

      {/* C3. Currently logged-in devices/sessions (Phase 17) */}
      <SessionsSection onLoggedOut={onLoggedOut} />

      {/* D. Data & Privacy */}
      <div className="card">
        <h2>Data &amp; Privacy</h2>
        <div style={{display:'flex', flexWrap:'wrap', gap:'1rem', alignItems:'center'}}>
          <button className="btn btn-secondary" onClick={downloadData} disabled={exporting}>
            {exporting ? 'Generating…' : '⬇ Download All My Data (ZIP)'}
          </button>
          {exporting && <Spinner label="Preparing export…" />}
        </div>
        <div style={{marginTop:'1.5rem', paddingTop:'1rem', borderTop:'1px solid var(--border)'}}>
          <h3 style={{fontSize:'1rem'}}>Active Session</h3>
          <p style={{fontSize:'0.85rem', color:'var(--text-2)'}}>
            <strong>Signed in:</strong> {account.last_login ? formatDateTime(account.last_login) : '—'}<br/>
            <strong>Device:</strong> {sessionInfo.device}
          </p>
          <div style={{display:'flex', flexWrap:'wrap', gap:'0.5rem'}}>
            <button className="btn btn-primary" onClick={onLoggedOut}>Sign Out</button>
            <button className="btn btn-secondary" onClick={logoutAll}>Log Out All Sessions</button>
          </div>
        </div>
      </div>

      {/* E0. Gas Types & Cylinder Sizes (Phase 9) — open (no auth) until auth-gating lands */}
      <MastersSection />

      {/* E. Bulk Import (one-time onboarding) */}
      <ImportDataSection />

      {/* F. Danger Zone */}
      <div className="danger-zone">
        <h2 style={{color:'#b91c1c', borderColor:'#fca5a5'}}>Danger Zone</h2>
        <p style={{fontSize:'0.85rem', color:'#7f1d1d', marginBottom:'1rem'}}>
          Clear all your business data (customers, transactions, payments, cylinders) but keep your account,
          or permanently delete your account and everything in it.
        </p>
        <div style={{display:'flex', flexWrap:'wrap', gap:'0.5rem'}}>
          <button className="btn btn-danger" onClick={() => setShowClear(true)}>🗑️ Clear All Data</button>
          <button className="btn btn-danger" onClick={() => setShowDelete(true)}>Delete Account</button>
        </div>
      </div>

      {showClear && (
        <ClearDataModal
          onClose={() => setShowClear(false)}
          onCleared={() => { setShowClear(false); showToast('All data has been cleared.', 'success'); }}
        />
      )}
      {showDelete && <DeleteAccountModal onClose={() => setShowDelete(false)} onDeleted={onLoggedOut} />}
      {stepUpAsk && (
        <StepUpVerificationModal title={stepUpAsk.title} context={stepUpAsk.context}
          message="Saving this change needs approval from a trusted person."
          onVerified={(auth) => { const a = stepUpAsk; setStepUpAsk(null); a.action(auth); }}
          onClose={() => setStepUpAsk(null)} />
      )}
      {emailVerify && (
        <VerifyNewEmailModal
          pending={emailVerify}
          onCancel={() => { setEmailVerify(null); setAcct(prev => ({ ...prev, email: account.email })); }}
          onVerified={(data) => {
            setEmailVerify(null);
            showToast(data.message, 'success');
            onUserUpdated({ name: data.name, email: data.email });
            fetchAll();
            window.dispatchEvent(new CustomEvent('trusted-people-refresh'));
            // Only now — with the new address proven — does the authenticator step begin.
            if (data.totp_rotation) setTotpRotation(data.totp_rotation);
          }}
        />
      )}
      {totpRotation && (
        <TotpRotationModal rotation={totpRotation} onDone={() => setTotpRotation(null)} />
      )}
      {pendingSwitch && (
        <ConfirmModal
          title="Switch active location?"
          message={`Switch to ${locationText(pendingSwitch)}? This changes the default for this browser only.`}
          confirmLabel="Switch"
          danger={false}
          onConfirm={confirmSwitch}
          onCancel={() => setPendingSwitch(null)}
        />
      )}
    </div>
  );
}

// 3-step account deletion modal
// Phase 21: password alone is no longer enough — deletion also needs an OWNER-ONLY step-up
// approval (no other trusted person can authorize it, even fully verified + enrolled).
export function DeleteAccountModal({ onClose, onDeleted }) {
  const [understood, setUnderstood] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [askOwner, setAskOwner] = useState(false);

  const doDelete = async (auth) => {
    setBusy(true);
    try {
      const res = await apiFetch(`${API_URL}/profile/delete-account`, {
        method: 'DELETE',
        headers: { 'x-step-up-token': auth.step_up_token },
        body: JSON.stringify({ password })
      });
      if (res.ok) {
        // Clear local session and bounce to login with a message.
        localStorage.removeItem('authToken');
        localStorage.removeItem('currentUser');
        window.dispatchEvent(new CustomEvent('auth-logout', { detail: { message: 'Your account has been deleted.' } }));
      } else {
        showToast(await apiErrorMessage(res));
        setBusy(false);
      }
    } catch { setBusy(false); }
  };

  const a11yRef = useModalA11y(onClose);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" ref={a11yRef} onClick={(e) => e.stopPropagation()} style={{maxWidth:'460px'}}>
        <div className="modal-header danger">
          <span>⚠️ Delete Account</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="alert alert-danger">
            This will permanently delete all your data including customers, transactions, cylinders, and payments. This cannot be undone.
          </div>
          <label style={{display:'flex', gap:'0.5rem', alignItems:'flex-start', margin:'1rem 0', fontSize:'0.88rem'}}>
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} style={{marginTop:'0.2rem'}} />
            <span>I understand this is permanent and irreversible</span>
          </label>
          <div className="form-group">
            <label>Enter your password to confirm</label>
            <input type="password" className="form-control" value={password}
              onChange={(e) => setPassword(e.target.value)} autoFocus />
          </div>
          <div className="btn-group" style={{justifyContent:'flex-end'}}>
            <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn btn-danger" onClick={() => setAskOwner(true)} disabled={!understood || !password || busy}>
              {busy ? 'Deleting…' : 'Continue to owner approval'}
            </button>
          </div>
          <p style={{fontSize:'0.78rem', color:'var(--text-muted)', marginTop:'0.5rem', textAlign:'right'}}>
            👑 Next step: only the account owner can approve deleting the account.
          </p>
        </div>
        {askOwner && (
          <StepUpVerificationModal
            title="Owner approval — delete account"
            context="permanently DELETE this account and everything in it (customers, transactions, cylinders, payments)"
            ownerOnly
            onVerified={(auth) => { setAskOwner(false); doDelete(auth); }}
            onClose={() => setAskOwner(false)}
          />
        )}
      </div>
    </div>
  );
}
