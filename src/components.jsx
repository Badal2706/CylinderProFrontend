import React, { useState, useEffect } from 'react';
import { API_URL, apiFetch, apiErrorMessage, fetchAllPages, showToast, formatDate, directionText, GAS_CAPACITIES, sortGasTypes, sortCapacities, LOCATIONS, LOCATION_LABELS, locationText, getActiveLocation, Modal, Spinner } from './App.jsx';
import { PaymentForm, directionLabel } from './pages.jsx';

// Phase 34: Bill Date time-of-day helpers. nowHHMM() seeds the time input with the current time;
// billTimeFrom() extracts local HH:MM from a stored bill_date (existing date-only bills read back
// as their stored midnight-UTC, i.e. 05:30 in IST — a neutral default, not a fabricated time).
export function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function billTimeFrom(v) {
  if (!v) return nowHHMM();
  const d = new Date(v);
  if (isNaN(d)) return '00:00';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// A Filled line's amount is ALWAYS rate × (inventory cylinders + personal cylinders returned),
// derived on demand. Personal cylinders returned to the customer are refilled service items and
// are charged at the same rate as inventory cylinders. Deriving (rather than trusting a stored
// `amount` field) means the value can never go stale or NaN, whichever code path mutated the line.
// (Empty lines never call this — their rate is 0 by convention and personal-IN is never charged.)
export function lineAmount(item) {
  const qty = (item.serial_numbers || []).length + (Number(item.personalCyl) || 0);
  return (Number(item.rate) || 0) * qty;
}

// Print a transaction as the GURU Industries Delivery Challan.
// Fixed company letterhead (NOT driven by Business Profile). Two stacked sections:
//   "Cylinders Empty from Customer" (no Rate/Amount) above, "Cylinders Filled to Customer" (with Rate/Amount + TOTAL) below.
// A section is omitted entirely when it has no lines, so Given-only / Received-only / Swap all render correctly.
// The logo is loaded from /guru-logo.png (served from the frontend's public/ folder).
// Shared print helper (Phase 27): HTML-escape for print templates.
const printEsc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Phase 28 patch: a bulk-import left some customer contacts stored as "0". Treat 0/empty/falsy
// as blank for DISPLAY only (never mutate stored data) so a literal "0" never shows anywhere.
export const displayContact = (v) => {
  const s = String(v == null ? '' : v).trim();
  return (s === '' || s === '0') ? '' : s;
};

// Shared print <head> styles, reused by the challan and the Currently Holding statement.
function printDocStyles() {
  return `
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body { height:100%; }
    body { font-family: Arial, 'Noto Sans Gujarati', 'Shruti', 'Arial Unicode MS', sans-serif; color:#000; font-size:12px; padding:10px;
           display:flex; flex-direction:column; min-height:calc(100vh - 20px); }
    .hdr-box { border:1.5px solid #000; }
    .hdr-title { text-align:center; font-size:14px; font-weight:bold; padding:5px; border-bottom:1px solid #000; }
    .hdr-cols { display:flex; }
    .hcol { padding:8px 10px; font-size:11px; font-weight:normal; line-height:1.5; }
    /* Phase 28 patch: logo enlarged again by reclaiming the unused whitespace to the right of
       the contact box — the logo column widens (26%→34%, 120px→150px) while the company and
       contact boxes shift right and the over-wide contact box narrows to fit its text (38%→28%). */
    .hcol.logo { width:34%; display:flex; align-items:center; justify-content:center; border-right:1px solid #000; }
    .hcol.logo img { max-width:100%; max-height:150px; }
    .hcol.company { width:38%; border-right:1px solid #000; }
    .hcol.company .co { font-size:16px; font-weight:bold; margin-bottom:3px; }
    /* Phase 27: Plot line now lives inside the company box, under the ISO line. */
    .hcol.company .plot-in { margin-top:3px; }
    .hcol.contact { width:28%; }
    /* Phase 27: Mfg stays below the box, font bumped one point (10 -> 11). */
    .mfg { font-size:11px; margin-top:5px; margin-bottom:8px; }
    .info { padding:6px 0; border-top:1px solid #000; border-bottom:1px solid #000; margin-bottom:10px; }
    .info .ms { font-size:13px; margin-bottom:6px; }
    .info b { font-weight:700; }
    /* Phase 29: every two-column info line (Ch.No./Date, M/s/GSTIN, Address/Vehicle) uses one
       pattern — left item + right item on a single row, right-aligned. A print-time script
       (__fitPairs) adds a "stacked" class per line, independently, only when the two would collide
       (fewer than ~3 space-widths of gap), dropping the right item to its own right-aligned line.
       NOTE: never put backticks in this CSS comment — it lives inside a template literal. */
    .pair { display:flex; justify-content:space-between; align-items:baseline; gap:0; font-size:13px; margin-bottom:6px; }
    .pair .pair-r { text-align:right; white-space:nowrap; }
    .pair.stacked { flex-direction:column; align-items:stretch; gap:2px; }
    .pair.stacked .pair-r { text-align:right; white-space:normal; }
    /* Blank vehicle → a ruled space to fill in by hand after printing (Phase 28 patch). */
    .veh-blank { display:inline-block; min-width:130px; border-bottom:1px solid #000; }
    .sec-title { font-weight:700; font-size:13px; margin:8px 0 4px; }
    table.ctab { width:100%; border-collapse:collapse; margin-bottom:6px; }
    table.ctab th, table.ctab td { border:1px solid #000; padding:5px 7px; font-size:12px; vertical-align:top; }
    table.ctab th { font-weight:700; text-align:left; }
    table.ctab td.c, table.ctab th.c { text-align:center; }
    table.ctab td.r, table.ctab th.r { text-align:right; }
    table.ctab .tot td { font-weight:700; }
    .foot { margin-top:24px; }
    .note-h { font-weight:700; font-size:12.5px; font-family:'Noto Sans Gujarati','Shruti','Arial Unicode MS',sans-serif; }
    .note { font-size:12px; line-height:1.7; font-family:'Noto Sans Gujarati','Shruti','Arial Unicode MS',sans-serif; }
    .eng { margin-top:7px; font-size:12px; font-weight:600; }
    .signs { display:flex; justify-content:space-between; align-items:flex-end; margin-top:auto; padding-top:40px; font-size:12.5px; font-weight:700; }
    .signs .right { text-align:right; }
    @page { margin-top:10mm; margin-bottom:10mm; margin-left:10mm; margin-right:10mm; }`;
}

// Shared company header box (logo + company info + contact), used by both print documents.
function printHeaderBox(title) {
  const LOGO_URL = window.location.origin + '/guru-logo.png';
  return `
  <div class="hdr-box">
    <div class="hdr-title">${title}</div>
    <div class="hdr-cols">
      <div class="hcol logo"><img src="${LOGO_URL}" alt="GURU Industries" onerror="this.style.display='none'"/></div>
      <div class="hcol company">
        <div class="co">GURU Industries</div>
        <div>GSTIN: 24AAJFG7415N1Z3</div>
        <div>ISO 9001:2015 Certified Company</div>
        <div class="plot-in">Plot No.: 114/47, Chandisar G.I.D.C., Palanpur-385 001. (B.K.) Gujarat.</div>
      </div>
      <div class="hcol contact">
        <div>Chandisar: M 7600076251, 7600076254</div>
        <div>Palanpur: M 7600076255</div>
        <div>Chaapi: M 9624650959</div>
        <div>E-mail: gurugases@yahoo.com</div>
      </div>
    </div>
  </div>
  <div class="mfg">Mfg.: Industrial &amp; Medical Oxygen, CO2, Nitrogen, Argon etc gases.</div>`;
}

// Shared customer info block: M/s + right-slot GSTIN, address, contact, and a right-aligned
// meta line (Ch.No./Date for the challan, or a plain Date for the holding statement).
function printCustomerBlock(bill, metaLeftHtml, metaRightHtml, opts = {}) {
  // Contact: never print the bulk-import "0" artifact — blank value instead (label always shown).
  const contact = displayContact(bill.customer_contact) || displayContact(bill.phone_primary);
  const vehicle = printEsc(bill.vehicle_number || '');
  // Phase 29: Address and Vehicle share one two-column line (Address left, Vehicle right),
  // matching the Ch.No./Date and M/s/GSTIN lines. Blank vehicle → a ruled fill-in space.
  // Each `.pair` wraps its right item independently at print time (see __fitPairs in the doc script)
  // only when fewer than ~3 space-widths of gap remain — so a long name and a long address never
  // affect each other's line. The holding statement (no vehicle) keeps Address on its own line.
  const vehicleRight = vehicle ? `<b>${vehicle}</b>` : `<span class="veh-blank"></span>`;
  const addrVehLine = opts.showVehicle
    ? `<div class="pair">
      <span class="pair-l">Address: ${printEsc(bill.customer_address || '')}</span>
      <span class="pair-r">Vehicle: ${vehicleRight}</span>
    </div>`
    : `<div class="ms">Address: ${printEsc(bill.customer_address || '')}</div>`;
  return `
  <div class="info">
    ${(metaLeftHtml || metaRightHtml) ? `<div class="pair"><span class="pair-l">${metaLeftHtml || ''}</span><span class="pair-r">${metaRightHtml || ''}</span></div>` : ''}
    <div class="pair">
      <span class="pair-l">M/s.: <b>${printEsc(bill.customer_name || '')}</b></span>
      <span class="pair-r">GSTIN: <b>${printEsc(bill.customer_gst || 'URP')}</b></span>
    </div>
    ${addrVehLine}
    <div class="ms">Contact: ${printEsc(contact)}</div>
  </div>`;
}

// Phase 29: shared doc script — measures each two-column `.pair` line and stacks (wraps the right
// item to its own right-aligned line) only when fewer than ~3 space-character-widths of gap remain
// between the left and right text. Runs per line independently, before printing.
function printFitAndPrintScript() {
  return `<script>
  function __fitPairs(){
    var info = document.querySelector('.info') || document.body;
    var sp = document.createElement('span');
    sp.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;white-space:pre;font-size:13px';
    sp.textContent = '   '; // three spaces at the pair font size
    info.appendChild(sp); var space3 = sp.getBoundingClientRect().width; info.removeChild(sp);
    var pairs = document.querySelectorAll('.pair');
    for (var i=0;i<pairs.length;i++){
      var p = pairs[i]; p.classList.remove('stacked');
      var l = p.querySelector('.pair-l'), r = p.querySelector('.pair-r');
      if(!l || !r) continue;
      var natural = function(node){
        var c = node.cloneNode(true);
        c.style.position='absolute'; c.style.visibility='hidden'; c.style.left='-9999px'; c.style.whiteSpace='nowrap';
        p.appendChild(c); var w = c.getBoundingClientRect().width; p.removeChild(c); return w;
      };
      var gap = p.getBoundingClientRect().width - natural(l) - natural(r);
      if (gap < space3) p.classList.add('stacked');
    }
  }
  window.onload=function(){var go=function(){__fitPairs();setTimeout(function(){window.print();},120);};(document.fonts&&document.fonts.ready)?document.fonts.ready.then(go):go();window.onafterprint=function(){window.close();};};
  <\/script>`;
}

function openPrintWindow(html) {
  const w = window.open('', 'guru_print', 'width=900,height=760,scrollbars=yes');
  if (w) { w.document.write(html); w.document.close(); }
  else { showToast('Please allow pop-ups to use Print / PDF.', 'info'); }
}

export function printSavedBill(bill) {
  const esc = printEsc;

  // ─── Phase 27: merged empty/filled cylinder table ───
  // Group customer lines by gas+size; within a group, pair returned-empty entries with
  // handed-over-filled entries row by row. Personal (non-serialised) cylinders show
  // "Personal Cylinder" instead of a serial. Rate/Amount populate only where a fill occurred
  // (the Filled side of the row). No Qty column — a totals row carries the counts instead.
  // Phase 28: personal (non-serialised) cylinders collapse to ONE row per group,
  // shown as "Personal Cylinder ×N" — no longer one row per unit.
  const groups = [];
  const gmap = {};
  for (const l of (bill.lines || [])) {
    if (l.direction !== 'GIVEN' && l.direction !== 'RECEIVED') continue;
    const key = (l.gas || '') + '||' + (l.size || '');
    if (!gmap[key]) { gmap[key] = { gas: l.gas || '', size: l.size || '', empty: [], filled: [], pEmpty: 0, pFilled: 0, rate: 0 }; groups.push(gmap[key]); }
    const g = gmap[key];
    const serials = l.serials || [];
    const pc = Number(l.personalCyl) || 0;
    if (l.direction === 'RECEIVED') {
      serials.forEach(s => g.empty.push({ label: s }));
      g.pEmpty += pc;
    } else {
      const rate = Number(l.rate) || 0;
      if (rate) g.rate = rate;
      serials.forEach(s => g.filled.push({ label: s, rate }));
      g.pFilled += pc;
    }
  }

  let sr = 0, totEmpty = 0, totFilled = 0, totAmt = 0, body = '';
  for (const g of groups) {
    // Paired serialised rows (Phase 27 pairing).
    const n = Math.max(g.empty.length, g.filled.length);
    for (let i = 0; i < n; i++) {
      const e = g.empty[i], f = g.filled[i];
      if (e) totEmpty++;
      let rateCell = '', amtCell = '';
      if (f) { totFilled++; const a = Number(f.rate) || 0; rateCell = a.toFixed(2); amtCell = a.toFixed(2); totAmt += a; }
      body += `<tr>
        <td class="c">${++sr}</td><td>${esc(g.gas)}</td><td>${esc(g.size)}</td>
        <td>${e ? esc(e.label) : ''}</td><td>${f ? esc(f.label) : ''}</td>
        <td class="r">${rateCell}</td><td class="r">${amtCell}</td></tr>`;
    }
    // Phase 28: one consolidated personal-cylinder row per group.
    if (g.pEmpty > 0 || g.pFilled > 0) {
      totEmpty += g.pEmpty;
      totFilled += g.pFilled;
      const amt = g.pFilled * (Number(g.rate) || 0);
      totAmt += amt;
      const eCell = g.pEmpty > 0 ? `Personal Cylinder ×${g.pEmpty}` : '';
      const fCell = g.pFilled > 0 ? `Personal Cylinder ×${g.pFilled}` : '';
      const rateCell = g.pFilled > 0 ? (Number(g.rate) || 0).toFixed(2) : '';
      const amtCell = g.pFilled > 0 ? amt.toFixed(2) : '';
      body += `<tr>
        <td class="c">${++sr}</td><td>${esc(g.gas)}</td><td>${esc(g.size)}</td>
        <td>${eCell}</td><td>${fCell}</td>
        <td class="r">${rateCell}</td><td class="r">${amtCell}</td></tr>`;
    }
  }

  const mergedTable = groups.length ? `
    <table class="ctab">
      <thead><tr>
        <th class="c" style="width:7%">Sr. No.</th><th>Gas Type</th><th>Size</th>
        <th>Cylinder No. (Empty)</th><th>Cylinder No. (Filled)</th>
        <th class="r" style="width:12%">Rate</th><th class="r" style="width:14%">Amount</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr class="tot">
        <td></td><td></td><td class="r">TOTAL</td>
        <td class="c">${totEmpty}</td><td class="c">${totFilled}</td>
        <td></td><td class="r">${totAmt.toFixed(2)}</td>
      </tr></tfoot>
    </table>` : '';

  // Internal-transfer challans keep their own simple list (a move, not an empty/filled swap).
  const transferLines = (bill.lines || []).filter(l => l.direction === 'TRANSFER');
  let tSr = 0;
  const transferRows = transferLines.map((l) => {
    const nS = (l.serials || []).length, nP = Number(l.personalCyl) || 0;
    let rows = '';
    if (nS > 0) rows += `<tr><td class="c">${++tSr}</td><td>${esc(l.gas)}</td><td>${esc(l.size)}</td><td>${esc((l.serials || []).join(', '))}</td></tr>`;
    if (nP > 0) rows += `<tr><td class="c">${++tSr}</td><td>${esc(l.gas)}</td><td>${esc(l.size)}</td><td>Personal Cylinder ×${nP}</td></tr>`;
    return rows;
  }).join('');
  const transferSection = transferLines.length ? `
    <div class="sec-title">Cylinders Transferred</div>
    <table class="ctab">
      <thead><tr><th class="c" style="width:8%">Sr. No.</th><th>Gas Type</th><th>Size</th><th>Cylinder No.</th></tr></thead>
      <tbody>${transferRows}</tbody>
    </table>` : '';

  // Phase 28 patch: Vehicle moved out of the Ch.No. line — it now prints below GSTIN (see block).
  const metaLeft = `Ch.No.: <b>${esc(bill.challan_no || '')}</b>`;
  const metaRight = `Date: <b>${formatDate(bill.bill_date)}</b>`;

  const docTitle = bill.customer_name ? esc(bill.customer_name) : 'Delivery Challan';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${docTitle}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Gujarati&display=swap" rel="stylesheet">
  <style>${printDocStyles()}</style></head><body>
  ${printHeaderBox('Delivery Challan')}
  ${printCustomerBlock(bill, metaLeft, metaRight, { showVehicle: true })}
  ${mergedTable}
  ${transferSection}
  <div class="foot">
    <div class="note-h">નોંધ:</div>
    <div class="note">
      * સિલિન્ડર રીટર્ન આપતી વખતે સિલિન્ડર ખરાબ અથવા ડેમેજ હશે તો તેનો ચાર્જ અલગથી લેવામાં આવશે.<br/>
      * ૧૦ દિવસ પછી સિલિન્ડરનું ભાડું આપવાનું રહેશે. (સિલિન્ડર દીઠ રૂ. ૧૦ પ્રતિ દિવસ)<br/>
      * સિલિન્ડર જમા કરાવ્યાના ૨ થી ૫ દિવસ પછી ડિપોઝિટ રિટર્ન મળશે.<br/>
      * કોઈપણ ગેસની વેલિડિટી ૩ મહિનાની હોય છે.
    </div>
    <div class="eng">First check the Goods and then take delivery.<br/>Subject to Palanpur Jurisdiction</div>
  </div>
  <div class="signs"><div>Customer Signature</div><div class="right">Guru Industries<br/>Authorised Signature</div></div>
  ${printFitAndPrintScript()}
  </body></html>`;

  openPrintWindow(html);
}

// ─── Phase 27: Currently Holding Cylinders statement ───
// Reuses the challan header + customer block, but with a holding-status table and NO amounts
// (this is a status document, not a billing document). `rows` come from the on-screen table.
export function printHoldingStatement({ customer_name, customer_address, customer_contact, customer_gst, rows, breakdown }) {
  const esc = printEsc;
  const bodyRows = (rows || []).map((r, i) => `
    <tr>
      <td class="c">${i + 1}</td>
      <td>${esc(r.serial_number || '')}</td>
      <td>${esc(r.gas_type || '')}</td>
      <td>${esc(r.size || '')}</td>
      <td class="c">${r.date_filled ? formatDate(r.date_filled) : ''}</td>
      <td class="c">${r.days_held == null ? '' : esc(r.days_held)}</td>
      <td>${esc(r.bill_number || '')}</td>
      <td>${esc(r.challan_no || '')}</td>
    </tr>`).join('');

  const table = `
    <table class="ctab">
      <thead><tr>
        <th class="c" style="width:6%">Sr.</th><th>Serial No.</th><th>Gas Type</th><th>Size</th>
        <th class="c">Date Filled</th><th class="c">Days Held</th><th>Bill No.</th><th>Challan No.</th>
      </tr></thead>
      <tbody>${bodyRows || `<tr><td class="c" colspan="8">No cylinders currently held.</td></tr>`}</tbody>
      <tfoot><tr class="tot"><td class="r" colspan="3">TOTAL HELD</td><td class="c">${(rows || []).length}</td><td colspan="4"></td></tr></tfoot>
    </table>`;

  // Breakdown by Type (Phase 31) — final section after the full list, using the SAME data the
  // on-screen Breakdown by Type shows (customer.cylinder_breakdown). Omitted when empty.
  // Phase 32: the PRINTED table shows only Gas Type / Size / Currently Holding — Total Filled and
  // Total Empty are dropped here (the on-screen version still shows all five columns).
  const bd = Array.isArray(breakdown) ? breakdown : [];
  const breakdownTable = bd.length ? `
    <table class="ctab" style="margin-top:14px">
      <thead><tr>
        <th>Gas Type</th><th>Size</th><th class="c">Currently Holding</th>
      </tr></thead>
      <tbody>${bd.map(item => `
        <tr>
          <td>${esc(item.gas_type_name || '')}</td>
          <td>${esc(item.size_label || '')}</td>
          <td class="c"><b>${esc(item.currently_held ?? 0)}</b></td>
        </tr>`).join('')}</tbody>
      <tfoot><tr class="tot">
        <td class="r" colspan="2">TOTAL</td>
        <td class="c">${bd.reduce((s, x) => s + (Number(x.currently_held) || 0), 0)}</td>
      </tr></tfoot>
    </table>` : '';

  const bill = { customer_name, customer_address, customer_contact, customer_gst };
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(customer_name || 'Currently Holding Cylinders')}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Gujarati&display=swap" rel="stylesheet">
  <style>${printDocStyles()}</style></head><body>
  ${printHeaderBox('Currently Holding Cylinders Statement')}
  ${printCustomerBlock(bill, '', `Date: <b>${formatDate(new Date())}</b>`)}
  ${table}
  ${breakdownTable ? `<h3 style="margin:16px 0 6px;font-size:12px">Breakdown by Type</h3>${breakdownTable}` : ''}
  <div class="signs"><div>Customer Signature</div><div class="right">Guru Industries<br/>Authorised Signature</div></div>
  ${printFitAndPrintScript()}
  </body></html>`;

  openPrintWindow(html);
}

// ─── Step-up verification modal (Phase 17 — consumed by Phase 18's gated actions) ───
// Two ways to approve a sensitive action:
//   Email code : pick a specific trusted person → 6-digit code goes to THEIR email.
//   Authenticator: enter a 6-digit TOTP code — accepted if it matches ANY active trusted
//                  person's own authenticator (each person has a distinct secret).
// On success calls onVerified({ step_up_token, via, approved_by }).
// Phase 21:
//   context   — human-readable description of WHAT is being authorized; shown at the top of
//               the modal (both paths) and included in the OTP email body.
//   ownerOnly — restrict approval to the bootstrap account owner (used for account deletion /
//               clear-all-data). Enforced by the backend too; this just matches the UI to it.
export function StepUpVerificationModal({ title = 'Approval required', message = '', context = '', ownerOnly = false, onVerified, onClose }) {
  const [tab, setTab] = useState('totp'); // 'totp' | 'otp'
  const [people, setPeople] = useState([]);
  const [personId, setPersonId] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(null);   // { message, dev_code? } after Send code
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`${API_URL}/trusted-people`);
        if (res.ok) {
          let list = (await res.json()).filter(p => p.is_active);
          if (ownerOnly) list = list.filter(p => p.is_bootstrap);
          setPeople(list);
          if (!list.some(p => p.totp_enabled)) setTab('otp'); // no authenticators enrolled yet
        }
      } catch {}
    })();
  }, []);

  const sendOtp = async () => {
    if (!personId) { setError('Choose a trusted person first.'); return; }
    setBusy(true); setError('');
    try {
      const res = await apiFetch(`${API_URL}/step-up/otp/send`, { method: 'POST', body: JSON.stringify({ person_id: personId, context, owner_only: ownerOnly }) });
      const data = await res.json();
      if (res.ok) { setSent(data); setCode(''); }
      else setError(data.error || 'Could not send the code.');
    } catch { setError('Network error.'); }
    setBusy(false);
  };

  const verify = async () => {
    setBusy(true); setError('');
    try {
      const url = tab === 'otp' ? `${API_URL}/step-up/otp/verify` : `${API_URL}/step-up/totp/verify`;
      const body = tab === 'otp' ? { person_id: personId, code, owner_only: ownerOnly } : { code, owner_only: ownerOnly };
      const res = await apiFetch(url, { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json();
      if (res.ok && data.verified) onVerified(data);
      else setError(data.error || 'Verification failed.');
    } catch { setError('Network error.'); }
    setBusy(false);
  };

  return (
    <Modal title={`🛡️ ${title}`} onClose={onClose}>
      {context && (
        <div className="alert alert-warning" style={{fontSize:'0.85rem', marginBottom:'0.75rem'}}>
          <strong>Authorization requested:</strong> {context}
        </div>
      )}
      {ownerOnly && (
        <p style={{fontSize:'0.82rem', color:'#b91c1c', fontWeight:600}}>
          👑 Only the account owner can approve this action.
        </p>
      )}
      {message && <p style={{fontSize:'0.88rem'}}>{message}</p>}
      <div className="auth-tabs" style={{marginBottom:'1rem'}}>
        <button type="button" className={`auth-tab ${tab === 'totp' ? 'active' : ''}`}
          onClick={() => { setTab('totp'); setError(''); setCode(''); }}>Authenticator code</button>
        <button type="button" className={`auth-tab ${tab === 'otp' ? 'active' : ''}`}
          onClick={() => { setTab('otp'); setError(''); setCode(''); }}>Email a code</button>
      </div>

      {tab === 'otp' && (
        <>
          <div className="form-group">
            <label>Send the code to</label>
            <select className="form-control" value={personId} onChange={(e) => { setPersonId(e.target.value); setSent(null); }}>
              <option value="">-- Choose a trusted person --</option>
              {people.filter(p => p.email_verified).map(p => (
                <option key={p.person_id} value={p.person_id}>{p.name} ({p.email})</option>
              ))}
            </select>
          </div>
          {!sent ? (
            <button type="button" className="btn btn-primary" onClick={sendOtp} disabled={busy || !personId}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
          ) : (
            <div className={`alert ${sent.email_sent === false ? 'alert-warning' : 'alert-success'}`} style={{fontSize:'0.8rem'}}>{sent.message}</div>
          )}
        </>
      )}
      {tab === 'totp' && (
        <p style={{fontSize:'0.85rem', color:'var(--text-muted)'}}>
          {ownerOnly
            ? "Enter the 6-digit code from the account owner's Google Authenticator."
            : "Enter the 6-digit code from any trusted person's Google Authenticator."}
        </p>
      )}

      {(tab === 'totp' || sent) && (
        <input className="form-control" style={{fontSize:'1.3rem', letterSpacing:'0.4rem', textAlign:'center', maxWidth:'220px', marginTop:'0.75rem'}}
          maxLength={6} value={code} placeholder="••••••"
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (code.length === 6) verify(); } }} autoFocus />
      )}
      {error && <div className="field-error" style={{marginTop:'0.5rem'}}>{error}</div>}
      <div className="btn-group" style={{marginTop:'1rem'}}>
        <button type="button" className="btn btn-primary" onClick={verify} disabled={busy || code.length !== 6}>
          {busy ? 'Checking…' : 'Approve'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

// Transaction Entry Component
export function TransactionEntry({ onBack, onViewCustomer, onNewTransaction }) {
  // customerType 'INTERNAL' = internal transfer between our own sites (no customer).
  const [customerType, setCustomerType] = useState('REGULAR');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customers, setCustomers] = useState([]);
  // Defaults to SWAP (Phase 14): both Empty-from-Customer and Filled-to-Customer sections open.
  const [transactionType, setTransactionType] = useState('SWAP');
  // Site the customer transaction happens at (required on every customer bill).
  const [location, setLocation] = useState('AT_PLANT_CHANDISAR');
  // Internal transfer: source and destination sites (must differ).
  const [fromLocation, setFromLocation] = useState('AT_PLANT_CHANDISAR');
  const [toLocation, setToLocation] = useState('AT_PALANPUR_OFFICE');
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0]);
  // Phase 34: time-of-day on the Bill Date, defaulting to now, always editable (incl. backdating).
  const [billTime, setBillTime] = useState(() => nowHHMM());
  // Pre-software confirmation (Phase 34 item 4): set to { cylinders, message, onConfirm } when a
  // backdated entry contradicts only the migration placeholder; cleared on confirm/cancel.
  const [preSoftware, setPreSoftware] = useState(null);
  // Combine the date + time inputs into an absolute UTC instant. The inputs are the user's LOCAL
  // wall-clock; `new Date('YYYY-MM-DDTHH:MM')` parses them in the browser's timezone, and
  // .toISOString() converts to UTC so the server (which may run in a different timezone, e.g. UTC on
  // the droplet vs IST in the browser) stores the exact moment — no offset, and no drift on re-edit.
  const combinedBillDate = () => {
    if (!billDate) return billDate;
    const t = /^\d{2}:\d{2}/.test(billTime) ? billTime : '00:00';
    const d = new Date(`${billDate}T${t}`);
    return isNaN(d.getTime()) ? `${billDate}T${t}` : d.toISOString();
  };
  const [challanNo, setChallanNo] = useState('');
  const [challanError, setChallanError] = useState('');
  // Phase 27: Bill Number is prefilled from the sequence but freely editable (like Challan No.);
  // Vehicle Number is optional and never blocks save.
  const [billNumber, setBillNumber] = useState('');
  const [billNumberEdited, setBillNumberEdited] = useState(false); // don't clobber a manual edit on refetch
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [remarks, setRemarks] = useState('');
  const [givenItems, setGivenItems] = useState([]);
  // Internal transfer PC quantities (Phase 11): [{ gas_type_id, cylinder_size_id, quantity }].
  const [transferPc, setTransferPc] = useState([]);
  const [receivedItems, setReceivedItems] = useState([]);
  const [gasTypes, setGasTypes] = useState([]);
  const [cylinderSizes, setCylinderSizes] = useState([]);
  const [cylinders, setCylinders] = useState([]);
  const [inRotationCyls, setInRotationCyls] = useState([]); // ALL in-rotation cylinders (with current holder)
  const [oneTimeCustomer, setOneTimeCustomer] = useState({
    company_name: '',
    contact_person: '',
    phone_primary: '',
    address: ''
  });
  // Per-site profiles (Phase 2): location -> { manager_name, contact_number, challan_prefix }.
  // Also carries the user's active_location, which pre-selects the location dropdowns.
  const [locProfiles, setLocProfiles] = useState({});
  const [savedBill, setSavedBill] = useState(null);
  const [showPostSavePaymentForm, setShowPostSavePaymentForm] = useState(false);
  // same-session edit (item 5A): when set, the form edits an existing bill (PUT, no audit) instead of creating a new one.
  const [editingBillId, setEditingBillId] = useState(null);
  const [editingBillNo, setEditingBillNo] = useState('');
  // Save-for-later drafts (Phase 5): draftId set = this form continues an existing draft.
  const [draftId, setDraftId] = useState(null);
  const [draftBillNo, setDraftBillNo] = useState('');
  const [showDrafts, setShowDrafts] = useState(false);
  const [drafts, setDrafts] = useState([]);
  // Live customer search (Phase 5): text typed into the customer combobox.
  const [custQuery, setCustQuery] = useState('');
  const [custOpen, setCustOpen] = useState(false);
  // Per gas+size PC balances for the selected customer (Phase 11): { "Gas|Size": n }.
  const [pcBalances, setPcBalances] = useState({});
  // ─── Step-up gating (Phase 18) ───
  // stepUpAsk: { title, message?, action(auth) } while the approval modal is open.
  // stepUpAuth: approval carried into the same-session Edit Bill PUT.
  // overLimitAuth: approval that unlocks saving an over-limit bill.
  const [stepUpAsk, setStepUpAsk] = useState(null);
  const [stepUpAuth, setStepUpAuth] = useState(null);
  const [overLimitAuth, setOverLimitAuth] = useState(null);
  // An authorization applies to the customer it was granted for — clear it on switch.
  useEffect(() => { setOverLimitAuth(null); }, [selectedCustomer?.customer_id]);

  // Filling vendors use the fixed send/receive-back layout — force SWAP on selection (Phase 14).
  useEffect(() => {
    if (selectedCustomer?.is_filling_vendor) setTransactionType('SWAP');
  }, [selectedCustomer?.customer_id]);

  useEffect(() => {
    const id = selectedCustomer?.customer_id;
    if (!id) { setPcBalances({}); return; }
    let active = true;
    (async () => {
      try {
        const res = await apiFetch(`${API_URL}/customers/${id}/pc-balances`);
        if (active) setPcBalances(res.ok ? await res.json() : {});
      } catch { if (active) setPcBalances({}); }
    })();
    return () => { active = false; };
  }, [selectedCustomer?.customer_id]);

  useEffect(() => {
    fetchCustomers();
    fetchMasterData();
    fetchCylinders();
    fetchInRotation();
    fetchLocationContext();
  }, []);

  // Phase 27: prefill Bill Number from the sequence. Only fills the default while the user
  // hasn't hand-edited it and we're not editing/resuming an existing bill.
  const fetchNextBillNumber = async () => {
    try {
      const res = await apiFetch(`${API_URL}/bills/next-number`);
      if (!res.ok) return;
      const { bill_number } = await res.json();
      setBillNumber(cur => (billNumberEdited || cur) ? cur : (bill_number || ''));
    } catch { /* leave blank; backend still auto-numbers if empty */ }
  };
  useEffect(() => {
    if (!editingBillId && !draftId && !billNumberEdited && !billNumber) fetchNextBillNumber();
  }, []);

  // active_location drives the default site for this transaction (still changeable per-transaction);
  // the per-site challan prefixes come from the same endpoint.
  const fetchLocationContext = async () => {
    try {
      const res = await apiFetch(`${API_URL}/profile/locations`);
      if (!res.ok) return;
      const data = await res.json();
      const map = {};
      (data.profiles || []).forEach(p => { map[p.location] = p; });
      setLocProfiles(map);
      // Phase 32: the default site comes from THIS browser's Active Location (localStorage),
      // not the shared account. Still overridable per-transaction as before.
      const active = getActiveLocation();
      setLocation(active);
      setFromLocation(active);
      setToLocation(LOCATIONS.find(l => l !== active) || LOCATIONS[1]);
    } catch (e) {
      console.error('Error fetching location profiles:', e);
    }
  };

  // Challan prefix comes from the transaction site's profile, but since Phase 14 it is only a
  // PRE-FILL: the challan field is one ordinary editable input holding the full value — the
  // user can type after the prefix, or backspace to change/remove it entirely.
  const challanPrefix = (locProfiles[customerType === 'INTERNAL' ? fromLocation : location]?.challan_prefix) || '';
  const composeChallan = () => challanNo.trim();

  // Pre-fill / re-prefix the challan input when the site (and hence prefix) changes: only
  // while the user hasn't typed a number yet, or their input still starts with the old prefix.
  const prevPrefixRef = React.useRef('');
  useEffect(() => {
    const prev = prevPrefixRef.current;
    prevPrefixRef.current = challanPrefix;
    setChallanNo(cur => {
      if (!cur || cur === prev) return challanPrefix;                       // nothing typed yet
      if (prev && cur.startsWith(prev)) return challanPrefix + cur.slice(prev.length); // swap prefix
      return cur;                                                            // user overrode — leave alone
    });
  }, [challanPrefix]);

  // ── Save-for-later drafts (Phase 5) ──
  // Drafts hold a real bill number and are scoped to the site they were created under.
  const draftScope = () => customerType === 'INTERNAL' ? fromLocation : location;

  const serializeDraft = () => ({
    customerType,
    customer_id: selectedCustomer ? String(selectedCustomer.customer_id) : null,
    customer_name: selectedCustomer ? selectedCustomer.company_name : '',
    one_time_customer: oneTimeCustomer,
    transactionType,
    billDate,
    billTime,         // Phase 34
    challanNo,
    billNumber,       // Phase 27
    vehicleNumber,    // Phase 27
    location,
    fromLocation,
    toLocation,
    remarks,
    givenItems,
    receivedItems,
    // Internal-transfer personal-cylinder quantities live in their own state (transferPc), not
    // in givenItems/receivedItems — so they must be saved explicitly or a resumed transfer draft
    // loses them (Phase 31). Harmless for customer drafts (empty array).
    transferPc
  });

  const saveForLater = async () => {
    try {
      const res = await apiFetch(`${API_URL}/bills/drafts`, {
        method: 'POST',
        body: JSON.stringify({ draft_id: draftId, location: draftScope(), payload: serializeDraft() })
      });
      if (res.ok) {
        const d = await res.json();
        setDraftId(d.draft_id);
        setDraftBillNo(d.bill_number);
        showToast(`Saved as draft ${d.bill_number}. Resume it anytime from this location.`, 'success');
      } else {
        showToast(await apiErrorMessage(res, 'Could not save draft'));
      }
    } catch { showToast('Could not save draft'); }
  };

  const openDrafts = async () => {
    try {
      const res = await apiFetch(`${API_URL}/bills/drafts?location=${draftScope()}`);
      setDrafts(res.ok ? await res.json() : []);
      setShowDrafts(true);
    } catch { showToast('Could not load drafts'); }
  };

  const deleteDraft = async (d) => {
    try {
      const res = await apiFetch(`${API_URL}/bills/${d.draft_id}`, { method: 'DELETE' });
      if (res.ok) setDrafts(prev => prev.filter(x => x.draft_id !== d.draft_id));
      else showToast(await apiErrorMessage(res, 'Could not delete draft'));
    } catch { showToast('Could not delete draft'); }
  };

  const resumeDraft = (d) => {
    const p = d.payload || {};
    setCustomerType(p.customerType || 'REGULAR');
    if (p.customer_id) {
      const cust = customers.find(c => String(c.customer_id || c._id) === String(p.customer_id));
      setSelectedCustomer(cust || null);
      setCustQuery(cust ? cust.company_name : (p.customer_name || ''));
    } else {
      setSelectedCustomer(null);
      setCustQuery('');
    }
    setOneTimeCustomer(p.one_time_customer || { company_name: '', contact_person: '', phone_primary: '', address: '' });
    setTransactionType(p.transactionType || 'GIVEN');
    setBillDate(p.billDate || new Date().toISOString().split('T')[0]);
    setBillTime(p.billTime || nowHHMM());
    setChallanNo(p.challanNo || '');
    if (p.billNumber) { setBillNumber(p.billNumber); setBillNumberEdited(true); }
    setVehicleNumber(p.vehicleNumber || '');
    if (p.location) setLocation(p.location);
    if (p.fromLocation) setFromLocation(p.fromLocation);
    if (p.toLocation) setToLocation(p.toLocation);
    setRemarks(p.remarks || '');
    setGivenItems(Array.isArray(p.givenItems) ? p.givenItems : []);
    setReceivedItems(Array.isArray(p.receivedItems) ? p.receivedItems : []);
    // Restore internal-transfer personal-cylinder quantities (Phase 31).
    setTransferPc(Array.isArray(p.transferPc) ? p.transferPc : []);
    setDraftId(d.draft_id);
    setDraftBillNo(d.bill_number);
    setShowDrafts(false);
    setChallanError('');
    showToast(`Draft ${d.bill_number} loaded.`, 'success');
  };

  // Full inventory, not a first-200 slice — see fetchAllPages in App.jsx for why.
  const fetchCylinders = async () => {
    try {
      setCylinders(await fetchAllPages(`${API_URL}/cylinders`));
    } catch (error) {
      console.error('Error fetching cylinders:', error);
    }
  };

  // ALL in-rotation cylinders (each with its current holder) — pool for the Received / swap-return
  // dropdown, and the source for client-side cross-customer mismatch detection.
  const fetchInRotation = async () => {
    try {
      const res = await apiFetch(`${API_URL}/cylinders/in-rotation`);
      const data = await res.json();
      setInRotationCyls(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Error fetching in-rotation cylinders:', e);
      setInRotationCyls([]);
    }
  };

  // Full customer list, not a first-200 slice — see fetchAllPages in App.jsx for why.
  const fetchCustomers = async () => {
    try {
      const data = await fetchAllPages(`${API_URL}/customers`);
      setCustomers(data);
      setSelectedCustomer(prev => prev
        ? (data.find(c => String(c.customer_id) === String(prev.customer_id)) || prev)
        : prev);
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
  };

  const fetchMasterData = async () => {
    try {
      const [gasRes, sizeRes] = await Promise.all([
        apiFetch(`${API_URL}/masters/gas-types`),
        apiFetch(`${API_URL}/masters/cylinder-sizes`)
      ]);
      
      const gasData = await gasRes.json();
      const sizeData = await sizeRes.json();
      
      setGasTypes(gasData);
      setCylinderSizes(sizeData);
    } catch (error) {
      console.error('Error fetching master data:', error);
    }
  };

  const addGivenItem = () => {
    setGivenItems([...givenItems, {
      gas_type_id: '',
      cylinder_size_id: '',
      serial_numbers: [],
      quantity: 0,
      rate: 0,
      amount: 0,
      direction: 'GIVEN',
      serialInput: '',
      personalCyl: ''  // personal cylinders returned to customer (empty = 0; placeholder shows the 0)
    }]);
  };

  const addReceivedItem = () => {
    setReceivedItems([...receivedItems, {
      gas_type_id: '',
      cylinder_size_id: '',
      serial_numbers: [],
      quantity: 0,
      direction: 'RECEIVED',
      serialInput: '',
      personalCyl: ''  // personal cylinders taken from customer (empty = 0; placeholder shows the 0)
    }]);
  };

  // ─── Filling-vendor auto-echo (Phase 14) ───
  // Most cylinders sent for filling come back with the same identity, so every serial added
  // to "Sent for Filling" is auto-added to "Received Back Filled" as well. The echoed entry
  // is fully independent afterwards: deleting it from the received side does NOT re-add it
  // (echoedPcRef remembers the echo until the serial leaves the sent side) and never touches
  // the sent side.
  const echoedRef = React.useRef(new Set());
  useEffect(() => {
    const vendorNow = !!(customerType === 'REGULAR' && selectedCustomer?.is_filling_vendor);
    if (!vendorNow || transactionType !== 'SWAP' || editingBillId) return;
    const sent = new Map(); // serial -> { g: gas_type_id, z: cylinder_size_id }
    givenItems.forEach(it => (it.serial_numbers || []).forEach(s => sent.set(s, { g: it.gas_type_id, z: it.cylinder_size_id })));
    for (const s of [...echoedRef.current]) if (!sent.has(s)) echoedRef.current.delete(s);
    const toEcho = [...sent].filter(([s]) => !echoedRef.current.has(s));
    if (!toEcho.length) return;
    toEcho.forEach(([s]) => echoedRef.current.add(s));
    setReceivedItems(prev => {
      let next = [...prev];
      for (const [s, ids] of toEcho) {
        if (next.some(it => (it.serial_numbers || []).includes(s))) continue;
        const idx = next.findIndex(it => String(it.gas_type_id) === String(ids.g) && String(it.cylinder_size_id) === String(ids.z));
        if (idx >= 0) {
          next = next.map((it, i) => i === idx
            ? { ...it, serial_numbers: [...it.serial_numbers, s], quantity: it.serial_numbers.length + 1 }
            : it);
        } else {
          next = [...next, {
            gas_type_id: ids.g, cylinder_size_id: ids.z,
            serial_numbers: [s], quantity: 1,
            direction: 'RECEIVED', serialInput: '', personalCyl: ''
          }];
        }
      }
      return next;
    });
  }, [givenItems, customerType, selectedCustomer, transactionType, editingBillId]);

  // ─── Filling-vendor PC quantity auto-echo (Phase 16) ───
  // Personal-cylinder quantities sent for filling come back the same way the serials do:
  // when a combo's total sent PC changes to a new value, the same quantity is filled into
  // the matching "Received Back Filled" line (created if needed). Editing the received value
  // by hand is preserved until the SENT quantity changes again (echoedPcRef remembers the
  // last value we echoed per gas+size combo).
  const echoedPcRef = React.useRef(new Map()); // "gasId|sizeId" -> last echoed sent total
  useEffect(() => {
    const vendorNow = !!(customerType === 'REGULAR' && selectedCustomer?.is_filling_vendor);
    if (!vendorNow || transactionType !== 'SWAP' || editingBillId) return;
    // Total sent PC per combo (gas+size), from the Sent-for-Filling section.
    const sentPc = new Map();
    givenItems.forEach(it => {
      const q = Number(it.personalCyl) || 0;
      if (!it.gas_type_id || !it.cylinder_size_id || q <= 0) return;
      const key = `${it.gas_type_id}|${it.cylinder_size_id}`;
      sentPc.set(key, (sentPc.get(key) || 0) + q);
    });
    for (const key of [...echoedPcRef.current.keys()]) if (!sentPc.has(key)) echoedPcRef.current.delete(key);
    const toEcho = [...sentPc].filter(([key, q]) => echoedPcRef.current.get(key) !== q);
    if (!toEcho.length) return;
    toEcho.forEach(([key, q]) => echoedPcRef.current.set(key, q));
    setReceivedItems(prev => {
      let next = [...prev];
      for (const [key, q] of toEcho) {
        const [g, z] = key.split('|');
        const idx = next.findIndex(it => String(it.gas_type_id) === String(g) && String(it.cylinder_size_id) === String(z));
        if (idx >= 0) {
          next = next.map((it, i) => i === idx ? { ...it, personalCyl: q } : it);
        } else {
          next = [...next, {
            gas_type_id: g, cylinder_size_id: z,
            serial_numbers: [], quantity: 0,
            direction: 'RECEIVED', serialInput: '', personalCyl: q
          }];
        }
      }
      return next;
    });
  }, [givenItems, customerType, selectedCustomer, transactionType, editingBillId]);

  const updateGivenItem = (index, field, value) => {
    const updated = [...givenItems];
    updated[index][field] = value;

    // Changing gas type re-filters capacities — clear the now-possibly-invalid size & serials.
    if (field === 'gas_type_id') {
      updated[index].cylinder_size_id = '';
      updated[index].serial_numbers = [];
      updated[index].quantity = 0;
      updated[index].amount = 0;
    }

    if (field === 'quantity' || field === 'rate') {
      updated[index].amount = lineAmount(updated[index]);
    }

    setGivenItems(updated);
  };

  const updateReceivedItem = (index, field, value) => {
    const updated = [...receivedItems];
    updated[index][field] = value;

    // Changing gas type re-filters capacities — clear the now-possibly-invalid size & serials.
    if (field === 'gas_type_id') {
      updated[index].cylinder_size_id = '';
      updated[index].serial_numbers = [];
      updated[index].quantity = 0;
    }

    setReceivedItems(updated);
  };

  const addSerialNumber = (items, setItems, index, value) => {
    const serialNumber = (value !== undefined ? value : items[index].serialInput).trim();
    if (!serialNumber) return;

    // Duplicate prevention: a rotational number can't be added twice within the same section
    if (items.some(it => it.serial_numbers.includes(serialNumber))) {
      showToast(`Cylinder "${serialNumber}" is already added in this section.`);
      return;
    }

    const updated = [...items];
    updated[index].serial_numbers.push(serialNumber);
    updated[index].quantity = updated[index].serial_numbers.length;
    updated[index].serialInput = '';

    if (updated[index].direction === 'GIVEN') {
      updated[index].amount = lineAmount(updated[index]);
    }

    setItems(updated);
  };

  const removeSerialNumber = (items, setItems, itemIndex, serialIndex) => {
    const updated = [...items];
    updated[itemIndex].serial_numbers.splice(serialIndex, 1);
    updated[itemIndex].quantity = updated[itemIndex].serial_numbers.length;

    if (updated[itemIndex].direction === 'GIVEN') {
      updated[itemIndex].amount = lineAmount(updated[itemIndex]);
    }

    setItems(updated);
  };

  // Resolve master ids → labels for the saved-bill summary.
  const gasName = (id) => gasTypes.find(g => String(g.gas_type_id || g._id) === String(id))?.gas_type_name || '';
  const sizeLabel = (id) => cylinderSizes.find(s => String(s.size_id || s._id) === String(id))?.size_label || '';

  const isInternal = customerType === 'INTERNAL';

  // Only the sections shown for the CURRENT transaction type belong to this bill.
  // Lines left behind in a hidden section (e.g. a blank Filled line after switching the
  // type to Empty) must be ignored by validation AND by the submitted payload.
  // Internal transfers reuse the givenItems machinery as their "Cylinders to Transfer" section.
  const activeGivenItems = (isInternal || transactionType === 'GIVEN' || transactionType === 'SWAP') ? givenItems : [];
  const activeReceivedItems = (!isInternal && (transactionType === 'RECEIVED' || transactionType === 'SWAP')) ? receivedItems : [];

  // ─── Personal-cylinder return cap (Filled section) — PER gas+size combination (Phase 11) ───
  // A customer's Nitrogen 6 m3 PC balance can never cover a Nitrogen 7 m3 return, so each
  // combo is capped independently against that combo's own at-plant balance (pcBalances,
  // fetched per customer) + personal taken in the Empty section of THIS transaction for the
  // same combo − personal returned on OTHER Filled lines of the same combo.
  // Skipped in same-session edit mode and for filling vendors (their balance may go negative
  // = cylinders with the vendor); the backend per-combo guard still applies.
  const gasNameOf = (gasId) => (gasTypes.find(g => String(g._id) === String(gasId)) || {}).gas_type_name || '';
  const sizeLabelOf = (sizeId) => (cylinderSizes.find(s => String(s._id) === String(sizeId)) || {}).size_label || '';
  const comboKeyOf = (line) => `${gasNameOf(line.gas_type_id)}|${sizeLabelOf(line.cylinder_size_id)}`;
  const isVendor = !!(customerType === 'REGULAR' && selectedCustomer?.is_filling_vendor);
  const basePcFor = (line) => customerType === 'REGULAR' ? (Number(pcBalances[comboKeyOf(line)]) || 0) : 0;
  const sameCombo = (a, b) =>
    String(a.gas_type_id) === String(b.gas_type_id) && String(a.cylinder_size_id) === String(b.cylinder_size_id);
  const personalInForCombo = (gasId, sizeId) => activeReceivedItems.reduce((s, r) =>
    s + ((String(r.gas_type_id) === String(gasId) && String(r.cylinder_size_id) === String(sizeId))
      ? (Number(r.personalCyl) || 0) : 0), 0);
  const personalMaxForGivenLine = (index) => {
    const line = givenItems[index];
    if (!line) return 0;
    const othersOut = givenItems.reduce((s, g, i) =>
      s + ((i === index || !sameCombo(g, line)) ? 0 : (Number(g.personalCyl) || 0)), 0);
    return Math.max(0, basePcFor(line) + personalInForCombo(line.gas_type_id, line.cylinder_size_id) - othersOut);
  };
  const personalCapDetailFor = (index) => {
    const line = givenItems[index];
    if (!line) return '';
    const inn = personalInForCombo(line.gas_type_id, line.cylinder_size_id);
    const combo = `${gasNameOf(line.gas_type_id)} ${sizeLabelOf(line.cylinder_size_id)}`.trim();
    return `customer has ${basePcFor(line)} ${combo || 'of this type'} at plant${inn > 0 ? ` + ${inn} taken in this transaction` : ''}`;
  };
  // ─── Vendor received-back PC cap (Phase 16) — the mirror of the regular-customer cap ───
  // Per combo, "Received Back Filled" PC ≤ outstanding with the vendor (−pcBalances balance,
  // i.e. all earlier bills) + PC sent for filling on THIS bill for the same combo − PC
  // received back on OTHER received lines of the same combo.
  const vendorOutstandingFor = (line) => Math.max(0, -(Number(pcBalances[comboKeyOf(line)]) || 0));
  const personalOutForCombo = (gasId, sizeId) => activeGivenItems.reduce((s, g) =>
    s + ((String(g.gas_type_id) === String(gasId) && String(g.cylinder_size_id) === String(sizeId))
      ? (Number(g.personalCyl) || 0) : 0), 0);
  const vendorReceivedPcMax = (index) => {
    const line = receivedItems[index];
    if (!line) return 0;
    const othersIn = receivedItems.reduce((s, r, i) =>
      s + ((i === index || !sameCombo(r, line)) ? 0 : (Number(r.personalCyl) || 0)), 0);
    return Math.max(0, vendorOutstandingFor(line) + personalOutForCombo(line.gas_type_id, line.cylinder_size_id) - othersIn);
  };
  const vendorReceivedCapDetail = (index) => {
    const line = receivedItems[index];
    if (!line) return '';
    const combo = `${gasNameOf(line.gas_type_id)} ${sizeLabelOf(line.cylinder_size_id)}`.trim();
    return `the vendor has ${vendorOutstandingFor(line)} ${combo || 'of this type'} outstanding from earlier bills + ${personalOutForCombo(line.gas_type_id, line.cylinder_size_id)} sent on this bill`;
  };
  const vendorPersonalOverCap = !editingBillId && isVendor &&
    (transactionType === 'RECEIVED' || transactionType === 'SWAP') &&
    receivedItems.some((r, i) => (Number(r.personalCyl) || 0) > vendorReceivedPcMax(i));

  const personalOverCap = (!editingBillId && !isVendor &&
    (transactionType === 'GIVEN' || transactionType === 'SWAP') &&
    givenItems.some((g, i) => (Number(g.personalCyl) || 0) > personalMaxForGivenLine(i)))
    || vendorPersonalOverCap;

  const handleSubmit = async (e) => {
    e.preventDefault();

    // ── Internal transfer: no customer, no amounts — just move cylinders between sites ──
    if (isInternal) {
      if (fromLocation === toLocation) { showToast('From and To locations must be different'); return; }
      const serials = givenItems.flatMap(it => it.serial_numbers);
      const pcItems = transferPc.filter(p => p.gas_type_id && p.cylinder_size_id && Number(p.quantity) > 0);
      if (serials.length === 0 && pcItems.length === 0) { showToast('Add at least one cylinder (or personal-cylinder quantity) to transfer'); return; }
      if (!challanNo.trim()) {
        setChallanError('Challan number is required.');
        showToast('Challan number is required.');
        return;
      }
      setChallanError('');

      const summaryLines = [
        ...givenItems.filter(it => it.serial_numbers.length > 0).map(it => ({
          direction: 'TRANSFER', gas: gasName(it.gas_type_id), size: sizeLabel(it.cylinder_size_id),
          serials: [...it.serial_numbers], qty: it.serial_numbers.length, rate: 0, amount: 0, personalCyl: 0
        })),
        // PC quantities ride as their own summary lines (Phase 13) — shown on screen and in print.
        ...pcItems.map(p => ({
          direction: 'TRANSFER', gas: gasName(p.gas_type_id), size: sizeLabel(p.cylinder_size_id),
          serials: [], qty: 0, rate: 0, amount: 0, personalCyl: Number(p.quantity)
        }))
      ];

      try {
        // Same-session Edit Bill (Phase 13): re-saving an edited transfer PUTs the existing
        // bill (logEdit:false → no audit entry, matching customer-bill same-session edits).
        const response = await apiFetch(editingBillId ? `${API_URL}/bills/${editingBillId}` : `${API_URL}/bills`, {
          method: editingBillId ? 'PUT' : 'POST',
          headers: (editingBillId && stepUpAuth) ? { 'x-step-up-token': stepUpAuth.step_up_token } : {},
          body: JSON.stringify({
            transaction_category: 'INTERNAL_TRANSFER',
            draft_id: editingBillId ? undefined : (draftId || undefined), // finalizing a draft keeps its bill number
            bill_date: combinedBillDate(),
            challan_no: composeChallan(),
            from_location: fromLocation,
            to_location: toLocation,
            serial_numbers: serials,
            // PC transfer quantities (Phase 11): moves per-location PC stock only.
            personal_items: pcItems.map(p => ({ gas_type_id: p.gas_type_id, cylinder_size_id: p.cylinder_size_id, quantity: Number(p.quantity) })),
            logEdit: false,
            remarks
          })
        });
        if (response.ok) {
          const result = await response.json();
          // Transfers are editable from the success screen since Phase 13 — carry bill_id +
          // the endpoints so Edit Bill can repopulate the form.
          setSavedBill({
            bill_id: result.bill_id || editingBillId || null,
            bill_number: result.bill_number || editingBillNo,
            challan_no: result.challan_no || composeChallan(),
            amount: 0, customer_id: null,
            customer_name: `Internal Transfer: ${locationText(fromLocation)} → ${locationText(toLocation)}`,
            customer_address: '', bill_date: combinedBillDate(), transaction_type: 'TRANSFER',
            from_location: fromLocation, to_location: toLocation,
            lines: summaryLines
          });
          showToast(`Transfer ${result.bill_number || editingBillNo} ${editingBillId ? 'updated' : 'saved'}.`, 'success');
          setDraftId(null); setDraftBillNo(''); // draft (if any) was finalized
          setEditingBillId(null); setEditingBillNo('');
          setTransferPc([]);
          fetchCylinders(); // locations changed
        } else {
          showToast(await apiErrorMessage(response, 'Error saving transfer'));
        }
      } catch (error) {
        console.error('Error:', error);
      }
      return;
    }

    // Validation (inline toasts — no native popups)
    if (customerType === 'REGULAR' && !selectedCustomer) {
      showToast('Please select a customer'); return;
    }
    if (customerType === 'ONE_TIME' && !oneTimeCustomer.company_name) {
      showToast('Please enter the one-time customer details'); return;
    }
    if (activeGivenItems.length === 0 && activeReceivedItems.length === 0) {
      showToast('Please add at least one cylinder'); return;
    }

    // Every ACTIVE line — regardless of direction (Filled, Empty, or Swap) — must have a
    // gas type + size, and EITHER a cylinder number OR a personal-cylinder count.
    const allItems = [...activeGivenItems, ...activeReceivedItems];
    for (const item of allItems) {
      if (!item.gas_type_id || !item.cylinder_size_id) {
        showToast('Each cylinder line needs a gas type and size'); return;
      }
      if (item.serial_numbers.length === 0 && (Number(item.personalCyl) || 0) <= 0) {
        showToast('Add a cylinder number or a personal cylinder count to each line'); return;
      }
    }

    if (personalOverCap) {
      showToast('Personal cylinders returned exceed what the customer has at the plant'); return;
    }

    // Over-limit HARD block (Phase 5), overridable with step-up authorization (Phase 18).
    // The backend enforces both the block and the authorization independently on save.
    if (!editingBillId && isOverLimit && !overLimitAuth) {
      showToast(`Blocked: this bill would put ${selectedCustomer.company_name} over their holding limit (${newCylinderHold} vs ${selectedCustomer.holding_limit}). Request authorization or save for later.`);
      return;
    }

    // Challan No. is required on the New Transaction form (item 4).
    if (!challanNo.trim()) {
      setChallanError('Challan number is required.');
      showToast('Challan number is required.');
      return;
    }
    setChallanError('');

    const billData = {
      draft_id: draftId || undefined, // finalizing a draft keeps its bill number
      // Over-limit override approval (Phase 18) — present only after Request Authorization.
      step_up_token: overLimitAuth?.step_up_token || undefined,
      customer_id: selectedCustomer?.customer_id,
      customer_type: customerType,
      one_time_customer: customerType === 'ONE_TIME' ? oneTimeCustomer : null,
      bill_date: combinedBillDate(),
      transaction_type: transactionType,
      challan_no: composeChallan(),
      bill_number: billNumber.trim() || undefined, // Phase 27: user-editable; blank → backend auto-numbers
      vehicle_number: vehicleNumber.trim(),        // Phase 27: optional
      location,
      remarks,
      given_items: activeGivenItems.length > 0 ? activeGivenItems.map(it => ({
        ...it,
        rate: Number(it.rate) || 0,
        amount: lineAmount(it),   // always derived: rate × cylinder count (never stale/NaN)
        personalCylindersOut: Number(it.personalCyl) || 0
      })) : null,
      received_items: activeReceivedItems.length > 0 ? activeReceivedItems.map(it => ({ ...it, personalCylindersIn: Number(it.personalCyl) || 0 })) : null
    };

    // Snapshot the cylinder lines for the confirmation screen.
    const summaryLines = allItems.map(it => ({
      direction: it.direction,
      gas: gasName(it.gas_type_id),
      size: sizeLabel(it.cylinder_size_id),
      serials: [...it.serial_numbers],
      qty: it.serial_numbers.length,
      rate: Number(it.rate) || 0,
      amount: it.direction === 'GIVEN' ? lineAmount(it) : 0,
      personalCyl: Number(it.personalCyl) || 0
    }));

    try {
      if (editingBillId) {
        // ── Same-session correction: update the EXISTING bill (PUT, logEdit:false → no audit) ──
        const line_items = allItems.flatMap(it => {
          const pIn = it.direction === 'RECEIVED' ? (Number(it.personalCyl) || 0) : 0;
          const pOut = it.direction === 'GIVEN' ? (Number(it.personalCyl) || 0) : 0;
          const rate = it.direction === 'GIVEN' ? (it.rate || 0) : 0;
          const serials = it.serial_numbers || [];
          if (serials.length === 0) {
            return [{ direction: it.direction, gas_type_id: it.gas_type_id, cylinder_size_id: it.cylinder_size_id,
              serial_number: '', rate, personalCylindersIn: pIn, personalCylindersOut: pOut }];
          }
          return serials.map((s, idx) => ({ direction: it.direction, gas_type_id: it.gas_type_id, cylinder_size_id: it.cylinder_size_id,
            serial_number: s, rate, personalCylindersIn: idx === 0 ? pIn : 0, personalCylindersOut: idx === 0 ? pOut : 0 }));
        });
        const response = await apiFetch(`${API_URL}/bills/${editingBillId}`, {
          method: 'PUT',
          headers: stepUpAuth ? { 'x-step-up-token': stepUpAuth.step_up_token } : {},
          body: JSON.stringify({ bill_date: combinedBillDate(), challan_no: composeChallan(), vehicle_number: vehicleNumber.trim(), transaction_type: transactionType, logEdit: false, line_items })
        });
        if (response.ok) {
          await response.json();
          setSavedBill({
            bill_id: editingBillId, bill_number: editingBillNo, challan_no: composeChallan(), amount: totalAmount,
            customer_id: selectedCustomer?.customer_id,
            customer_name: selectedCustomer?.company_name || oneTimeCustomer.company_name,
            customer_address: selectedCustomer?.address || oneTimeCustomer.address || '',
            customer_gst: selectedCustomer?.gst_number || '',
            customer_contact: selectedCustomer?.phone_primary || '',
            vehicle_number: vehicleNumber.trim(),
            is_filling_vendor: isVendor,
            bill_date: combinedBillDate(), transaction_type: transactionType, lines: summaryLines
          });
          setEditingBillId(null); setEditingBillNo('');
          showToast(`Bill ${editingBillNo} updated.`, 'success');
          fetchCustomers(); // refresh personalCylindersAtPlant / holdings for follow-up transactions
        } else {
          showToast(await apiErrorMessage(response, 'Error updating bill'));
        }
        return;
      }

      // Reusable success handler (shared by the direct save and the pre-software confirm path).
      const finishCreate = (result) => {
        setSavedBill({
          bill_id: result.bill_id,
          bill_number: result.bill_number,
          challan_no: result.challan_no || challanNo,
          amount: totalAmount,
          customer_id: selectedCustomer?.customer_id,
          customer_name: selectedCustomer?.company_name || oneTimeCustomer.company_name,
          customer_address: selectedCustomer?.address || oneTimeCustomer.address || '',
          customer_gst: selectedCustomer?.gst_number || '',
          customer_contact: selectedCustomer?.phone_primary || '',
          vehicle_number: vehicleNumber.trim(),
          is_filling_vendor: isVendor,
          bill_date: combinedBillDate(),
          transaction_type: transactionType,
          lines: summaryLines
        });
        showToast(`Bill ${result.bill_number} saved.`, 'success');
        setDraftId(null); setDraftBillNo(''); // draft (if any) was finalized
        fetchCustomers(); // refresh personalCylindersAtPlant / holdings for follow-up transactions
      };
      const postBill = (extra) => apiFetch(`${API_URL}/bills`, {
        method: 'POST', body: JSON.stringify(extra ? { ...billData, ...extra } : billData)
      });

      const response = await postBill();
      if (response.ok) {
        const result = await response.json();
        // Phase 34: backdated entry that contradicts only the migration placeholder — confirm first.
        if (result.requires_pre_software_confirmation) {
          setPreSoftware({
            cylinders: result.cylinders || [],
            message: result.message,
            onConfirm: async () => {
              setPreSoftware(null);
              const r2 = await postBill({ confirm_pre_software: true });
              if (r2.ok) finishCreate(await r2.json());
              else showToast(await apiErrorMessage(r2, 'Error creating bill'));
            }
          });
          return;
        }
        finishCreate(result);
      } else {
        showToast(await apiErrorMessage(response, 'Error creating bill'));
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  // Same-session "Edit Bill": repopulate the full form from the just-created bill, then PUT on re-save.
  const editSavedBill = () => {
    if (!savedBill) return;
    setEditingBillId(savedBill.bill_id);
    setEditingBillNo(savedBill.bill_number);
    setBillDate((savedBill.bill_date || '').slice(0, 10) || new Date().toISOString().split('T')[0]);
    setBillTime(billTimeFrom(savedBill.bill_date));
    // The challan input holds the full value now (Phase 14) — put it back verbatim.
    setChallanNo(savedBill.challan_no || '');
    setChallanError('');
    // Phase 27: carry the bill number + vehicle number back into the form for the edit.
    setBillNumber(savedBill.bill_number || '');
    setBillNumberEdited(true);
    setVehicleNumber(savedBill.vehicle_number || '');

    // Internal transfer (Phase 13): rebuild the transfer form — cylinders + PC quantities.
    if (savedBill.transaction_type === 'TRANSFER') {
      setCustomerType('INTERNAL');
      if (savedBill.from_location) setFromLocation(savedBill.from_location);
      if (savedBill.to_location) setToLocation(savedBill.to_location);
      const tLines = (savedBill.lines || []).filter(l => l.direction === 'TRANSFER');
      setGivenItems(tLines.filter(l => (l.serials || []).length > 0).map(l => ({
        direction: 'GIVEN',
        gas_type_id: gasTypes.find(x => x.gas_type_name === l.gas)?._id || '',
        cylinder_size_id: cylinderSizes.find(x => x.size_label === l.size)?._id || '',
        serial_numbers: [...(l.serials || [])],
        serialInput: '', quantity: (l.serials || []).length, rate: 0, amount: 0, personalCyl: ''
      })));
      setTransferPc(tLines.filter(l => (Number(l.personalCyl) || 0) > 0).map(l => ({
        gas_type_id: String(gasTypes.find(x => x.gas_type_name === l.gas)?._id || ''),
        cylinder_size_id: String(cylinderSizes.find(x => x.size_label === l.size)?._id || ''),
        quantity: Number(l.personalCyl)
      })));
      setReceivedItems([]);
      setShowPostSavePaymentForm(false);
      setSavedBill(null); // back to the full form
      return;
    }

    setTransactionType(savedBill.transaction_type || 'GIVEN');
    // Re-select the customer (regular) so personal cylinders / holding limits resolve.
    if (savedBill.customer_id) {
      const cust = customers.find(c => String(c.customer_id || c._id) === String(savedBill.customer_id));
      if (cust) { setCustomerType('REGULAR'); setSelectedCustomer(cust); setCustQuery(cust.company_name); }
    }
    // Rebuild Given/Received line items (map gas name → id, size label → id).
    const toItems = (dir) => (savedBill.lines || []).filter(l => l.direction === dir).map(l => ({
      direction: dir,
      gas_type_id: gasTypes.find(g => g.gas_type_name === l.gas)?._id || '',
      cylinder_size_id: cylinderSizes.find(s => s.size_label === l.size)?._id || '',
      serial_numbers: [...(l.serials || [])],
      serialInput: '',
      quantity: (l.serials || []).length,
      rate: l.rate || 0,
      amount: (l.rate || 0) * (l.serials || []).length,
      personalCyl: Number(l.personalCyl) || ''   // 0 → '' so the input shows its placeholder
    }));
    setGivenItems(toItems('GIVEN'));
    setReceivedItems(toItems('RECEIVED'));
    setShowPostSavePaymentForm(false);
    setSavedBill(null); // back to the full form
  };

  // Stock-eligible pool for a section, IGNORING gas type + size and already-used numbers.
  //   GIVEN   -> IN_STOCK cylinders (plus any received in THIS swap bill = round-trip)
  //   RECEIVED-> ALL at-customer cylinders (any customer); cross-customer returns are auto-detected
  //   Internal transfer -> IN_STOCK cylinders AT the From location only
  const getEligiblePool = (direction) => {
    if (direction === 'RECEIVED') {
      // Filling-vendor bills (Phase 15): NO cross-customer return path — only cylinders
      // currently with THIS vendor, plus serials sent for filling on this same bill (round
      // trip). The same pool serves the dropdown AND manual typing, so a removed auto-echoed
      // serial can always be re-added by hand.
      if (isVendor) {
        const vendorId = String(selectedCustomer?.customer_id || '');
        const own = inRotationCyls.filter(c => String(c.holder_id || '') === vendorId);
        const sentSerials = new Set(givenItems.flatMap(gi => gi.serial_numbers || []));
        cylinders.forEach(c => {
          if (sentSerials.has(c.rotational_number) && !own.some(p => p.rotational_number === c.rotational_number)) {
            own.push(c);
          }
        });
        return own;
      }
      let receivedPool = [...inRotationCyls];
      if (transactionType === 'SWAP') {
        const givenSerials = new Set(givenItems.flatMap(gi => gi.serial_numbers || []));
        cylinders.forEach(c => {
          if (givenSerials.has(c.rotational_number) && !receivedPool.some(p => p.rotational_number === c.rotational_number)) {
            receivedPool.push(c);
          }
        });
      }
      return receivedPool;
    }
    let pool = cylinders.filter(c => c.stock_state === 'IN_STOCK' && !c.under_maintenance);
    if (isInternal) {
      return pool.filter(c => c.location === fromLocation);
    }
    // Customer bills: only cylinders in stock AT the selected transaction location are givable.
    pool = pool.filter(c => c.location === location);
    if (transactionType === 'SWAP') {
      const receivedSerials = new Set(receivedItems.flatMap(ri => ri.serial_numbers));
      cylinders.forEach(c => {
        if (receivedSerials.has(c.rotational_number) && !pool.some(p => p._id === c._id)) {
          pool.push(c);
        }
      });
    }
    return pool;
  };

  const usedInSection = (direction) => {
    const sectionItems = direction === 'GIVEN' ? givenItems : receivedItems;
    return new Set(sectionItems.flatMap(it => it.serial_numbers));
  };

  // Cylinders selectable in the gas/size-filtered dropdown for a line (flow A: gas+size first).
  const getAvailableCylinders = (item, direction) => {
    const gasName = gasTypes.find(g => String(g._id) === String(item.gas_type_id))?.gas_type_name;
    const sizeLabel = cylinderSizes.find(s => String(s._id) === String(item.cylinder_size_id))?.size_label;
    if (!gasName || !sizeLabel) return [];
    const used = usedInSection(direction);
    return getEligiblePool(direction)
      .filter(c => c.gas_type === gasName && c.capacity === sizeLabel && !used.has(c.rotational_number));
  };

  // Pool for the direct cylinder-number search (flow B). When the line already has serials its
  // gas/size is locked, so restrict the search to matching cylinders; otherwise allow the full pool.
  const getSearchPool = (item, direction) => {
    const used = usedInSection(direction);
    let pool = getEligiblePool(direction).filter(c => !used.has(c.rotational_number));
    if (item.serial_numbers.length > 0) {
      const gasName = gasTypes.find(g => String(g._id) === String(item.gas_type_id))?.gas_type_name;
      const sizeLabel = cylinderSizes.find(s => String(s._id) === String(item.cylinder_size_id))?.size_label;
      pool = pool.filter(c => c.gas_type === gasName && c.capacity === sizeLabel);
    }
    return pool;
  };

  // The customer this transaction is for (regular = selected id; one-time = none yet).
  const currentCustomerId = customerType === 'REGULAR' ? (selectedCustomer?.customer_id || null) : null;

  // Cross-customer mismatch: if a received cylinder's current holder differs from this transaction's
  // customer, return the holder's name (for the inline warning); otherwise null.
  const mismatchFor = (serial) => {
    const cyl = inRotationCyls.find(c => c.rotational_number === serial);
    if (!cyl || !cyl.holder_id) return null;                       // unknown holder — no warning
    if (String(cyl.holder_id) === String(currentCustomerId)) return null; // same customer — normal
    return cyl.holder_name || 'another customer';                  // mismatch — return holder name
  };

  // Flow B: pick a cylinder by number → auto-fill gas type + size and add it, atomically.
  // If the chosen cylinder's gas/size differs from the line's current gas/size, any previously
  // selected (now-incompatible) serials in that line are cleared.
  const selectCylinderForLine = (items, setItems, index, cyl) => {
    const gasId = String(gasTypes.find(g => g.gas_type_name === cyl.gas_type)?._id || '');
    const sizeId = String(cylinderSizes.find(s => s.size_label === cyl.capacity)?._id || '');

    if (items.some(it => it.serial_numbers.includes(cyl.rotational_number))) {
      showToast(`Cylinder "${cyl.rotational_number}" is already added in this section.`);
      return;
    }

    setItems(prev => {
      const updated = prev.map((it, i) => i === index ? { ...it, serial_numbers: [...it.serial_numbers] } : it);
      const line = updated[index];
      const gasChanged = line.gas_type_id && String(line.gas_type_id) !== gasId;
      const sizeChanged = line.cylinder_size_id && String(line.cylinder_size_id) !== sizeId;
      if (gasChanged || sizeChanged) line.serial_numbers = []; // drop serials that no longer match
      line.gas_type_id = gasId;
      line.cylinder_size_id = sizeId;
      line.serial_numbers.push(cyl.rotational_number);
      line.quantity = line.serial_numbers.length;
      if (line.direction === 'GIVEN') line.amount = lineAmount(line);
      return updated;
    });
  };

  // Pick a cylinder (two-step flow): auto-fill gas type + size for the line WITHOUT adding the
  // chip — the chip is added later when the user presses "Add". Done atomically to avoid clobbering.
  const pickCylinderForLine = (items, setItems, index, cyl) => {
    const gasId = String(gasTypes.find(g => g.gas_type_name === cyl.gas_type)?._id || '');
    const sizeId = String(cylinderSizes.find(s => s.size_label === cyl.capacity)?._id || '');
    setItems(prev => {
      const updated = prev.map((it, i) => i === index ? { ...it, serial_numbers: [...it.serial_numbers] } : it);
      const line = updated[index];
      const gasChanged = line.gas_type_id && String(line.gas_type_id) !== gasId;
      const sizeChanged = line.cylinder_size_id && String(line.cylinder_size_id) !== sizeId;
      if (gasChanged || sizeChanged) line.serial_numbers = []; // drop serials that no longer match
      line.gas_type_id = gasId;
      line.cylinder_size_id = sizeId;
      line.quantity = line.serial_numbers.length;
      if (line.direction === 'GIVEN') line.amount = lineAmount(line);
      return updated;
    });
  };

  // Set of all rotational numbers known to inventory (used to flag manually-entered/unmapped numbers)
  const knownRotational = new Set(cylinders.map(c => c.rotational_number));

  const renderGivenSection = () => (
    <div className="txn-section txn-section-given" style={{marginTop: '2rem'}}>
      <h3>{isInternal
        ? `Cylinders to Transfer (in stock at ${locationText(fromLocation)})`
        : isVendor ? '🏭 Cylinders Sent for Filling' : 'Cylinders Filled to Customer'}</h3>
      {isVendor && !isInternal && (
        <p style={{color:'var(--text-muted)', fontSize:'0.78rem', margin:'0.25rem 0 0.5rem'}}>
          Filling vendor: these cylinders leave {locationText(location)} to be filled by {selectedCustomer?.company_name}. No holding limit applies.
        </p>
      )}
      {givenItems.map((item, index) => (
        <CylinderItem
          key={index}
          item={item}
          index={index}
          gasTypes={gasTypes}
          cylinderSizes={cylinderSizes}
          availableCylinders={getAvailableCylinders(item, 'GIVEN')}
          searchPool={getSearchPool(item, 'GIVEN')}
          knownRotational={knownRotational}
          hidePersonal={isInternal}
          personalLabel="Personal cylinders returned to customer:"
          personalLink="+ Returning customer's cylinders? Tap to record"
          personalMax={(editingBillId || isVendor) ? null : personalMaxForGivenLine(index)}
          personalCapDetail={personalCapDetailFor(index)}
          onUpdate={(field, value) => updateGivenItem(index, field, value)}
          onAddSerial={(value) => addSerialNumber(givenItems, setGivenItems, index, value)}
          onSelectCylinder={(cyl) => selectCylinderForLine(givenItems, setGivenItems, index, cyl)}
          onPickCylinder={(cyl) => pickCylinderForLine(givenItems, setGivenItems, index, cyl)}
          onRemoveSerial={(serialIndex) => removeSerialNumber(givenItems, setGivenItems, index, serialIndex)}
          onRemove={() => setGivenItems(givenItems.filter((_, i) => i !== index))}
          showRate={!isInternal}
        />
      ))}
      <div style={{display: 'flex', justifyContent: 'flex-end'}}>
        <button type="button" className="btn btn-primary" onClick={addGivenItem}>
          + Add Cylinder Type
        </button>
      </div>

      {/* PC transfer (Phase 11): quantity-only personal cylinders moving between sites —
          updates the per-location PC stock; inventory cylinders are untouched. */}
      {isInternal && (
        <div style={{marginTop:'1.25rem', paddingTop:'0.75rem', borderTop:'1px dashed var(--border)'}}>
          <h4 style={{margin:'0 0 0.4rem'}}>🔄 Personal Cylinders to Transfer (optional)</h4>
          {transferPc.map((p, i) => (
            <div key={i} className="form-row cols-3" style={{alignItems:'end', marginBottom:'0.4rem'}}>
              <div className="form-group" style={{marginBottom:0}}>
                <label>Gas Type</label>
                <select className="form-control" value={p.gas_type_id}
                  onChange={(e) => setTransferPc(prev => prev.map((x, j) => j === i ? { ...x, gas_type_id: e.target.value, cylinder_size_id: '' } : x))}>
                  <option value="">-- Select --</option>
                  {gasTypes.map(g => <option key={g._id} value={g._id}>{g.gas_type_name}</option>)}
                </select>
              </div>
              <div className="form-group" style={{marginBottom:0}}>
                <label>Size</label>
                <select className="form-control" value={p.cylinder_size_id} disabled={!p.gas_type_id}
                  onChange={(e) => setTransferPc(prev => prev.map((x, j) => j === i ? { ...x, cylinder_size_id: e.target.value } : x))}>
                  <option value="">-- Select --</option>
                  {(GAS_CAPACITIES[gasNameOf(p.gas_type_id)] || []).map(label => {
                    const sz = cylinderSizes.find(s => s.size_label === label);
                    return sz ? <option key={sz._id} value={sz._id}>{label}</option> : null;
                  })}
                </select>
              </div>
              <div className="form-group" style={{marginBottom:0}}>
                <label>Quantity</label>
                <div style={{display:'flex', gap:'0.4rem'}}>
                  <input type="number" min="0" className="form-control" value={p.quantity}
                    onChange={(e) => setTransferPc(prev => prev.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} />
                  <button type="button" className="btn btn-danger" title="Remove line"
                    onClick={() => setTransferPc(prev => prev.filter((_, j) => j !== i))}>🗑️</button>
                </div>
              </div>
            </div>
          ))}
          <button type="button" className="btn btn-secondary"
            onClick={() => setTransferPc(prev => [...prev, { gas_type_id: '', cylinder_size_id: '', quantity: 0 }])}>
            + Add Personal Cylinders
          </button>
        </div>
      )}
    </div>
  );

  const renderReceivedSection = () => (
    <div className="txn-section txn-section-received" style={{marginTop: '2rem'}}>
      <h3>{isVendor ? '🏭 Cylinders Received Back Filled' : 'Cylinders Empty from Customer'}</h3>
      {getEligiblePool('RECEIVED').length === 0 && (
        <div className="alert alert-warning">
          {isVendor
            ? 'No cylinders are with this vendor yet — add serials to "Sent for Filling" first, or receive back cylinders already with the vendor.'
            : 'No cylinders are currently in rotation to receive.'}
        </div>
      )}
      {receivedItems.map((item, index) => (
        <CylinderItem
          key={index}
          item={item}
          index={index}
          gasTypes={gasTypes}
          cylinderSizes={cylinderSizes}
          availableCylinders={getAvailableCylinders(item, 'RECEIVED')}
          searchPool={getSearchPool(item, 'RECEIVED')}
          knownRotational={knownRotational}
          mismatchFor={mismatchFor}
          notFoundMessage={isVendor
            ? 'Only cylinders currently with this filling vendor (or sent for filling on this bill) can be received back here.'
            : ''}
          personalMax={(editingBillId || !isVendor) ? null : vendorReceivedPcMax(index)}
          personalCapDetail={isVendor ? vendorReceivedCapDetail(index) : ''}
          personalLabel={isVendor ? 'Personal cylinders received back filled:' : 'Personal cylinders taken from customer:'}
          personalLink="+ Customer's own cylinders? Tap to record"
          onUpdate={(field, value) => updateReceivedItem(index, field, value)}
          onAddSerial={(value) => addSerialNumber(receivedItems, setReceivedItems, index, value)}
          onSelectCylinder={(cyl) => selectCylinderForLine(receivedItems, setReceivedItems, index, cyl)}
          onPickCylinder={(cyl) => pickCylinderForLine(receivedItems, setReceivedItems, index, cyl)}
          onRemoveSerial={(serialIndex) => removeSerialNumber(receivedItems, setReceivedItems, index, serialIndex)}
          onRemove={() => setReceivedItems(receivedItems.filter((_, i) => i !== index))}
          showRate={false}
        />
      ))}
      <div style={{display: 'flex', justifyContent: 'flex-end'}}>
        <button type="button" className="btn btn-primary" onClick={addReceivedItem}>
          + Add Cylinder Type
        </button>
      </div>
    </div>
  );

  // Totals count ONLY the sections active for the current transaction type, and the bill
  // amount is derived live (rate × cylinder count per Filled line) — never from stored state.
  const totalGiven = activeGivenItems.reduce((sum, item) => sum + item.serial_numbers.length, 0);
  const totalReceived = activeReceivedItems.reduce((sum, item) => sum + item.serial_numbers.length, 0);
  const totalAmount = activeGivenItems.reduce((sum, item) => sum + lineAmount(item), 0);
  // Summary totals include personal-cylinder quantities (Phase 14) — display only; the
  // holding-limit math below still uses inventory serials.
  const pcGivenTotal = activeGivenItems.reduce((sum, item) => sum + (Number(item.personalCyl) || 0), 0);
  const pcReceivedTotal = activeReceivedItems.reduce((sum, item) => sum + (Number(item.personalCyl) || 0), 0);
  const pcTransferTotal = isInternal ? transferPc.reduce((sum, p) => sum + (Number(p.quantity) || 0), 0) : 0;
  // Only this customer's OWN cylinders coming back reduce their holding — a serial held by a
  // different customer is settled on that holder's behalf and never nets here (Phase 7 fix,
  // mirrors the backend's countOwnReturns / computeHoldings rule).
  const ownReceived = activeReceivedItems.reduce((sum, item) =>
    sum + item.serial_numbers.filter(s => !mismatchFor(s)).length, 0);
  const newCylinderHold = (selectedCustomer?.cylinders_held || 0) + totalGiven - ownReceived;
  // Filling vendors are fully exempt from the holding-limit block (Phase 11).
  const isOverLimit = selectedCustomer && !selectedCustomer.is_filling_vendor && newCylinderHold > selectedCustomer.holding_limit;

  // Step-up approval modal (Phase 18) — rendered on both the success screen and the form.
  const stepUpModal = stepUpAsk ? (
    <StepUpVerificationModal
      title={stepUpAsk.title}
      context={stepUpAsk.context}
      message={stepUpAsk.message || 'This action needs approval from a trusted person.'}
      onVerified={(auth) => { const a = stepUpAsk; setStepUpAsk(null); a.action(auth); }}
      onClose={() => setStepUpAsk(null)}
    />
  ) : null;

  // Phase 34: pre-software confirmation — a backdated entry that contradicts only the migration
  // placeholder. Confirming saves it as genuine pre-software history; it never moves live stock.
  const preSoftwareModal = preSoftware ? (
    <div className="modal-overlay" onClick={() => setPreSoftware(null)}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{maxWidth:'560px'}}>
        <div className="modal-header">
          <span>⏳ Confirm pre-software entry</span>
          <button className="modal-close" onClick={() => setPreSoftware(null)}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{marginTop:0}}>{preSoftware.message}</p>
          <ul style={{margin:'0.5rem 0 1rem', paddingLeft:'1.2rem'}}>
            {preSoftware.cylinders.map(c => (
              <li key={c.serial} style={{marginBottom:'0.3rem'}}>
                <strong>Cylinder {c.serial}</strong> — earliest record shows <em>{c.snapshot}</em>; you're recording it as {c.direction === 'received' ? 'received back' : 'given out'}.
              </li>
            ))}
          </ul>
          <div className="alert alert-warning" style={{fontSize:'0.85rem'}}>
            Confirm only if this reflects genuine history from before CylinderPro. It won't change the cylinder's current location or stock.
          </div>
          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={() => setPreSoftware(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={preSoftware.onConfirm}>Confirm &amp; Save</button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  if (savedBill) {
    return (
      <div className="card">
        <div className="alert alert-success">
          ✓ Bill <strong>{savedBill.bill_number}</strong> created successfully!
        </div>
        {stepUpModal}
        {preSoftwareModal}

        {/* Bill summary */}
        <div style={{padding:'1rem', background:'#f8f9fa', borderRadius:'8px', marginBottom:'1rem'}}>
          <div className="form-row" style={{marginBottom:'0.5rem'}}>
            <div><strong>Bill No:</strong> {savedBill.bill_number}</div>
            <div><strong>Date:</strong> {formatDate(savedBill.bill_date)}</div>
            <div><strong>Type:</strong> {directionLabel(savedBill.transaction_type, { vendor: savedBill.is_filling_vendor })}</div>
          </div>
          <div className="form-row" style={{marginBottom:'0.5rem'}}>
            <div><strong>Customer:</strong> {savedBill.customer_name || '—'}</div>
            {savedBill.challan_no && <div><strong>Challan No:</strong> {savedBill.challan_no}</div>}
            <div><strong>Bill Amount:</strong> ₹{(savedBill.amount || 0).toFixed(2)}</div>
          </div>
          {savedBill.lines && savedBill.lines.length > 0 && (
            <table style={{marginTop:'0.5rem'}}>
              <thead>
                <tr><th>Direction</th><th>Gas Type</th><th>Size</th><th>Cylinders</th><th>Qty</th></tr>
              </thead>
              <tbody>
                {savedBill.lines.map((l, i) => {
                  const p = Number(l.personalCyl) || 0;
                  return (
                  <tr key={i}>
                    <td>{directionLabel(l.direction, { vendor: savedBill.is_filling_vendor })}</td>
                    <td>{l.gas}</td>
                    <td>{l.size}</td>
                    <td style={{fontSize:'0.8rem'}}>
                      {l.serials.join(', ')}
                      {p > 0 && <span style={{color:'var(--text-2)'}}>{l.serials.length ? ', ' : ''}(Personal Cyl. ×{p})</span>}
                    </td>
                    <td>{p > 0 ? `${l.serials.length} + ${p} personal` : l.qty}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {!showPostSavePaymentForm ? (
          <div>
            <div className="btn-group">
              <button className="btn btn-secondary" onClick={() => printSavedBill(savedBill)}>🖨 Print / PDF</button>
              {savedBill.bill_id && (
                <button className="btn btn-secondary" title="Requires approval from a trusted person"
                  onClick={() => setStepUpAsk({
                    title: `Approve editing ${savedBill.bill_number}`,
                    context: `edit Bill ${savedBill.bill_number}${savedBill.customer_name ? ` for ${savedBill.customer_name}` : ''} (just saved)`,
                    action: (auth) => { setStepUpAuth(auth); editSavedBill(); }
                  })}>✏️ Edit Bill</button>
              )}
              {savedBill.customer_id && onViewCustomer && (
                <button className="btn btn-secondary" onClick={() => onViewCustomer(String(savedBill.customer_id))}>
                  👤 View Customer
                </button>
              )}
              {onNewTransaction && (
                <button className="btn btn-secondary" onClick={onNewTransaction}>
                  🧾 New Transaction
                </button>
              )}
              {savedBill.customer_id && (
                <button className="btn btn-primary" onClick={() => setShowPostSavePaymentForm(true)}>
                  Record Payment Now
                </button>
              )}
              <button className="btn btn-secondary" onClick={onBack}>
                Back to Dashboard
              </button>
            </div>
            <div style={{fontSize:'0.75rem', color:'var(--text-muted)', marginTop:'0.5rem'}}>
              Tip: In the Chrome print dialog, uncheck “Headers and footers” for the cleanest output.
            </div>
          </div>
        ) : (
          <div>
            <h3 style={{margin: '1rem 0 0.5rem'}}>Record Payment Received</h3>
            <PaymentForm
              customerId={savedBill.customer_id}
              billId={savedBill.bill_id}
              challanNo={savedBill.challan_no}
              onSuccess={onBack}
              onCancel={() => setShowPostSavePaymentForm(false)}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      {stepUpModal}
      {preSoftwareModal}
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'0.5rem'}}>
        <h2 style={{margin:0, border:'none', padding:0}}>New Transaction / Bill</h2>
        {!editingBillId && (
          <button type="button" className="btn btn-secondary" onClick={openDrafts}>
            📂 Resume Saved Draft
          </button>
        )}
      </div>
      {draftId && (
        <div className="alert alert-warning" style={{margin:'0.75rem 0 0', fontSize:'0.82rem'}}>
          📝 Continuing draft <strong>{draftBillNo}</strong> — saving the bill will finalize it under this number.
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        {/* Customer Type Selection */}
        <div className="form-group">
          <label>Customer Type</label>
          <div>
            <label style={{marginRight: '1rem'}}>
              <input
                type="radio"
                value="REGULAR"
                checked={customerType === 'REGULAR'}
                onChange={(e) => setCustomerType(e.target.value)}
              /> Regular Customer
            </label>
            <label style={{marginRight: '1rem'}}>
              <input
                type="radio"
                value="ONE_TIME"
                checked={customerType === 'ONE_TIME'}
                onChange={(e) => setCustomerType(e.target.value)}
              /> One-Time Customer
            </label>
            <label>
              <input
                type="radio"
                value="INTERNAL"
                checked={customerType === 'INTERNAL'}
                onChange={(e) => { setCustomerType(e.target.value); setSelectedCustomer(null); setGivenItems([]); setReceivedItems([]); }}
              /> Internal Transfer
            </label>
          </div>
        </div>

        {/* Internal transfer: From/To sites replace the customer selection */}
        {isInternal && (
          <div className="form-row">
            <div className="form-group">
              <label>From Location *</label>
              <select className="form-control" value={fromLocation}
                onChange={(e) => { setFromLocation(e.target.value); setGivenItems([]); }}>
                {LOCATIONS.map(l => <option key={l} value={l}>{LOCATION_LABELS[l]}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>To Location *</label>
              <select className="form-control" value={toLocation}
                onChange={(e) => setToLocation(e.target.value)}>
                {LOCATIONS.map(l => <option key={l} value={l}>{LOCATION_LABELS[l]}</option>)}
              </select>
              {fromLocation === toLocation && (
                <div className="field-error">From and To locations must be different.</div>
              )}
            </div>
          </div>
        )}

        {/* Regular Customer Selection */}
        {customerType === 'REGULAR' && (
          <div className="form-group">
            <label>Search Customer</label>
            {/* Live-filtering combobox (Phase 5): type to filter by name/contact, or browse the full list. */}
            <div style={{position:'relative'}}>
              <input
                type="text"
                className="form-control"
                value={custQuery}
                placeholder="Type to search by name, contact person, or phone…"
                autoComplete="off"
                onChange={(e) => { setCustQuery(e.target.value); setCustOpen(true); if (selectedCustomer) setSelectedCustomer(null); }}
                onFocus={() => setCustOpen(true)}
                onBlur={() => setTimeout(() => setCustOpen(false), 150)}
              />
              {custOpen && (
                <div style={{
                  position:'absolute', zIndex: 20, left: 0, right: 0, top: '100%',
                  background:'var(--surface)', border:'1px solid var(--border)',
                  borderRadius:'var(--radius-sm)', boxShadow:'var(--shadow)', marginTop:'2px',
                  maxHeight:'240px', overflowY:'auto'
                }}>
                  {(() => {
                    const q = custQuery.trim().toLowerCase();
                    const list = (q
                      ? customers.filter(c =>
                          (c.company_name || '').toLowerCase().includes(q) ||
                          (c.contact_person || '').toLowerCase().includes(q) ||
                          (c.phone_primary || '').includes(q))
                      : customers
                    ).slice(0, 50);
                    return list.length === 0 ? (
                      <div style={{padding:'0.5rem 0.75rem', color:'var(--text-muted)', fontSize:'0.85rem'}}>No matching customers</div>
                    ) : list.map(c => (
                      <div key={c.customer_id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { setSelectedCustomer(c); setCustQuery(c.company_name); setCustOpen(false); }}
                        style={{padding:'0.5rem 0.75rem', cursor:'pointer', fontSize:'0.85rem', borderBottom:'1px solid #f1f5f9'}}>
                        <strong>{c.company_name}</strong>
                        {c.contact_person ? ` · ${c.contact_person}` : ''} {displayContact(c.phone_primary) ? ` · ${displayContact(c.phone_primary)}` : ''}
                      </div>
                    ));
                  })()}
                </div>
              )}
            </div>

            {selectedCustomer && (
              <div style={{marginTop: '1rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px'}}>
                <p><strong>Name:</strong> {selectedCustomer.company_name}</p>
                <p><strong>Contact:</strong> {displayContact(selectedCustomer.phone_primary)}</p>
                <p><strong>Current Bill Amount:</strong> ₹{selectedCustomer.current_bill_amount?.toFixed(2)}</p>
                <p><strong>Cylinders Held:</strong> {selectedCustomer.cylinders_held}</p>
                <p><strong>Holding Limit:</strong> {selectedCustomer.is_filling_vendor ? '∞ Unlimited (filling vendor)' : selectedCustomer.holding_limit}</p>
                {selectedCustomer.status === 'OVER LIMIT' && (
                  <p style={{color: 'red'}}><strong>Status: OVER LIMIT</strong></p>
                )}
              </div>
            )}
          </div>
        )}

        {/* One-Time Customer Form */}
        {customerType === 'ONE_TIME' && (
          <div>
            <div className="form-row">
              <div className="form-group">
                <label>Customer Name *</label>
                <input
                  type="text"
                  className="form-control"
                  value={oneTimeCustomer.company_name}
                  onChange={(e) => setOneTimeCustomer({...oneTimeCustomer, company_name: e.target.value})}
                  required
                />
              </div>
              <div className="form-group">
                <label>Contact Person</label>
                <input
                  type="text"
                  className="form-control"
                  value={oneTimeCustomer.contact_person}
                  onChange={(e) => setOneTimeCustomer({...oneTimeCustomer, contact_person: e.target.value})}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Contact Number *</label>
                <input
                  type="tel"
                  className="form-control"
                  value={oneTimeCustomer.phone_primary}
                  onChange={(e) => setOneTimeCustomer({...oneTimeCustomer, phone_primary: e.target.value})}
                  required
                />
              </div>
              <div className="form-group">
                <label>Address</label>
                <input
                  type="text"
                  className="form-control"
                  value={oneTimeCustomer.address}
                  onChange={(e) => setOneTimeCustomer({...oneTimeCustomer, address: e.target.value})}
                />
              </div>
            </div>
          </div>
        )}

        {/* Bill Details — Phase 27: two rows of three.
            Row 1: Bill Date | Transaction Type | Location
            Row 2: Bill Number | Vehicle Number | Challan No. (Challan sits under Location). */}
        <div className="form-row cols-3">
          <div className="form-group">
            <label>Bill Date &amp; Time</label>
            <div style={{display:'flex', gap:'0.4rem'}}>
              <input
                type="date"
                className="form-control"
                style={{flex:'1 1 58%'}}
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                required
              />
              <input
                type="time"
                className="form-control"
                style={{flex:'1 1 42%'}}
                value={billTime}
                onChange={(e) => setBillTime(e.target.value)}
                title="Defaults to the current time — edit it for a backdated entry"
                required
              />
            </div>
          </div>
          {!isInternal ? (
            <div className="form-group">
              <label>Transaction Type</label>
              <select
                className="form-control"
                value={transactionType}
                onChange={(e) => setTransactionType(e.target.value)}
              >
                <option value="GIVEN">{isVendor ? 'Sent for Filling' : 'Cylinders Filled'}</option>
                <option value="RECEIVED">{isVendor ? 'Received Back Filled' : 'Cylinders Empty'}</option>
                <option value="SWAP">{isVendor ? 'Swap (Send + Receive Filled)' : 'Swap (Filled + Empty)'}</option>
              </select>
            </div>
          ) : <div className="form-group" aria-hidden="true" />}
          {!isInternal ? (
            <div className="form-group">
              <label>Location *</label>
              <select
                className="form-control"
                value={location}
                onChange={(e) => { setLocation(e.target.value); setGivenItems([]); }}
              >
                {LOCATIONS.map(l => <option key={l} value={l}>{LOCATION_LABELS[l]}</option>)}
              </select>
            </div>
          ) : <div className="form-group" aria-hidden="true" />}
        </div>
        <div className="form-row cols-3">
          <div className="form-group">
            <label>Bill Number</label>
            {/* Prefilled with the next number in sequence, but fully editable like Challan No. —
                backspace/retype freely. Left blank, the backend assigns the next number. */}
            <input
              type="text"
              className="form-control"
              value={billNumber}
              onChange={(e) => { setBillNumber(e.target.value); setBillNumberEdited(true); }}
              placeholder="Auto (editable)"
            />
          </div>
          <div className="form-group">
            <label>Vehicle Number <span style={{fontSize:'0.72rem', color:'var(--text-muted)'}}>(optional)</span></label>
            <input
              type="text"
              className="form-control"
              value={vehicleNumber}
              onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
              placeholder="e.g. GJ08AB1234"
            />
          </div>
          <div className="form-group">
            <label>Challan No. *</label>
            {/* One ordinary editable input (Phase 14): pre-filled with the site's prefix as
                real text — type after it, or backspace to change/remove it entirely. */}
            <input
              type="text"
              className={`form-control ${challanError ? 'input-error' : ''}`}
              value={challanNo}
              onChange={(e) => { setChallanNo(e.target.value); if (challanError) setChallanError(''); }}
              placeholder="Paper challan number (required)"
            />
            {challanError && <div className="field-error">{challanError}</div>}
          </div>
        </div>

        {/* For SWAP, show Received (return) ABOVE Given — we first take the empty cylinder back,
            then hand over a filled one. For single-direction transactions, show only that section.
            Internal transfers show only the transfer section (givenItems machinery, no rates). */}
        {isInternal && renderGivenSection()}
        {/* Vendors (Phase 14): "Sent for Filling" first, "Received Back Filled" second.
            Regular customers keep Empty-first (take the empty back, then hand over a filled one). */}
        {!isInternal && transactionType === 'SWAP' && (
          isVendor ? (
            <>
              {renderGivenSection()}
              {renderReceivedSection()}
            </>
          ) : (
            <>
              {renderReceivedSection()}
              {renderGivenSection()}
            </>
          )
        )}
        {!isInternal && transactionType === 'GIVEN' && renderGivenSection()}
        {!isInternal && transactionType === 'RECEIVED' && renderReceivedSection()}

        {/* Bill Summary */}
        <div style={{marginTop: '2rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px'}}>
          <h3>{isInternal ? 'Transfer Summary' : 'Bill Summary'}</h3>
          {isInternal ? (
            <>
              <p><strong>Cylinders to Transfer:</strong> {totalGiven + pcTransferTotal}
                {pcTransferTotal > 0 && <span style={{color:'var(--text-muted)'}}> ({totalGiven} inventory + {pcTransferTotal} personal)</span>}
              </p>
              <p><strong>Route:</strong> {locationText(fromLocation)} → {locationText(toLocation)}</p>
            </>
          ) : (
            <>
              <p><strong>{isVendor ? 'Total Cylinders Sent for Filling' : 'Total Cylinders Filled'}:</strong> {totalGiven + pcGivenTotal}
                {pcGivenTotal > 0 && <span style={{color:'var(--text-muted)'}}> ({totalGiven} inventory + {pcGivenTotal} personal)</span>}
              </p>
              <p><strong>{isVendor ? 'Total Cylinders Received Back' : 'Total Cylinders Empty'}:</strong> {totalReceived + pcReceivedTotal}
                {pcReceivedTotal > 0 && <span style={{color:'var(--text-muted)'}}> ({totalReceived} inventory + {pcReceivedTotal} personal)</span>}
              </p>
              <p><strong>Net Cylinder Change:</strong> {totalGiven - totalReceived}</p>
              <p><strong>Bill Amount:</strong> ₹{totalAmount.toFixed(2)}</p>
            </>
          )}
          
          {selectedCustomer && (
            <>
              <p><strong>Previous Outstanding:</strong> ₹{selectedCustomer.current_bill_amount?.toFixed(2)}</p>
              <p><strong>New Total Outstanding:</strong> ₹{(selectedCustomer.current_bill_amount + totalAmount).toFixed(2)}</p>
              <p><strong>Previous Cylinders Held:</strong> {selectedCustomer.cylinders_held}</p>
              <p><strong>New Cylinders Held:</strong> {newCylinderHold}</p>
              <p><strong>Holding Limit:</strong> {selectedCustomer.is_filling_vendor ? '∞ Unlimited (filling vendor)' : selectedCustomer.holding_limit}</p>
              {isOverLimit && !overLimitAuth && (
                <div>
                  <p style={{color: 'red', fontWeight: 'bold'}}>
                    ⛔ BLOCKED: this transaction would put the customer over their holding limit
                    ({newCylinderHold} vs limit {selectedCustomer.holding_limit}). Saving is disabled.
                  </p>
                  <p style={{fontSize:'0.85rem', margin:'0.4rem 0'}}>
                    A trusted person can authorize saving anyway — or use <strong>Save for Later</strong> below to keep the work as a draft.
                  </p>
                  <button type="button" className="btn btn-primary" style={{padding:'0.3rem 0.8rem'}}
                    onClick={() => setStepUpAsk({
                      title: 'Authorize over-limit bill',
                      context: `save transaction for ${selectedCustomer.company_name}, exceeding holding limit by ${newCylinderHold - selectedCustomer.holding_limit} cylinder(s) (would hold ${newCylinderHold} vs limit ${selectedCustomer.holding_limit})`,
                      action: (auth) => { setOverLimitAuth(auth); showToast(`Over-limit save authorized by ${auth.approved_by}.`, 'success'); }
                    })}>
                    🛡️ Request Authorization
                  </button>
                </div>
              )}
              {isOverLimit && overLimitAuth && (
                <p style={{color:'#16A34A', fontWeight:'bold'}}>
                  🛡️ Over-limit save authorized by {overLimitAuth.approved_by} ({overLimitAuth.via}) — Save Bill is enabled.
                </p>
              )}
            </>
          )}
        </div>

        {/* Remarks */}
        <div className="form-group">
          <label>Remarks / Notes</label>
          <textarea
            className="form-control"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows="3"
          />
        </div>

        {/* Actions */}
        {editingBillId && (
          <div className="alert alert-warning" style={{marginBottom:'0.75rem'}}>
            ✏️ Editing bill <strong>{editingBillNo}</strong> (same-session correction — no edit-history entry will be recorded).
          </div>
        )}
        <div className="btn-group">
          <button type="submit" className="btn btn-primary"
            disabled={personalOverCap || (!isInternal && !editingBillId && isOverLimit && !overLimitAuth)}
            title={personalOverCap ? (isVendor
                ? 'Personal cylinders received back exceed what is outstanding with this filling vendor'
                : 'Personal cylinders returned exceed what the customer has at the plant')
              : (!isInternal && !editingBillId && isOverLimit && !overLimitAuth) ? 'Blocked: customer would exceed their holding limit — request authorization or save for later' : undefined}>
            {editingBillId ? 'Update Bill' : isInternal ? 'Save Transfer' : 'Save Bill'}
          </button>
          {!editingBillId && (
            <button type="button" className="btn btn-secondary" onClick={saveForLater}
              title="Save this form as a draft for this location (keeps its bill number)">
              💾 Save for Later
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            Cancel
          </button>
        </div>
      </form>

      {showDrafts && (
        <Modal title={`Saved Drafts — ${locationText(draftScope())}`} size="lg" onClose={() => setShowDrafts(false)}>
          {drafts.length === 0 ? (
            <p style={{color:'var(--text-muted)'}}>No saved drafts for this location.</p>
          ) : (
            <div className="table-container">
              <table>
                <thead><tr><th>Bill No.</th><th>Customer</th><th>Saved</th><th></th></tr></thead>
                <tbody>
                  {drafts.map(d => {
                    // Internal-transfer drafts have no customer by design (Phase 15): show a
                    // typed badge (TRANSFER green) instead of "(no customer yet)". Customer
                    // drafts get their transaction-type badge from the shared 4-color set.
                    const isInternalDraft = d.payload && d.payload.customerType === 'INTERNAL';
                    const draftType = (d.payload && d.payload.transactionType) || 'GIVEN';
                    return (
                    <tr key={d.draft_id} style={{cursor:'pointer'}} onClick={() => resumeDraft(d)}>
                      <td><strong>{d.bill_number}</strong></td>
                      <td>
                        {isInternalDraft ? (
                          <span style={{display:'inline-flex', alignItems:'center', gap:'0.3rem', padding:'0.1rem 0.55rem',
                            borderRadius:'999px', fontSize:'0.72rem', fontWeight:700, background:'#dcfce7', color:'#16A34A', whiteSpace:'nowrap'}}>
                            ⇄ INTERNAL TRANSFER
                          </span>
                        ) : (
                          <span style={{display:'inline-flex', alignItems:'center', gap:'0.45rem'}}>
                            {directionLabel(draftType)} {d.customer_name}
                          </span>
                        )}
                      </td>
                      <td>{formatDate(d.saved_at)}</td>
                      <td onClick={(e) => e.stopPropagation()} style={{whiteSpace:'nowrap'}}>
                        <button className="btn btn-primary" style={{padding:'0.25rem 0.6rem', marginRight:'0.4rem'}}
                          onClick={() => resumeDraft(d)}>Resume</button>
                        <button className="btn btn-danger" style={{padding:'0.25rem 0.6rem'}}
                          onClick={() => deleteDraft(d)}>🗑️</button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// Cylinder Item Component
export function CylinderItem({ item, index, gasTypes, cylinderSizes, availableCylinders = [], searchPool = [], knownRotational = new Set(), mismatchFor = null, hidePersonal = false, personalLabel = '', personalLink = '', personalMax = null, personalCapDetail = '', notFoundMessage = '', onUpdate, onAddSerial, onSelectCylinder, onPickCylinder, onRemoveSerial, onRemove, showRate }) {
  // Personal-cylinder input starts collapsed; auto-expands when the line already has a count
  // (e.g. same-session "Edit Bill" repopulating the form).
  const [showPersonal, setShowPersonal] = React.useState(() => (Number(item.personalCyl) || 0) > 0);
  // Auto-expand when a PC quantity arrives from outside (e.g. the vendor auto-echo, Phase 16)
  // so the echoed value is visible immediately, not hidden behind the collapsed link.
  React.useEffect(() => {
    if ((Number(item.personalCyl) || 0) > 0) setShowPersonal(true);
  }, [item.personalCyl]);
  const [personalCapped, setPersonalCapped] = React.useState(false); // user just tried to exceed the max
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [pendingCyl, setPendingCyl] = React.useState(null); // selected-but-not-yet-added cylinder
  const [lineError, setLineError] = React.useState('');     // inline gas/size-mismatch message

  // Dependent capacity list: only the capacities valid for the chosen gas type (Change 3).
  const selectedGasName = gasTypes.find(g => String(g.gas_type_id || g._id) === String(item.gas_type_id))?.gas_type_name;
  const selectedSizeLabel = cylinderSizes.find(s => String(s.size_id || s._id) === String(item.cylinder_size_id))?.size_label;
  const validCaps = selectedGasName ? (GAS_CAPACITIES[selectedGasName] || []) : null;
  const filteredSizes = validCaps
    ? cylinderSizes.filter(s => validCaps.includes(s.size_label))
    : cylinderSizes;

  // Once the first cylinder is added, this line's gas type + size are LOCKED (Change 3).
  const locked = item.serial_numbers.length > 0;

  // The searchable dropdown pool: when gas type + size are both chosen it is restricted to that
  // gas/size (availableCylinders); otherwise the broader eligible pool (searchPool) so the user can
  // search across everything and have gas/size auto-filled on selection.
  const bothChosen = item.gas_type_id && item.cylinder_size_id;
  const pool = bothChosen ? availableCylinders : searchPool;
  const qq = query.trim().toLowerCase();
  const matches = (qq
    ? pool.filter(c => c.rotational_number.toLowerCase().includes(qq))  // match on rotational number only
    : pool
  ).slice(0, 50);

  // Does this cylinder match the line's locked gas/size? (true when the line isn't locked yet)
  const matchesLine = (cyl) =>
    !locked || (cyl.gas_type === selectedGasName && cyl.capacity === selectedSizeLabel);
  const mismatchMessage = (cyl) =>
    `This cylinder is ${cyl.gas_type} / ${cyl.capacity} — it doesn't match the current line. Add a new cylinder type block instead.`;

  // Step 1 — select from dropdown: auto-fill gas/size and keep the number in the box (do NOT add yet).
  const pickFromDropdown = (cyl) => {
    if (!matchesLine(cyl)) { setLineError(mismatchMessage(cyl)); return; }
    setLineError('');
    onPickCylinder && onPickCylinder(cyl);
    setPendingCyl(cyl);
    setQuery(cyl.rotational_number);
    setOpen(false);
  };

  // Typing discards any pending selection and re-opens the dropdown to search again.
  const onType = (val) => {
    setQuery(val);
    setPendingCyl(null);
    setLineError('');
    setOpen(true);
  };

  // Step 2 — Add button / Enter: commit the pending selection (or a typed exact match) as a chip,
  // then reset the search box (keeping gas type + size as-is for the next add).
  const commitAdd = () => {
    if (pendingCyl) {
      if (!matchesLine(pendingCyl)) { setLineError(mismatchMessage(pendingCyl)); return; }
      onAddSerial(pendingCyl.rotational_number);
    } else {
      const text = query.trim();
      if (!text) return;
      // Match against the FULL search pool so a mismatched known cylinder is caught even when the
      // visible dropdown is filtered to the locked gas/size.
      const cyl = searchPool.find(c => c.rotational_number.toLowerCase() === text.toLowerCase())
        || pool.find(c => c.rotational_number.toLowerCase() === text.toLowerCase());
      if (cyl && !matchesLine(cyl)) { setLineError(mismatchMessage(cyl)); return; }
      if (cyl) { onSelectCylinder(cyl); } // typed an exact eligible number without selecting: auto-fill + add
      else {
        // Phase 28: restore existence/eligibility gate. A typed number that isn't in the
        // eligible pool is NEVER added blindly — it's either fabricated (unknown to inventory)
        // or a real cylinder in the wrong state/location. Give a specific message for each.
        if (!item.gas_type_id || !item.cylinder_size_id) { setLineError('Select gas type and size first, then search the cylinder number.'); return; }
        const knownCyl = [...knownRotational].some(r => String(r).toLowerCase() === text.toLowerCase());
        if (knownCyl) {
          setLineError(notFoundMessage || `Cylinder "${text}" isn't available for this line — check its gas type/size, and that it is in stock at this location (Filled) or currently with the customer (Empty).`);
        } else {
          setLineError(notFoundMessage || `Cylinder "${text}" was not found in inventory. Only registered cylinders can be added.`);
        }
        return;
      }
    }
    setQuery('');
    setPendingCyl(null);
    setLineError('');
    setOpen(false);
  };

  return (
    <div className="cart-item">
      <div className="form-row">
        <div className="form-group">
          <label>Gas Type {locked && <span style={{fontSize:'0.72rem', color:'var(--text-muted)'}}>🔒 locked</span>}</label>
          <select
            className="form-control"
            value={item.gas_type_id}
            onChange={(e) => onUpdate('gas_type_id', e.target.value)}
            disabled={locked}
          >
            <option value="">-- Select --</option>
            {sortGasTypes(gasTypes, g => g.gas_type_name).map(type => (
              <option key={type.gas_type_id || type._id} value={type.gas_type_id || type._id}>
                {type.gas_type_name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Cylinder Size {locked && <span style={{fontSize:'0.72rem', color:'var(--text-muted)'}}>🔒 locked</span>}</label>
          <select
            className="form-control"
            value={item.cylinder_size_id}
            onChange={(e) => onUpdate('cylinder_size_id', e.target.value)}
            disabled={locked || !item.gas_type_id}
          >
            <option value="">{item.gas_type_id ? '-- Select --' : '-- Select gas type first --'}</option>
            {sortCapacities(filteredSizes, s => s.size_label).map(size => (
              <option key={size.size_id || size._id} value={size.size_id || size._id}>
                {size.size_label}
              </option>
            ))}
          </select>
        </div>

        {showRate && (
          <div className="form-group">
            <label>Rate per Cylinder</label>
            <input
              type="number"
              className="form-control"
              value={item.rate}
              onChange={(e) => { const v = parseFloat(e.target.value); onUpdate('rate', isNaN(v) ? '' : v); }}
              min="0"
              step="0.01"
              required
            />
          </div>
        )}
      </div>

      <div className="form-group">
        <label>Cylinders (Rotational No.) — Quantity: {item.quantity}</label>

        <div style={{position: 'relative'}}>
          <div style={{display: 'flex', gap: '0.5rem'}}>
            <input
              type="text"
              className="form-control"
              value={query}
              onChange={(e) => onType(e.target.value)}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitAdd(); } }}
              placeholder="Search or select a cylinder no…"
              autoComplete="off"
            />
            <button type="button" className="btn btn-primary" onClick={commitAdd}>
              Add
            </button>
          </div>
          {lineError && <div className="field-error" style={{marginTop:'0.4rem'}}>{lineError}</div>}
          {open && (
            <div style={{
              position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%',
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow)', marginTop: '2px',
              maxHeight: '220px', overflowY: 'auto'
            }}>
              {matches.length === 0 ? (
                <div style={{padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem'}}>
                  No matching available cylinders
                </div>
              ) : matches.map(c => (
                <div
                  key={c._id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickFromDropdown(c)}
                  style={{padding: '0.5rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem', borderBottom: '1px solid #f1f5f9'}}
                >
                  <strong>{c.rotational_number}{c.physical_number ? ` (${c.physical_number})` : ''}</strong>
                  {' '}· {c.gas_type} · {c.capacity}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="serial-tags">
          {item.serial_numbers.map((serial, i) => {
            const mismatch = mismatchFor ? mismatchFor(serial) : null;
            const amber = { background: 'var(--warning-light)', color: '#b45309', borderColor: '#fde68a' };
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div className="serial-tag" style={mismatch ? amber : {}}>
                  {mismatch && '⚠ '}{serial}
                  <button type="button" onClick={() => onRemoveSerial(i)}>×</button>
                </div>
                {mismatch && (
                  <span style={{ fontSize: '0.7rem', color: '#b45309', maxWidth: '240px', lineHeight: 1.3 }}>
                    ⚠️ {serial} is currently held by {mismatch} — this will be recorded as returned on their behalf.
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Personal cylinders (quantity-only): hidden behind a link by default; expands inline.
          Not applicable to internal transfers (hidePersonal). */}
      {hidePersonal ? null : !showPersonal ? (
        <button
          type="button"
          className="link-btn"
          style={{marginBottom:'0.75rem', fontSize:'0.78rem'}}
          onClick={() => setShowPersonal(true)}
        >
          {personalLink || "+ Customer's own cylinders? Tap to record"}
        </button>
      ) : (
        <div className="form-group" style={{background:'#f8fafc', border:'1px solid var(--border)', borderRadius:'6px', padding:'0.6rem 0.75rem'}}>
          <div style={{display:'flex', gap:'1.25rem', flexWrap:'wrap', alignItems:'flex-start'}}>
            <div>
              <label style={{display:'block', marginBottom:'0.3rem'}}>🔄 {personalLabel || "Customer's personal cylinders:"}</label>
              <input
                type="number"
                className="form-control"
                style={{maxWidth:'120px'}}
                min="0"
                step="1"
                placeholder="0"
                value={item.personalCyl === '' || item.personalCyl == null ? '' : item.personalCyl}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') { setPersonalCapped(false); onUpdate('personalCyl', ''); return; }
                  let n = Math.max(0, parseInt(v, 10) || 0);
                  // Filled section only: cap at what we actually hold for this customer.
                  if (personalMax != null && n > personalMax) { n = personalMax; setPersonalCapped(true); }
                  else setPersonalCapped(false);
                  onUpdate('personalCyl', n);
                }}
              />
              {personalMax != null && (personalCapped || (Number(item.personalCyl) || 0) > personalMax) && (
                <div style={{color:'var(--danger)', fontSize:'0.72rem', marginTop:'0.3rem', maxWidth:'260px', lineHeight:1.35}}>
                  Cannot record more than {personalMax} personal cylinder{personalMax === 1 ? '' : 's'} — {personalCapDetail}
                </div>
              )}
              <button
                type="button"
                className="link-btn"
                style={{display:'block', marginTop:'0.35rem', fontSize:'0.75rem', color:'var(--danger)'}}
                onClick={() => { onUpdate('personalCyl', ''); setShowPersonal(false); }}
              >
                × Remove
              </button>
            </div>
            <div style={{flex:'1 1 220px', minWidth:0, fontSize:'0.8rem', paddingTop:'0.15rem'}}>
              {selectedGasName && selectedSizeLabel ? (
                <>
                  <div><strong>Gas Type:</strong> {selectedGasName}</div>
                  <div><strong>Size:</strong> {selectedSizeLabel}</div>
                  <div style={{color:'var(--text-muted)', fontSize:'0.72rem', marginTop:'0.3rem'}}>
                    These cylinders belong to the customer and are not tracked in our inventory.
                  </div>
                </>
              ) : (
                <div style={{color:'var(--text-muted)'}}>Select gas type and size above first.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {showRate && (
        <div className="form-group">
          <strong>Amount: ₹{lineAmount(item).toFixed(2)}</strong>
        </div>
      )}

      <div style={{display: 'flex', justifyContent: 'flex-end'}}>
        <button type="button" className="btn btn-danger" onClick={onRemove}>
          Remove Item
        </button>
      </div>
    </div>
  );
}

// ─── Rental Summary Calculator (Phase 4) ───
// Two-step modal: (1) pick free days / rate / cylinders from the customer's current holdings,
// (2) preview per-cylinder days_charged + amounts, then Generate & Save (persists a RentalCharge
// and advances each cylinder's rental_charged_through so days are never billed twice) and Print.
export function RentalSummaryModal({ customer, customerId, onClose, onGenerated }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);           // current holdings with days_unbilled
  const [business, setBusiness] = useState(null); // shared BusinessProfile for the printout
  const [freeDays, setFreeDays] = useState(10);
  const [rate, setRate] = useState(0);
  const [selected, setSelected] = useState({});   // serial_number -> checked
  const [saving, setSaving] = useState(false);
  const [savedCharge, setSavedCharge] = useState(null); // server-persisted record (after Generate)

  useEffect(() => {
    (async () => {
      try {
        const [aRes, bRes] = await Promise.all([
          apiFetch(`${API_URL}/customers/${customerId}/aging`),
          apiFetch(`${API_URL}/profile/business`)
        ]);
        setRows(aRes.ok ? await aRes.json() : []);
        setBusiness(bRes.ok ? await bRes.json() : null);
      } catch (e) { console.error('Error loading rental data:', e); }
      setLoading(false);
    })();
  }, [customerId]);

  const chosen = rows.filter(r => selected[r.serial_number]);
  const fd = Math.max(0, Number(freeDays) || 0);
  const rt = Math.max(0, Number(rate) || 0);
  // Same formula the backend applies on save: charge only the not-yet-billed days beyond free days.
  const preview = chosen.map(r => {
    const daysCharged = Math.max(0, (r.days_unbilled || 0) - fd);
    return { ...r, days_charged: daysCharged, amount: daysCharged * rt };
  });
  const previewTotal = preview.reduce((s, l) => s + l.amount, 0);

  const generate = async () => {
    setSaving(true);
    try {
      const res = await apiFetch(`${API_URL}/customers/${customerId}/rental-summary`, {
        method: 'POST',
        body: JSON.stringify({ free_days: fd, rate_per_day: rt, serial_numbers: chosen.map(r => r.serial_number) })
      });
      if (res.ok) {
        setSavedCharge(await res.json());
        showToast('Rental charge generated.', 'success');
        onGenerated && onGenerated();
      } else {
        showToast(await apiErrorMessage(res, 'Could not generate rental charge'));
      }
    } catch { showToast('Could not generate rental charge'); }
    setSaving(false);
  };

  // Printable summary: shared BusinessProfile header + customer details + charged lines.
  const printSummary = () => {
    const c = savedCharge;
    if (!c) return;
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const bizName = (business && business.business_name) || 'GURU Industries';
    const lines = (c.line_items || []).map((l, i) => `
      <tr><td class="c">${i + 1}</td><td>${esc(l.serial_number)}</td><td>${esc(l.gas_type)}</td><td>${esc(l.capacity)}</td>
      <td class="c">${formatDate(l.charged_from)} – ${formatDate(l.charged_through)}</td>
      <td class="c">${l.days_held}</td><td class="c">${l.days_charged}</td>
      <td class="r">${(l.amount || 0).toFixed(2)}</td></tr>`).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(c.customer.company_name)} — Rental Summary</title>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family: Arial, sans-serif; color:#000; font-size:12px; padding:14px; }
      .hdr { border:1.5px solid #000; padding:8px 10px; margin-bottom:10px; }
      .hdr .co { font-size:16px; font-weight:bold; }
      .title { text-align:center; font-size:14px; font-weight:bold; margin:8px 0; }
      .meta { display:flex; justify-content:space-between; margin-bottom:8px; }
      table { width:100%; border-collapse:collapse; margin-bottom:8px; }
      th, td { border:1px solid #000; padding:5px 7px; font-size:12px; }
      th { font-weight:700; text-align:left; }
      td.c, th.c { text-align:center; } td.r, th.r { text-align:right; }
      .tot { font-weight:700; }
      .terms { font-size:11px; color:#333; margin-top:6px; }
    </style></head><body>
    <div class="hdr">
      <div class="co">${esc(bizName)}</div>
      ${business && business.business_address ? `<div>${esc(business.business_address)}</div>` : ''}
      ${business && business.business_phone ? `<div>Phone: ${esc(business.business_phone)}</div>` : ''}
      ${business && business.gst_number ? `<div>GSTIN: ${esc(business.gst_number)}</div>` : ''}
    </div>
    <div class="title">Cylinder Rental Summary</div>
    <div class="meta">
      <div>
        <div><strong>M/s.: ${esc(c.customer.company_name)}</strong></div>
        ${c.customer.address ? `<div>${esc(c.customer.address)}</div>` : ''}
        ${displayContact(c.customer.phone_primary) ? `<div>Phone: ${esc(displayContact(c.customer.phone_primary))}</div>` : ''}
        ${c.customer.gst_number ? `<div>GSTIN: ${esc(c.customer.gst_number)}</div>` : ''}
      </div>
      <div style="text-align:right">
        <div>Date: <strong>${formatDate(c.generated_date)}</strong></div>
        <div>Free days: <strong>${c.free_days}</strong></div>
        <div>Rate/day: <strong>₹${(c.rate_per_day || 0).toFixed(2)}</strong></div>
      </div>
    </div>
    <table>
      <thead><tr><th class="c" style="width:6%">Sr.</th><th>Cylinder No.</th><th>Gas</th><th>Size</th>
      <th class="c">Period</th><th class="c">Days Held</th><th class="c">Days Charged</th><th class="r">Amount</th></tr></thead>
      <tbody>${lines}</tbody>
      <tfoot><tr><td colspan="7" class="r tot">TOTAL...</td><td class="r tot">${(c.total_amount || 0).toFixed(2)}</td></tr></tfoot>
    </table>
    <div class="terms">Days charged = days held (since last charge) minus ${c.free_days} free day(s), at ₹${(c.rate_per_day || 0).toFixed(2)} per day per cylinder.</div>
    <script>window.onload=function(){setTimeout(function(){window.print();},120);window.onafterprint=function(){window.close();};}<\/script>
    </body></html>`;
    const w = window.open('', 'rental_summary_print', 'width=900,height=760,scrollbars=yes');
    if (w) { w.document.write(html); w.document.close(); }
    else { showToast('Please allow pop-ups to use Print / PDF.', 'info'); }
  };

  return (
    <Modal title={`Rental Summary — ${customer?.company_name || ''}`} size="wide" onClose={onClose}>
      {loading ? <Spinner label="Loading holdings…" /> : step === 1 ? (
        <>
          <div className="form-row">
            <div className="form-group">
              <label>Free Days</label>
              <input type="number" className="form-control" min="0" step="1" value={freeDays}
                onChange={(e) => setFreeDays(e.target.value)} />
              <small style={{color:'var(--text-muted)', fontSize:'0.75rem'}}>Days not charged, per cylinder.</small>
            </div>
            <div className="form-group">
              <label>Rate per Day (₹)</label>
              <input type="number" className="form-control" min="0" step="0.01" value={rate}
                onChange={(e) => setRate(e.target.value)} />
            </div>
          </div>

          {rows.length === 0 ? (
            <p style={{color:'var(--text-muted)'}}>This customer holds no cylinders right now.</p>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th style={{width:'5%'}}></th>
                    <th>Cylinder No.</th><th>Gas Type</th><th>Size</th><th>Issued From</th>
                    <th>Date Given</th><th>Days Held</th><th>Unbilled Days</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.serial_number} style={{cursor:'pointer'}}
                      onClick={() => setSelected(prev => ({ ...prev, [r.serial_number]: !prev[r.serial_number] }))}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={!!selected[r.serial_number]}
                          onChange={(e) => setSelected(prev => ({ ...prev, [r.serial_number]: e.target.checked }))} />
                      </td>
                      <td><strong>{r.serial_number}</strong></td>
                      <td>{r.gas_type}</td>
                      <td>{r.capacity}</td>
                      <td>{locationText(r.location)}</td>
                      <td>{formatDate(r.date_given)}</td>
                      <td>{r.days_held}</td>
                      <td>
                        {r.days_unbilled}
                        {r.rental_charged_through && (
                          <span style={{color:'var(--text-muted)', fontSize:'0.72rem'}}> (charged through {formatDate(r.rental_charged_through)})</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={chosen.length === 0}
              onClick={() => setStep(2)}>Continue ({chosen.length} selected) →</button>
          </div>
        </>
      ) : (
        <>
          {!savedCharge && (
            <p style={{color:'var(--text-muted)', fontSize:'0.82rem', marginBottom:'0.75rem'}}>
              Preview — nothing is saved until you press "Generate &amp; Save".
              Days charged = unbilled days − {fd} free day(s), at ₹{rt.toFixed(2)}/day.
            </p>
          )}
          <div className="table-container">
            <table>
              <thead>
                <tr><th>Cylinder No.</th><th>Gas Type</th><th>Size</th><th>Unbilled Days</th><th>Days Charged</th><th>Amount</th></tr>
              </thead>
              <tbody>
                {(savedCharge ? savedCharge.line_items : preview).map(l => (
                  <tr key={l.serial_number}>
                    <td><strong>{l.serial_number}</strong></td>
                    <td>{l.gas_type}</td>
                    <td>{l.capacity}</td>
                    <td>{savedCharge ? l.days_held : l.days_unbilled}</td>
                    <td>{l.days_charged}</td>
                    <td>₹{(l.amount || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} style={{textAlign:'right', fontWeight:700}}>TOTAL</td>
                  <td style={{fontWeight:700}}>₹{(savedCharge ? savedCharge.total_amount : previewTotal).toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {savedCharge ? (
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
              <button type="button" className="btn btn-primary" onClick={printSummary}>🖨 Print / PDF</button>
            </div>
          ) : (
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setStep(1)}>← Back</button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={generate}>
                {saving ? 'Saving…' : '💾 Generate & Save'}
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
