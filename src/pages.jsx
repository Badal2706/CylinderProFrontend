import React, { useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  API_URL, apiFetch, apiErrorMessage, showToast, formatDate, formatDateTime,
  getExportFileName, exportToExcel, useViewAll, Spinner, EmptyState, Modal,
  ConfirmModal, useModalA11y, ListModal, ViewAllButton, GAS_CAPACITIES,
  GAS_TYPE_LIST, sortGasTypes, sortCapacities, directionText, CustomerForm,
  LOCATIONS, LOCATION_LABELS, locationText, stockStateText, cylinderStateText,
  Pagination, useDebounce, InfiniteScroll
} from './App.jsx';
import { printSavedBill, RentalSummaryModal, StepUpVerificationModal } from './components.jsx';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Human label for a payment mode. 'ONLINE' is legacy data → shown as "UPI Transfer".
export function paymentModeLabel(mode) {
  if (mode === 'UPI' || mode === 'ONLINE') return 'UPI Transfer';
  if (mode === 'CHEQUE') return 'Cheque';
  if (mode === 'CASH') return 'Cash';
  return mode || '';
}

// Contextual reference for a payment row: cheque number for cheque, UPI txn id for UPI.
export function paymentRef(p) {
  if (p.payment_mode === 'CHEQUE') return p.cheque_number || '-';
  if (p.payment_mode === 'UPI' || p.payment_mode === 'ONLINE') return p.upi_transaction_id || '-';
  return '-';
}

// Business name for print/PDF headers — from the saved Business Profile, default "GURU Industries".
export async function getBusinessName() {
  try {
    const r = await apiFetch(`${API_URL}/profile/business`);
    if (r.ok) { const b = await r.json(); return b.business_name || 'GURU Industries'; }
  } catch {}
  return 'GURU Industries';
}

// Small amber badge for cross-customer returns. Clickable → opens the counterparty customer.
export function ReturnBadge({ text, customerId, onSelectCustomer }) {
  return (
    <span
      onClick={() => customerId && onSelectCustomer && onSelectCustomer(String(customerId))}
      title="View related customer"
      style={{
        display: 'inline-block', marginLeft: '0.5rem', padding: '0.1rem 0.5rem',
        fontSize: '0.72rem', fontWeight: 600, borderRadius: '999px',
        background: '#fff7ed', color: '#b45309', border: '1px solid #fdba74',
        cursor: customerId ? 'pointer' : 'default', whiteSpace: 'nowrap'
      }}
    >
      🔁 {text}
    </span>
  );
}

// Amber row style for cross-customer return rows.
export const RETURN_ROW_STYLE = { background: '#fff7ed' };

// Customer Detail Component
export function CustomerDetail({ customerId, onBack, onSelectCustomer, scrollTo = null }) {
  const [customer, setCustomer] = useState(null);
  const [givenTransactions, setGivenTransactions] = useState([]);
  const [givenPagination, setGivenPagination] = useState(null);
  const [givenPage, setGivenPage] = useState(1);
  const [receivedTransactions, setReceivedTransactions] = useState([]);
  const [receivedPagination, setReceivedPagination] = useState(null);
  const [receivedPage, setReceivedPage] = useState(1);
  const [payments, setPayments] = useState([]);
  const [paymentsPagination, setPaymentsPagination] = useState(null);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [personalHistory, setPersonalHistory] = useState([]);
  const [detailBillId, setDetailBillId] = useState(null);
  const [editBillId, setEditBillId] = useState(null);
  const [editAuth, setEditAuth] = useState(null);
  const [openHist, setOpenHist] = useState(null);
  const [customerBills, setCustomerBills] = useState([]);
  const [agingRows, setAgingRows] = useState([]);
  const [showRental, setShowRental] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  useEffect(() => {
    if (customerId) {
      fetchCustomerDetail();
    }
  }, [customerId]);

  // Scroll to the requested section (e.g. 'currently-holding' when arriving from an
  // AT_CUSTOMER row in Cylinder Inventory) once the page has rendered.
  useEffect(() => {
    if (loading || !scrollTo) return;
    const t = setTimeout(() => {
      const el = document.getElementById(scrollTo);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
    return () => clearTimeout(t);
  }, [loading, scrollTo]);

  const fetchCustomerDetail = async () => {
    try {
      const [customerRes, givenRes, receivedRes, paymentsRes, personalHistRes, agingRes, billsRes] = await Promise.all([
        apiFetch(`${API_URL}/customers/${customerId}`),
        apiFetch(`${API_URL}/customers/${customerId}/transactions/given?page=${givenPage}&limit=50`),
        apiFetch(`${API_URL}/customers/${customerId}/transactions/received?page=${receivedPage}&limit=50`),
        apiFetch(`${API_URL}/customers/${customerId}/payments?page=${paymentsPage}&limit=50`),
        apiFetch(`${API_URL}/customers/${customerId}/personal-cylinder-history`),
        apiFetch(`${API_URL}/customers/${customerId}/aging`),
        apiFetch(`${API_URL}/bills?customer_id=${customerId}&limit=200`)
      ]);

      if (!customerRes.ok) {
        showToast(await apiErrorMessage(customerRes, 'Could not load this customer.'));
        setLoading(false);
        return;
      }

      const customerData = await customerRes.json();
      const givenRaw = givenRes.ok ? await givenRes.json() : [];
      const givenData = givenRaw.data || givenRaw;
      if (givenRaw.pagination) setGivenPagination(givenRaw.pagination);
      const receivedRaw = receivedRes.ok ? await receivedRes.json() : [];
      const receivedData = receivedRaw.data || receivedRaw;
      if (receivedRaw.pagination) setReceivedPagination(receivedRaw.pagination);
      const paymentsRaw = paymentsRes.ok ? await paymentsRes.json() : [];
      const paymentsData = paymentsRaw.data || paymentsRaw;
      if (paymentsRaw.pagination) setPaymentsPagination(paymentsRaw.pagination);
      const personalHistData = personalHistRes.ok ? await personalHistRes.json() : [];
      const agingData = agingRes.ok ? await agingRes.json() : [];
      const billsRaw = billsRes.ok ? await billsRes.json() : [];
      const billsData = billsRaw.data || billsRaw;
      if (!givenRes.ok || !receivedRes.ok || !paymentsRes.ok) {
        showToast('Some transaction history could not be loaded.');
      }

      setCustomer(customerData);
      setGivenTransactions(Array.isArray(givenData) ? givenData : []);
      setReceivedTransactions(Array.isArray(receivedData) ? receivedData : []);
      setPayments(Array.isArray(paymentsData) ? paymentsData : []);
      setPersonalHistory(Array.isArray(personalHistData) ? personalHistData : []);
      setAgingRows(Array.isArray(agingData) ? agingData : []);
      setCustomerBills(Array.isArray(billsData) ? billsData : []);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching customer detail:', error);
      showToast('Could not load customer details. Please try again.');
      setLoading(false);
    }
  };

  const exportCustomerExcel = () => {
    const d2 = (d) => formatDate(d);
    const rs = (n) => parseFloat((n || 0).toFixed(2));

    const contactsStr = (Array.isArray(customer.additional_contacts) ? customer.additional_contacts : [])
      .map(c => c.name ? `${c.name}: ${c.number}` : c.number).join('; ');

    const infoRows = [
      { Field: 'Company Name',        Value: customer.company_name || '' },
      { Field: 'Contact Person',       Value: customer.contact_person || '' },
      { Field: 'Primary Contact',      Value: customer.phone_primary || '' },
      { Field: 'Telephone Number',     Value: customer.phone_alternate || '' },
      { Field: 'Additional Contacts',  Value: contactsStr },
      { Field: 'Address',              Value: customer.address || '' },
      { Field: 'GST Number',           Value: customer.gst_number || '' },
      { Field: 'Cylinders Held',       Value: customer.cylinders_held || 0 },
      { Field: 'Holding Limit',        Value: customer.is_filling_vendor ? 'Unlimited (filling vendor)' : (customer.holding_limit || 0) },
      { Field: 'Amount Due',           Value: rs(customer.current_bill_amount) },
      { Field: 'Total Billed',         Value: rs(customer.total_billed) },
      { Field: 'Total Received',       Value: rs(customer.total_received) },
      { Field: 'Security Deposit',     Value: rs(customer.security_deposit) },
    ];

    const givenRows = givenTransactions.length ? givenTransactions.map(t => ({
      'Date': d2(t.date), 'Bill No': t.bill_number || '', 'Gas Type': t.gas_type_name || '',
      'Size': t.size_label || '', 'Serial No': t.serial_number || '',
      'Qty': t.quantity || 0, 'Rate': rs(t.rate), 'Amount': rs(t.amount)
    })) : [{ 'Note': 'No cylinders filled yet' }];

    const receivedRows = receivedTransactions.length ? receivedTransactions.map(t => ({
      'Date': d2(t.date), 'Bill No': t.bill_number || '', 'Gas Type': t.gas_type_name || '',
      'Size': t.size_label || '', 'Serial No': t.serial_number || '', 'Qty': t.quantity || 0
    })) : [{ 'Note': 'No cylinders empty yet' }];

    const paymentRows = payments.length ? payments.map(p => ({
      'Receipt No': p.receipt_number || '', 'Challan No': p.challan_no || '', 'Date': d2(p.date),
      'Amount Received': rs(p.amount_received), 'Discount': rs(p.discount),
      'Net Amount': rs((p.amount_received || 0) - (p.discount || 0)),
      'Mode': paymentModeLabel(p.payment_mode),
      'Cheque No': p.payment_mode === 'CHEQUE' ? (p.cheque_number || '') : '',
      'UPI Txn ID': (p.payment_mode === 'UPI' || p.payment_mode === 'ONLINE') ? (p.upi_transaction_id || '') : '',
      'Remarks': p.remarks || ''
    })) : [{ 'Note': 'No payments recorded yet' }];

    const heldList = customer.held_cylinders || [];
    const heldRows = heldList.length ? heldList.map(c => ({
      'Serial No': c.serial_number || '', 'Gas Type': c.gas_type_name || '', 'Size': c.size_label || '',
      'Date Filled': d2(c.date_given), 'Days Held': c.date_given ? Math.floor((Date.now() - new Date(c.date_given).getTime()) / 86400000) : '',
      'Bill No': c.bill_number || '', 'Challan No': c.challan_no || ''
    })) : [{ 'Note': 'No cylinders currently held' }];

    try {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(infoRows),     'Customer Info');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(heldRows),     'Currently Held');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(givenRows),    'Cylinders Filled');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(receivedRows), 'Cylinders Empty');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(paymentRows),  'Payments');
      XLSX.writeFile(wb, `${getExportFileName('customer-history', { customerName: customer.company_name })}.xlsx`);
    } catch (err) {
      console.error('Excel export failed:', err);
      showToast('Excel export failed: ' + err.message);
    }
  };

  const printCustomer = async () => {
    const bizName = await getBusinessName();
    const d2 = (d) => formatDate(d);
    const rs = (n) => '₹' + (n || 0).toFixed(2);

    const section = (title, headers, rows) => {
      if (!rows.length) return `<h3 style="margin:16px 0 4px">${esc(title)}</h3><p style="color:#64748b;font-size:10px">No records</p>`;
      const th = headers.map(h => `<th>${esc(h)}</th>`).join('');
      const tb = rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('');
      return `<h3 style="margin:16px 0 6px;font-size:12px">${esc(title)}</h3>
        <table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`;
    };

    const contactsStr = (Array.isArray(customer.additional_contacts) ? customer.additional_contacts : [])
      .map(c => c.name ? `${esc(c.name)}: ${esc(c.number)}` : esc(c.number)).join(', ');

    const infoTable = `<table style="width:auto;margin-bottom:8px">
      <tr><td><b>Company</b></td><td>${esc(customer.company_name)}</td><td style="padding-left:20px"><b>Primary Contact</b></td><td>${esc(customer.phone_primary || '')}</td></tr>
      <tr><td><b>Contact</b></td><td>${esc(customer.contact_person || '')}</td><td style="padding-left:20px"><b>Telephone</b></td><td>${esc(customer.phone_alternate || '')}</td></tr>
      <tr><td><b>GST</b></td><td>${esc(customer.gst_number || '')}</td><td style="padding-left:20px"><b>Cylinders Held</b></td><td>${customer.cylinders_held || 0}</td></tr>
      ${contactsStr ? `<tr><td><b>Other Contacts</b></td><td colspan="3">${contactsStr}</td></tr>` : ''}
      <tr><td><b>Amount Due</b></td><td colspan="3">${rs(customer.current_bill_amount)}</td></tr>
    </table>`;

    const givenSec = section('Cylinders Filled',
      ['Date','Bill No','Gas Type','Size','Serial No','Qty','Rate','Amount'],
      givenTransactions.map(t => [d2(t.date), t.bill_number, t.gas_type_name, t.size_label, t.serial_number, t.quantity, rs(t.rate), rs(t.amount)])
    );
    const recvSec = section('Cylinders Empty',
      ['Date','Bill No','Gas Type','Size','Serial No','Qty'],
      receivedTransactions.map(t => [d2(t.date), t.bill_number, t.gas_type_name, t.size_label, t.serial_number, t.quantity])
    );
    const pymtSec = section('Payment History',
      ['Receipt No','Challan No','Date','Amount','Discount','Net','Mode','Cheque No. / UPI Txn ID','Remarks'],
      payments.map(p => [p.receipt_number, p.challan_no||'', d2(p.date), rs(p.amount_received), rs(p.discount), rs((p.amount_received||0)-(p.discount||0)), paymentModeLabel(p.payment_mode), paymentRef(p), p.remarks||''])
    );

    const docTitle = getExportFileName('customer-ledger', { customerName: customer.company_name });
    const html = `<!DOCTYPE html><html><head><title>${docTitle}</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:Arial,sans-serif;font-size:11px;padding:20px;color:#1e293b}
      h2{font-size:16px;margin-bottom:12px}
      table{border-collapse:collapse;width:100%;margin-bottom:4px}
      th{background:#1e293b;color:#fff;padding:5px 8px;text-align:left;font-size:10px}
      td{padding:4px 8px;border-bottom:1px solid #e2e8f0;font-size:10px}
      tr:nth-child(even) td{background:#f8fafc}
      @page{margin:12mm}
    </style></head><body>
    <h2>${esc(bizName)} — Customer Report: ${esc(customer.company_name)}</h2>
    <p style="color:#64748b;font-size:10px;margin-bottom:12px">Generated: ${formatDateTime(new Date())}</p>
    ${infoTable}${givenSec}${recvSec}${pymtSec}
    <script>window.onload=function(){window.print();window.onafterprint=function(){window.close()}}<\/script>
    </body></html>`;

    const w = window.open('', '_blank', 'width=1000,height=700,scrollbars=yes');
    if (w) { w.document.write(html); w.document.close(); }
    else { showToast('Please allow pop-ups to use Print / PDF.', 'info'); }
  };

  // Paginated views — most recent first (backend already sorts -bill_date / -date).
  const [givenVisible, givenMore, givenOpen, setGivenOpen] = useViewAll(givenTransactions, 10);
  const [receivedVisible, receivedMore, receivedOpen, setReceivedOpen] = useViewAll(receivedTransactions, 10);
  const [paymentsVisible, paymentsMore, paymentsOpen, setPaymentsOpen] = useViewAll(payments, 5);
  const [pcHistVisible, pcHistMore, pcHistOpen, setPcHistOpen] = useViewAll(personalHistory, 5);

  // Customer-scoped bill list (Phase 6) — same row shape as the global Transaction History.
  const billRows = customerBills.map(b => ({
    _id: b._id,
    date: b.bill_date,
    bill_number: b.bill_number,
    challan_no: b.challan_no || '',
    transaction_type: b.transaction_type,
    cylinders: (b.total_given_qty || 0) + (b.total_received_qty || 0),
    amount: b.total_bill_amount || 0,
    edited: !!(b.edit_history && b.edit_history.length)
  }));
  const [billsVisible, billsMore, billsOpen, setBillsOpen] = useViewAll(billRows, 10);
  const billColumns = [
    { header: 'Date', cell: (r) => formatDate(r.date) },
    { header: 'Bill No.', cell: (r) => <><strong>{r.bill_number}</strong>{r.edited && <span className="badge badge-warning" style={{marginLeft:'0.35rem', fontSize:'0.62rem'}}>Updated</span>}</> },
    { header: 'Challan No.', cell: (r) => r.challan_no || '-' },
    { header: 'Type', cell: (r) => directionLabel(r.transaction_type) },
    { header: 'Cylinders', cell: (r) => r.cylinders },
    { header: 'Total Amount', cell: (r) => `₹${r.amount.toFixed(2)}` }
  ];

  // Cylinders this customer is currently holding (backend nets given vs. own returns, excluding
  // cross-customer returns). Most recent first.
  const heldCylinders = customer?.held_cylinders || [];
  const [heldVisible, heldMore, heldOpen, setHeldOpen] = useViewAll(heldCylinders, 10);
  const daysHeld = (d) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null;
  const heldColumns = [
    { header: 'Serial No.', cell: (c) => <strong>{c.serial_number}</strong> },
    { header: 'Gas Type', cell: (c) => c.gas_type_name },
    { header: 'Size', cell: (c) => c.size_label },
    { header: 'Date Filled', cell: (c) => formatDate(c.date_given) },
    { header: 'Days Held', cell: (c) => { const d = daysHeld(c.date_given); return d === null ? '—' : d; } },
    { header: 'Bill No.', cell: (c) => c.bill_number || '-' },
    { header: 'Challan No.', cell: (c) => c.challan_no || '-' }
  ];

  const givenColumns = [
    { header: 'Date', cell: (t) => formatDate(t.date) },
    { header: 'Bill No.', cell: (t) => t.bill_number },
    { header: 'Gas Type', cell: (t) => t.gas_type_name },
    { header: 'Size', cell: (t) => t.size_label },
    { header: 'Serial Number', cell: (t) => <>{t.serial_number}{t.returned_via && <ReturnBadge text={`Returned via ${t.returned_via_name || 'another customer'}${t.returned_date ? ' on ' + formatDate(t.returned_date) : ''}`} customerId={t.returned_via} onSelectCustomer={onSelectCustomer} />}</> },
    { header: 'Personal Cyls.', cell: (t) => t.personal_cylinders > 0 ? t.personal_cylinders : '—' },
    { header: 'Rate', cell: (t) => `₹${(t.rate || 0).toFixed(2)}` },
    { header: 'Amount', cell: (t) => `₹${(t.amount || 0).toFixed(2)}` }
  ];
  const receivedColumns = [
    { header: 'Date', cell: (t) => formatDate(t.date) },
    { header: 'Bill No.', cell: (t) => t.bill_number },
    { header: 'Gas Type', cell: (t) => t.gas_type_name },
    { header: 'Size', cell: (t) => t.size_label },
    { header: 'Serial Number', cell: (t) => <>{t.serial_number}{t.returned_on_behalf_of && <ReturnBadge text={`Returned on behalf of ${t.returned_on_behalf_of_name || 'another customer'}`} customerId={t.returned_on_behalf_of} onSelectCustomer={onSelectCustomer} />}</> },
    { header: 'Personal Cyls.', cell: (t) => t.personal_cylinders > 0 ? t.personal_cylinders : '—' },
    { header: 'Quantity', cell: (t) => t.quantity }
  ];
  // Filling vendors read the opposite way (Phase 16): pcOut = sent to the vendor for filling,
  // pcIn = received back filled, and the running figure is "outstanding WITH the vendor" —
  // a state that is normal, not a data inconsistency. The backend flags vendor rows only
  // when MORE came back than was ever sent.
  const isVendorCust = !!customer?.is_filling_vendor;
  const pcNetCell = (r) => (
    <>
      <strong>{isVendorCust ? (r.net_with_vendor ?? 0) : r.net_at_plant}</strong>
      {r.inconsistent && (
        <span style={{marginLeft:'0.4rem', background:'#FEF3C7', color:'#B45309', border:'1px solid #FDE68A',
          borderRadius:'4px', padding:'1px 6px', fontSize:'0.68rem', whiteSpace:'nowrap'}}>
          ⚠ Data inconsistency
        </span>
      )}
    </>
  );
  const pcTakenHeader = isVendorCust ? 'Received Back Filled' : 'Taken from Customer';
  const pcReturnedHeader = isVendorCust ? 'Sent for Filling' : 'Returned to Customer';
  const pcNetHeader = isVendorCust ? 'Outstanding with Vendor' : 'Net at Plant';
  const pcHistColumns = [
    { header: 'Date', cell: (r) => formatDate(r.date) },
    { header: 'Bill No.', cell: (r) => (
      <button type="button" className="link-btn" onClick={() => { setPcHistOpen(false); setDetailBillId(r.bill_id); }}>
        <strong>{r.bill_number}</strong>
      </button>
    ) },
    { header: 'Challan No.', cell: (r) => r.challan_no || '-' },
    { header: 'Gas Type', cell: (r) => r.gas_type_name },
    { header: 'Size', cell: (r) => r.size_label },
    ...(isVendorCust ? [
      { header: pcReturnedHeader, cell: (r) => r.returned > 0 ? r.returned : '—' },
      { header: pcTakenHeader, cell: (r) => r.taken > 0 ? r.taken : '—' }
    ] : [
      { header: pcTakenHeader, cell: (r) => r.taken > 0 ? r.taken : '—' },
      { header: pcReturnedHeader, cell: (r) => r.returned > 0 ? r.returned : '—' }
    ]),
    { header: pcNetHeader, cell: pcNetCell }
  ];
  const paymentColumns = [
    { header: 'Receipt No.', cell: (p) => p.receipt_number },
    { header: 'Challan No.', cell: (p) => p.challan_no || '-' },
    { header: 'Date', cell: (p) => formatDate(p.date) },
    { header: 'Amount', cell: (p) => `₹${(p.amount_received || 0).toFixed(2)}` },
    { header: 'Discount', cell: (p) => `₹${(p.discount || 0).toFixed(2)}` },
    { header: 'Mode', cell: (p) => paymentModeLabel(p.payment_mode) },
    { header: 'Cheque No. / UPI Txn ID', cell: (p) => paymentRef(p) },
    { header: 'Remarks', cell: (p) => p.remarks || '-' }
  ];
  const dateKey = (k) => (it) => formatDate(it[k]);

  if (loading) {
    return <Spinner label="Loading customer details…" />;
  }

  if (!customer) {
    return <div className="alert alert-danger">Customer not found</div>;
  }

  return (
    <div>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem'}}>
        <button className="btn btn-secondary" onClick={onBack}>← Back to List</button>
        <div className="btn-group" style={{margin:0}}>
          <button className="btn btn-primary" onClick={() => setShowEdit(true)}>✏️ Edit</button>
          <button className="btn btn-secondary" onClick={printCustomer}>Print / PDF</button>
          <button className="btn btn-secondary" onClick={exportCustomerExcel}>Export Excel</button>
        </div>
      </div>

      {showEdit && (
        <Modal title={`Edit Customer — ${customer.company_name}`} size="wide" onClose={() => setShowEdit(false)}>
          <CustomerForm
            customer={customer}
            onSuccess={() => { setShowEdit(false); fetchCustomerDetail(); }}
            onCancel={() => setShowEdit(false)}
          />
        </Modal>
      )}

      {/* Customer Info */}
      <div className="card">
        <h2 style={{display:'flex', alignItems:'center', gap:'0.6rem', flexWrap:'wrap'}}>
          Customer Information
          {customer.is_filling_vendor && (
            <span style={{display:'inline-flex', alignItems:'center', gap:'0.3rem', padding:'0.15rem 0.65rem',
              borderRadius:'999px', fontSize:'0.75rem', fontWeight:700, background:'#ffedd5', color:'#c2410c', whiteSpace:'nowrap'}}>
              🏭 FILLING VENDOR
            </span>
          )}
        </h2>
        <div className="form-row">
          <div>
            <p><strong>Company Name:</strong> {customer.company_name}</p>
            <p><strong>Contact Person:</strong> {customer.contact_person}</p>
            <p><strong>Primary Contact:</strong> {customer.phone_primary}</p>
            {customer.phone_alternate && <p><strong>Telephone Number:</strong> {customer.phone_alternate}</p>}
            {Array.isArray(customer.additional_contacts) && customer.additional_contacts.length > 0 && (
              <p><strong>Additional Contacts:</strong>{' '}
                {customer.additional_contacts.map((c, i) => (
                  <span key={i}>{c.name ? `${c.name}: ${c.number}` : c.number}{i < customer.additional_contacts.length - 1 ? ', ' : ''}</span>
                ))}
              </p>
            )}
          </div>
          <div>
            <p><strong>Address:</strong> {customer.address}</p>
            <p><strong>GST Number:</strong> {customer.gst_number || 'N/A'}</p>
            <p><strong>Security Deposit:</strong> ₹{customer.security_deposit?.toFixed(2)}</p>
          </div>
        </div>
      </div>

      {/* Cylinder Summary */}
      <div className="card">
        <h2>Cylinder Summary</h2>
        <div className="stats-grid">
          <div className="stat-card blue">
            <h3>Currently Holding</h3>
            <div className="value">{customer.cylinders_held}</div>
          </div>
          <div className="stat-card green">
            <h3>Total Filled (All Time)</h3>
            <div className="value">{customer.total_given}</div>
          </div>
          <div className="stat-card orange">
            <h3>Total Empty (All Time)</h3>
            <div className="value">{customer.total_received_qty}</div>
          </div>
          <div className="stat-card purple">
            <h3>Holding Limit</h3>
            <div className="value">{customer.is_filling_vendor ? 'Unlimited' : (customer.holding_limit || 0)}</div>
          </div>
          {(customer.personalCylindersAtPlant || 0) > 0 && (
            <div className="stat-card blue">
              <h3>Their Cylinders at Plant</h3>
              <div className="value">{customer.personalCylindersAtPlant}</div>
            </div>
          )}
        </div>

        {customer.status === 'OVER LIMIT' && (
          <div className="alert alert-danger">
            ⚠️ Customer is currently OVER LIMIT by {customer.cylinders_held - customer.holding_limit} cylinders
          </div>
        )}

        {customer.cylinder_breakdown && customer.cylinder_breakdown.length > 0 && (
          <div>
            <h3>Breakdown by Type</h3>
            <table>
              <thead>
                <tr>
                  <th>Gas Type</th>
                  <th>Size</th>
                  <th>Total Filled</th>
                  <th>Total Empty</th>
                  <th>Currently Holding</th>
                </tr>
              </thead>
              <tbody>
                {customer.cylinder_breakdown.map((item, index) => (
                  <tr key={index}>
                    <td>{item.gas_type_name}</td>
                    <td>{item.size_label}</td>
                    <td>{item.total_given}</td>
                    <td>{item.total_received}</td>
                    <td><strong>{item.currently_held}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Financial Summary */}
      <div className="card">
        <h2>Financial Summary</h2>
        <div className="form-row">
          <div>
            <p><strong>Total Billed:</strong> ₹{customer.total_billed?.toFixed(2)}</p>
            <p><strong>Total Received:</strong> ₹{customer.total_received?.toFixed(2)}</p>
            {(() => {
              const due = customer.current_bill_amount || 0;
              const owes = due > 0;
              return (
                <p style={owes ? {background:'#FEF2F2', borderRadius:'4px', padding:'0.2rem 0.45rem', margin:'0.25rem -0.45rem 0'} : {marginTop:'0.25rem'}}>
                  <strong>Amount Due:</strong>{' '}
                  <span style={{color: owes ? '#DC2626' : '#16A34A', fontWeight: owes ? 700 : 600}}>
                    ₹{due.toFixed(2)}
                  </span>
                </p>
              );
            })()}
          </div>
          <div>
            <p><strong>Total Discount:</strong> ₹{customer.total_discount?.toFixed(2)}</p>
            <p><strong>Security Deposit:</strong> ₹{customer.security_deposit?.toFixed(2)}</p>
          </div>
        </div>

        <button
          className="btn btn-primary"
          onClick={() => setShowPaymentForm(!showPaymentForm)}
        >
          {showPaymentForm ? 'Cancel' : 'Record Payment'}
        </button>

        {showPaymentForm && (
          <Modal title={`Record Payment — ${customer.company_name}`} size="wide" onClose={() => setShowPaymentForm(false)}>
            <PaymentForm
              customerId={customerId}
              onSuccess={() => {
                setShowPaymentForm(false);
                fetchCustomerDetail();
              }}
              onCancel={() => setShowPaymentForm(false)}
            />
          </Modal>
        )}
      </div>

      {/* Personal Cylinders at Plant — quantity-only count, shown only when we hold any */}
      {(customer.personalCylindersAtPlant || 0) > 0 && (
        <div className="card">
          <h2 style={{margin:'0 0 0.5rem', border:'none', padding:0}}>📦 Personal Cylinders at Plant: {customer.personalCylindersAtPlant}</h2>
          <p style={{color:'var(--text-muted)', fontSize:'0.85rem', margin:0}}>
            This customer's own cylinders currently held at our plant.
          </p>
        </div>
      )}

      {/* Personal Cylinder History — every transaction where personal cylinders moved.
          Hidden entirely when this customer has no personal-cylinder activity. */}
      {personalHistory.length > 0 && (
        <div className="card">
          <h2>Personal Cylinder History</h2>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Bill No.</th>
                  <th>Challan No.</th>
                  <th>Gas Type</th>
                  <th>Size</th>
                  <th>{isVendorCust ? pcReturnedHeader : pcTakenHeader}</th>
                  <th>{isVendorCust ? pcTakenHeader : pcReturnedHeader}</th>
                  <th>{pcNetHeader}</th>
                </tr>
              </thead>
              <tbody>
                {pcHistVisible.map((r, i) => (
                  <tr key={`${r.bill_id}-${i}`}>
                    <td>{formatDate(r.date)}</td>
                    <td>
                      <button type="button" className="link-btn" onClick={() => setDetailBillId(r.bill_id)}>
                        <strong>{r.bill_number}</strong>
                      </button>
                    </td>
                    <td>{r.challan_no || '-'}</td>
                    <td>{r.gas_type_name}</td>
                    <td>{r.size_label}</td>
                    <td>{isVendorCust ? (r.returned > 0 ? r.returned : '—') : (r.taken > 0 ? r.taken : '—')}</td>
                    <td>{isVendorCust ? (r.taken > 0 ? r.taken : '—') : (r.returned > 0 ? r.returned : '—')}</td>
                    <td>{pcNetCell(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pcHistMore && <ViewAllButton count={personalHistory.length} onClick={() => setPcHistOpen(true)} />}
          </div>
        </div>
      )}

      {/* Currently Holding Cylinders */}
      <div className="card" id="currently-holding">
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'0.5rem'}}>
          <h2 style={{margin:0, border:'none', padding:0}}>Currently Holding Cylinders ({heldCylinders.length})</h2>
          {customer.status === 'OVER LIMIT' && (
            <span className="badge badge-danger">Over limit by {(customer.cylinders_held || 0) - (customer.holding_limit || 0)}</span>
          )}
        </div>
        <p style={{color:'var(--text-muted)', fontSize:'0.8rem', margin:'0.4rem 0 0.75rem'}}>
          Cylinders this customer holds right now. Any cylinder returned by another customer on their
          behalf is automatically removed from this list.
        </p>
        {heldCylinders.length === 0 ? (
          <EmptyState icon="✅" message="No cylinders currently held" hint="All filled cylinders have been returned." />
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Sr.</th><th>Serial No.</th><th>Gas Type</th><th>Size</th>
                  <th>Date Filled</th><th>Days Held</th><th>Bill No.</th><th>Challan No.</th>
                </tr>
              </thead>
              <tbody>
                {heldVisible.map((c, i) => {
                  const d = daysHeld(c.date_given);
                  return (
                    <tr key={c.serial_number + '-' + i}>
                      <td>{i + 1}</td>
                      <td><strong>{c.serial_number}</strong></td>
                      <td>{c.gas_type_name}</td>
                      <td>{c.size_label}</td>
                      <td>{formatDate(c.date_given)}</td>
                      <td><strong>{d === null ? '—' : d}</strong></td>
                      <td>{c.bill_number || '-'}</td>
                      <td>{c.challan_no || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {heldMore && <ViewAllButton count={heldCylinders.length} onClick={() => setHeldOpen(true)} />}
          </div>
        )}
      </div>

      {heldOpen && (
        <ListModal title="Currently Holding Cylinders" items={heldCylinders} columns={heldColumns}
          searchKeys={['serial_number', 'gas_type_name', 'size_label', 'bill_number', 'challan_no']}
          searchPlaceholder="Search by serial no., gas type, size, bill, or challan…"
          onClose={() => setHeldOpen(false)} />
      )}

      {/* Cylinder Aging History (Phase 4): days-held per currently-held cylinder + rental calculator */}
      <div className="card" id="aging-history">
        <h2>Cylinder Aging History ({agingRows.length})</h2>
        <p style={{color:'var(--text-muted)', fontSize:'0.8rem', margin:'0.4rem 0 0.75rem'}}>
          How long each cylinder has been with this customer, and the site it was issued from.
        </p>
        {agingRows.length === 0 ? (
          <EmptyState icon="⏳" message="No cylinders currently held" hint="Aging appears here while the customer holds cylinders." />
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Rotational No.</th><th>Gas Type</th><th>Size</th>
                  <th>Issued From</th><th>Date Given</th><th>Days Held</th>
                </tr>
              </thead>
              <tbody>
                {agingRows.map((r) => (
                  <tr key={r.serial_number}>
                    <td><strong>{r.serial_number}</strong></td>
                    <td>{r.gas_type}</td>
                    <td>{r.capacity}</td>
                    <td>{locationText(r.location)}</td>
                    <td>{formatDate(r.date_given)}</td>
                    <td><strong>{r.days_held}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {agingRows.length > 0 && (
          <div style={{display:'flex', justifyContent:'flex-end', marginTop:'0.75rem'}}>
            <button className="btn btn-primary" onClick={() => setShowRental(true)}>🧮 Calculate Rental Summary</button>
          </div>
        )}
      </div>

      {showRental && (
        <RentalSummaryModal
          customer={customer}
          customerId={customerId}
          onClose={() => setShowRental(false)}
          onGenerated={() => { fetchCustomerDetail(); }}
        />
      )}

      {/* Transaction History — this customer's bills only (Phase 6). Same columns and
          row-click-to-detail behavior as the global Transaction History page. */}
      <div className="card" id="transaction-history">
        <h2>Transaction History ({billRows.length})</h2>
        <p style={{color:'var(--text-muted)', fontSize:'0.8rem', margin:'0.4rem 0 0.75rem'}}>
          Every bill for this customer. Click a row to view the full transaction, its cylinders, and its payment history.
        </p>
        {billRows.length === 0 ? (
          <EmptyState icon="🧾" message="No transactions yet" hint="Bills recorded for this customer will appear here." />
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Bill No.</th><th>Challan No.</th>
                  <th>Type</th><th>Cylinders</th><th>Total Amount</th>
                </tr>
              </thead>
              <tbody>
                {billsVisible.map((r) => (
                  <tr key={r._id} style={{cursor:'pointer'}} onClick={() => setDetailBillId(r._id)}>
                    <td>{formatDate(r.date)}</td>
                    <td><strong>{r.bill_number}</strong>{r.edited && <span className="badge badge-warning" style={{marginLeft:'0.35rem', fontSize:'0.62rem'}}>Updated</span>}</td>
                    <td>{r.challan_no || '-'}</td>
                    <td>{directionLabel(r.transaction_type)}</td>
                    <td>{r.cylinders}</td>
                    <td>₹{r.amount.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {billsMore && <ViewAllButton count={billRows.length} onClick={() => setBillsOpen(true)} />}
          </div>
        )}
      </div>

      {/* History sections (Phase 7/8): three side-by-side buttons, collapsed by default;
          clicking one expands its table inline directly below the row. */}
      <div className="card">
        <div className="btn-group" style={{flexWrap:'wrap'}}>
          <button className={`btn ${openHist === 'filled' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setOpenHist(openHist === 'filled' ? null : 'filled')}>
            🛢️ Cylinders Filled History ({givenTransactions.length})
          </button>
          <button className={`btn ${openHist === 'empty' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setOpenHist(openHist === 'empty' ? null : 'empty')}>
            🔄 Cylinders Empty History ({receivedTransactions.length})
          </button>
          <button className={`btn ${openHist === 'payments' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setOpenHist(openHist === 'payments' ? null : 'payments')}>
            💰 Payment History ({payments.length})
          </button>
        </div>

      {openHist === 'filled' && (
      <div style={{marginTop:'1rem'}}>
        <h2>Cylinders Filled History</h2>
        {givenTransactions.length === 0 ? (
          <EmptyState icon="🛢️" message="No cylinders filled yet" />
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Bill No.</th>
                  <th>Gas Type</th>
                  <th>Size</th>
                  <th>Serial Number</th>
                  <th>Personal Cyls.</th>
                  <th>Rate</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {givenVisible.map(txn => {
                  // A GIVEN cylinder returned via another customer (cross-customer return).
                  const returnedVia = !!txn.returned_via;
                  const badge = returnedVia
                    ? `Returned via ${txn.returned_via_name || 'another customer'}${txn.returned_date ? ' on ' + formatDate(txn.returned_date) : ''}`
                    : null;
                  return (
                  <tr key={txn.line_item_id} style={returnedVia ? RETURN_ROW_STYLE : {}}>
                    <td>{formatDate(txn.date)}</td>
                    <td>{txn.bill_number}</td>
                    <td>{txn.gas_type_name}</td>
                    <td>{txn.size_label}</td>
                    <td>
                      {txn.serial_number}
                      {badge && <ReturnBadge text={badge} customerId={txn.returned_via} onSelectCustomer={onSelectCustomer} />}
                    </td>
                    <td>{txn.personal_cylinders > 0 ? txn.personal_cylinders : '—'}</td>
                    <td>₹{(txn.rate || 0).toFixed(2)}</td>
                    <td>₹{(txn.amount || 0).toFixed(2)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            {givenMore && <ViewAllButton count={givenTransactions.length} onClick={() => setGivenOpen(true)} />}
            <Pagination pagination={givenPagination} onPageChange={(p) => { setGivenPage(p); fetchCustomerDetail(); }} />
          </div>
        )}
      </div>
      )}

      {openHist === 'empty' && (
      <div style={{marginTop:'1rem'}}>
        <h2>Cylinders Empty History</h2>
        {receivedTransactions.length === 0 ? (
          <EmptyState icon="🔄" message="No cylinders empty yet" />
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Bill No.</th>
                  <th>Gas Type</th>
                  <th>Size</th>
                  <th>Serial Number</th>
                  <th>Personal Cyls.</th>
                  <th>Quantity</th>
                </tr>
              </thead>
              <tbody>
                {receivedVisible.map(txn => {
                  // A cylinder this customer returned on behalf of its original holder.
                  const onBehalf = !!txn.returned_on_behalf_of;
                  return (
                  <tr key={txn.line_item_id} style={onBehalf ? RETURN_ROW_STYLE : {}}>
                    <td>{formatDate(txn.date)}</td>
                    <td>{txn.bill_number}</td>
                    <td>{txn.gas_type_name}</td>
                    <td>{txn.size_label}</td>
                    <td>
                      {txn.serial_number}
                      {onBehalf && <ReturnBadge
                        text={`Returned on behalf of ${txn.returned_on_behalf_of_name || 'another customer'}`}
                        customerId={txn.returned_on_behalf_of} onSelectCustomer={onSelectCustomer} />}
                    </td>
                    <td>{txn.personal_cylinders > 0 ? txn.personal_cylinders : '—'}</td>
                    <td>{txn.quantity}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            {receivedMore && <ViewAllButton count={receivedTransactions.length} onClick={() => setReceivedOpen(true)} />}
            <Pagination pagination={receivedPagination} onPageChange={(p) => { setReceivedPage(p); fetchCustomerDetail(); }} />
          </div>
        )}
      </div>
      )}

      {openHist === 'payments' && (
      <div style={{marginTop:'1rem'}}>
        <h2>Payment History</h2>
        {payments.length === 0 ? (
          <EmptyState icon="💰" message="No payments recorded yet" />
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Receipt No.</th>
                  <th>Challan No.</th>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Discount</th>
                  <th>Mode</th>
                  <th>Cheque No. / UPI Txn ID</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {paymentsVisible.map(payment => (
                  <tr key={payment.receipt_id}>
                    <td>{payment.receipt_number}</td>
                    <td>{payment.challan_no || '-'}</td>
                    <td>{formatDate(payment.date)}</td>
                    <td>₹{payment.amount_received.toFixed(2)}</td>
                    <td>₹{payment.discount.toFixed(2)}</td>
                    <td>{paymentModeLabel(payment.payment_mode)}</td>
                    <td>{paymentRef(payment)}</td>
                    <td>{payment.remarks || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {paymentsMore && <ViewAllButton count={payments.length} onClick={() => setPaymentsOpen(true)} />}
            <Pagination pagination={paymentsPagination} onPageChange={(p) => { setPaymentsPage(p); fetchCustomerDetail(); }} />
          </div>
        )}
      </div>
      )}
      </div>

      {pcHistOpen && (
        <ListModal title="Personal Cylinder History" items={personalHistory} columns={pcHistColumns}
          searchKeys={['bill_number', 'challan_no', 'gas_type_name', 'size_label', dateKey('date')]}
          searchPlaceholder="Search by bill no., challan no., gas type, size, or date…"
          onClose={() => setPcHistOpen(false)} />
      )}
      {billsOpen && (
        <ListModal title="Transaction History" items={billRows} columns={billColumns}
          searchKeys={['bill_number', 'challan_no', 'transaction_type', dateKey('date')]}
          searchPlaceholder="Search by bill no., challan no., type, or date…"
          onRowClick={(r) => { setBillsOpen(false); setDetailBillId(r._id); }}
          onClose={() => setBillsOpen(false)} />
      )}
      {detailBillId && !editBillId && (
        <TransactionDetailModal billId={detailBillId} payments={payments}
          onClose={() => setDetailBillId(null)}
          onEdit={(auth) => { setEditAuth(auth); setEditBillId(detailBillId); }}
          onBillNumberChanged={(id, n) => setCustomerBills(prev => prev.map(b => b._id === id ? { ...b, bill_number: n } : b))}
          onDeleted={() => { setDetailBillId(null); fetchCustomerDetail(); }} />
      )}
      {editBillId && (
        <EditBillModal billId={editBillId} stepUpToken={editAuth?.step_up_token || ''}
          onClose={() => setEditBillId(null)}
          onSaved={() => { const id = editBillId; setEditBillId(null); fetchCustomerDetail(); setDetailBillId(id); }} />
      )}
      {givenOpen && (
        <ListModal title="Cylinders Filled History" items={givenTransactions} columns={givenColumns}
          searchKeys={['bill_number', 'serial_number', dateKey('date')]}
          searchPlaceholder="Search by bill no., rotational no., or date…" onClose={() => setGivenOpen(false)} />
      )}
      {receivedOpen && (
        <ListModal title="Cylinders Empty History" items={receivedTransactions} columns={receivedColumns}
          searchKeys={['bill_number', 'serial_number', dateKey('date')]}
          searchPlaceholder="Search by bill no., rotational no., or date…" onClose={() => setReceivedOpen(false)} />
      )}
      {paymentsOpen && (
        <ListModal title="Payment History" items={payments} columns={paymentColumns}
          searchKeys={['receipt_number', 'challan_no', (p) => p.amount_received, dateKey('date')]}
          searchPlaceholder="Search by receipt no., challan no., amount, or date…" onClose={() => setPaymentsOpen(false)} />
      )}
    </div>
  );
}

// Payment Form Component
export function PaymentForm({ customerId, billId, challanNo, onSuccess, onCancel }) {
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    amount_received: '',
    discount: 0,
    payment_mode: 'CASH',
    cheque_number: '',
    upi_transaction_id: '',
    remarks: ''
  });
  const [errors, setErrors] = useState({});

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!formData.date) errs.date = 'Date is required';
    if (!formData.amount_received || parseFloat(formData.amount_received) <= 0) errs.amount_received = 'Enter a valid amount';
    if (formData.payment_mode === 'CHEQUE' && !formData.cheque_number.trim()) errs.cheque_number = 'Cheque number is required';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    try {
      const response = await apiFetch(`${API_URL}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          ...formData,
          customer_id: customerId,
          bill_id: billId
        })
      });

      if (response.ok) {
        showToast('Payment recorded successfully.', 'success');
        onSuccess();
      } else {
        showToast(await apiErrorMessage(response, 'Error recording payment'));
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <PaymentFields formData={formData} setFormData={setFormData} errors={errors} />
      {formData.amount_received > 0 && (
        <div style={{padding: '0.75rem 1rem', backgroundColor: '#e7f3ff', borderRadius: '4px', margin: '0.25rem 0 0'}}>
          <p style={{margin: 0}}><strong>Net Amount: ₹{((parseFloat(formData.amount_received) || 0) - (parseFloat(formData.discount) || 0)).toFixed(2)}</strong></p>
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">💾 Save Payment</button>
      </div>
    </form>
  );
}

// Shared horizontal payment fields used by both Record-Payment forms.
// Row 1: Date | Amount Received · Row 2: Payment Mode | Cheque/UPI (contextual) | Discount · Row 3: Challan No. | Remarks (wider)
export function PaymentFields({ formData, setFormData, errors = {} }) {
  return (
    <>
      <div className="form-row cols-2">
        <div className="form-group">
          <label>Date *</label>
          <input type="date" className={`form-control ${errors.date ? 'input-error' : ''}`}
            value={formData.date} onChange={(e) => setFormData({...formData, date: e.target.value})} />
          {errors.date && <div className="field-error">{errors.date}</div>}
        </div>
        <div className="form-group">
          <label>Amount Received *</label>
          <input type="number" className={`form-control ${errors.amount_received ? 'input-error' : ''}`}
            value={formData.amount_received} onChange={(e) => setFormData({...formData, amount_received: e.target.value})}
            min="0" step="0.01" />
          {errors.amount_received && <div className="field-error">{errors.amount_received}</div>}
        </div>
      </div>

      <div className="form-row cols-3">
        <div className="form-group">
          <label>Payment Mode *</label>
          <select className="form-control" value={formData.payment_mode}
            onChange={(e) => setFormData({...formData, payment_mode: e.target.value})}>
            <option value="CASH">Cash</option>
            <option value="CHEQUE">Cheque</option>
            <option value="UPI">UPI Transfer</option>
          </select>
        </div>

        {/* Contextual middle field — cheque no. / UPI txn id / empty placeholder to keep the 3-column grid */}
        {formData.payment_mode === 'CHEQUE' ? (
          <div className="form-group">
            <label>Cheque Number *</label>
            <input type="text" className={`form-control ${errors.cheque_number ? 'input-error' : ''}`}
              value={formData.cheque_number} onChange={(e) => setFormData({...formData, cheque_number: e.target.value})} />
            {errors.cheque_number && <div className="field-error">{errors.cheque_number}</div>}
          </div>
        ) : formData.payment_mode === 'UPI' ? (
          <div className="form-group">
            <label>UPI Transaction ID</label>
            <input type="text" className="form-control" value={formData.upi_transaction_id}
              onChange={(e) => setFormData({...formData, upi_transaction_id: e.target.value})} placeholder="Optional" />
          </div>
        ) : (
          <div className="form-group" aria-hidden="true"></div>
        )}

        <div className="form-group">
          <label>Discount</label>
          <input type="number" className="form-control" value={formData.discount}
            onChange={(e) => setFormData({...formData, discount: e.target.value})} min="0" step="0.01" />
        </div>
      </div>

      {/* Challan No. removed (Phase 5) — receipts derive it from the linked bill automatically. */}
      <div className="form-row">
        <div className="form-group">
          <label>Remarks</label>
          <input type="text" className="form-control" value={formData.remarks}
            onChange={(e) => setFormData({...formData, remarks: e.target.value})} placeholder="Optional notes about this payment…" />
        </div>
      </div>
    </>
  );
}

// Convert raw API data → clean flat rows per report type
export function getReportRows(reportType, data) {
  const d2 = (d) => formatDate(d);
  const rs = (n) => parseFloat((n || 0).toFixed(2));

  switch (reportType) {
    case 'ledger':
      return data.map((c, i) => ({
        'Sr': i + 1,
        'Company Name': c.company_name || '',
        'Phone': c.phone_primary || '',
        'GST No': c.gst_number || '',
        'Security Deposit': rs(c.security_deposit),
        'Holding Limit': c.is_filling_vendor ? 'Unlimited' : (c.holding_limit || 0),
        'Cylinders Held': c.cylinder_hold || 0,
        'Payment Due': rs(c.bill_amount),
        'Cylinder Status': c.status || 'OK'
      }));
    case 'over-limit':
      return data.map((c, i) => ({
        'Sr': i + 1,
        'Company Name': c.company_name || '',
        'Phone': c.phone_primary || '',
        'Cylinders Held': c.cylinders_held || 0,
        'Holding Limit': c.holding_limit || 0,
        'Over By': (c.cylinders_held || 0) - (c.holding_limit || 0)
      }));
    case 'outstanding':
      return data.map((o, i) => ({
        'Sr': i + 1,
        'Company Name': o.company_name || '',
        'Contact Person': o.contact_person || '',
        'Phone': o.phone_primary || '',
        'Total Billed': rs(o.total_billed),
        'Total Paid': rs(o.total_paid),
        'Outstanding': rs(o.outstanding_amount)
      }));
    case 'deposits':
      return data.map((d, i) => ({
        'Sr': i + 1,
        'Company Name': d.company_name || '',
        'Contact Person': d.contact_person || '',
        'Phone': d.phone_primary || '',
        'Security Deposit': rs(d.security_deposit)
      }));
    default:
      return data;
  }
}

// Open a clean popup window with just the table, then trigger browser print → Save as PDF
export async function printReportPopup(title, rows, fileName) {
  if (!rows || rows.length === 0) { showToast('No data to print', 'info'); return; }
  const bizName = await getBusinessName();
  const headers = Object.keys(rows[0]);
  const th = headers.map(h => `<th>${esc(h)}</th>`).join('');
  const tb = rows.map(r =>
    `<tr>${headers.map(h => `<td>${esc(r[h] !== null && r[h] !== undefined ? r[h] : '')}</td>`).join('')}</tr>`
  ).join('');

  // The popup document's <title> is what the browser uses as the default PDF file name.
  const docTitle = fileName || title;
  const html = `<!DOCTYPE html><html><head><title>${docTitle}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,Helvetica,sans-serif;font-size:11px;padding:20px;color:#1e293b}
    h2{font-size:16px;font-weight:700;margin-bottom:4px}
    .sub{font-size:10px;color:#64748b;margin-bottom:16px}
    table{border-collapse:collapse;width:100%}
    th{background:#1e293b;color:#fff;padding:7px 10px;text-align:left;font-size:10px;font-weight:600}
    td{padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:10px}
    tr:nth-child(even) td{background:#f8fafc}
    @page{margin:15mm}
  </style></head><body>
  <h2>${esc(bizName)} — ${esc(title)}</h2>
  <div class="sub">Generated: ${formatDateTime(new Date())}</div>
  <table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>
  <script>window.onload=function(){window.print();window.onafterprint=function(){window.close()}}<\/script>
  </body></html>`;

  const w = window.open('', '_blank', 'width=1000,height=700,scrollbars=yes');
  if (w) { w.document.write(html); w.document.close(); }
  else { showToast('Please allow pop-ups to use Print / PDF.', 'info'); }
}

// Reports Component
export function Reports() {
  const [reportType, setReportType] = useState('ledger');
  const [reportData, setReportData] = useState([]);
  const [loading, setLoading] = useState(false);

  // DSR and Stock Summary render as dedicated views with their own fetching/tabs.
  const isDedicated = reportType === 'dsr' || reportType === 'stock-summary';

  const fetchReport = async (type, date) => {
    if (type === 'dsr' || type === 'stock-summary') { setReportData([]); return; }
    setLoading(true);
    try {
      const response = await apiFetch(`${API_URL}/reports/${type}`);
      const data = await response.json();
      setReportData(data);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching report:', error);
      setLoading(false);
    }
  };

  useEffect(() => { fetchReport(reportType); }, [reportType]);

  const reportLabel = {
    'ledger': 'All Customer Ledger',
    'over-limit': 'Over Limit Customers',
    'outstanding': 'Outstanding Dues',
    'deposits': 'Deposit Summary'
  };

  // Map each report type → context-aware file-name context (and the date to stamp).
  const reportFileCtx = {
    'ledger': 'ledger-report', 'over-limit': 'over-limit',
    'outstanding': 'outstanding', 'deposits': 'deposit-report'
  };
  const reportFileName = () => getExportFileName(
    reportFileCtx[reportType] || 'default',
    { pageName: reportLabel[reportType] }
  );

  const handleExportExcel = () => {
    if (!reportData.length) { showToast('No data to export', 'info'); return; }
    const rows = getReportRows(reportType, reportData);
    try {
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, reportLabel[reportType] || 'Report');
      XLSX.writeFile(wb, `${reportFileName()}.xlsx`);
    } catch (err) {
      console.error('XLSX error:', err);
      showToast('Excel export failed: ' + err.message);
    }
  };

  const handlePrint = () => {
    if (!reportData.length) { showToast('No data to print', 'info'); return; }
    const rows = getReportRows(reportType, reportData);
    printReportPopup(reportLabel[reportType] || 'Report', rows, reportFileName());
  };

  return (
    <div className="card">
      <h2>Reports</h2>

      <div className="form-row">
        <div className="form-group">
          <label>Report Type</label>
          <select
            className="form-control"
            value={reportType}
            onChange={(e) => setReportType(e.target.value)}
          >
            {/* Exactly these 6 entries in this order (Phase 8). Old Daily Transaction Report
                and Cylinder Stock Summary are superseded by DSR / Stock Summary. */}
            <option value="ledger">All Customer Ledger</option>
            <option value="over-limit">Over Limit Customer</option>
            <option value="dsr">DSR — Daily Sales Report</option>
            <option value="stock-summary">Stock Summary (Filled / Empty)</option>
            <option value="outstanding">Outstanding Due Report</option>
            <option value="deposits">Deposit Summary</option>
          </select>
        </div>
      </div>

      {!isDedicated && (
        <div className="btn-group">
          <button className="btn btn-primary" onClick={() => fetchReport(reportType)}>
            Refresh
          </button>
          <button className="btn btn-secondary" onClick={handlePrint} disabled={!reportData.length}>
            Print / PDF
          </button>
          <button className="btn btn-secondary" onClick={handleExportExcel} disabled={!reportData.length}>
            Export Excel
          </button>
        </div>
      )}

      {isDedicated ? (
        reportType === 'dsr' ? <DSRReport /> : <StockSummaryReport />
      ) : loading ? (
        <Spinner label="Loading report…" />
      ) : (
        <div className="table-container" style={{marginTop: '1rem'}}>
          {reportData.length === 0 ? (
            <EmptyState icon="📈" message="No data available for this report" />
          ) : (
            <ReportTable reportType={reportType} data={reportData} />
          )}
        </div>
      )}
    </div>
  );
}

// ─── DSR — Daily Sales Report (Phase 5) ───
// One date, live from bill data. Tabs: All Locations + the 3 sites (default = active_location).
// Reporting person auto-fills from the site's LocationProfile manager; PC has its own columns.
export function DSRReport() {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [tab, setTab] = useState(null); // null = resolving default; 'ALL' | location
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`${API_URL}/profile/locations`);
        const d = res.ok ? await res.json() : null;
        setTab((d && LOCATIONS.includes(d.active_location)) ? d.active_location : 'ALL');
      } catch { setTab('ALL'); }
    })();
  }, []);

  useEffect(() => {
    if (!tab) return;
    (async () => {
      setLoading(true);
      try {
        const p = new URLSearchParams({ date });
        if (tab !== 'ALL') p.set('location', tab);
        const res = await apiFetch(`${API_URL}/reports/dsr?${p.toString()}`);
        setData(res.ok ? await res.json() : null);
        setRemarkDrafts({});
      } catch { setData(null); }
      setLoading(false);
    })();
  }, [tab, date]);

  const rows = (data && data.rows) || [];
  const t = (data && data.totals) || {};

  // ── Per-row Remarks (Phase 10) — free text, saved on blur, additive to PC In/PC Out ──
  const [remarkDrafts, setRemarkDrafts] = useState({});
  const rowKey = (r) => `${r.bill_id}|${r.gas_type}|${r.size}`;
  const saveRemark = async (r) => {
    const key = rowKey(r);
    const value = remarkDrafts[key];
    if (value === undefined || value === (r.remarks || '')) return;
    try {
      const res = await apiFetch(`${API_URL}/bills/${r.bill_id}/dsr-remark`, {
        method: 'PATCH',
        body: JSON.stringify({ gas_type: r.gas_type, size: r.size, remarks: value })
      });
      if (res.ok) {
        setData(prev => ({ ...prev, rows: prev.rows.map(x => rowKey(x) === key ? { ...x, remarks: value.trim() } : x) }));
        setRemarkDrafts(prev => { const n = { ...prev }; delete n[key]; return n; });
        showToast('Remark saved.', 'success');
      } else showToast(await apiErrorMessage(res, 'Could not save remark'));
    } catch { showToast('Could not save remark'); }
  };

  // Column order follows the reference DSR sheet: party first, challan/bill after the
  // quantity columns, amount, remarks last. FILLED/EMPTY labels stay (not GIVEN/RECEIVE).
  const handleExport = () => exportToExcel(
    rows.map((r, i) => ({
      'Sr.': i + 1, 'Party Name': r.customer_name, 'Location': locationText(r.location),
      'Gas': r.gas_type, 'Size': r.size,
      'Filled': r.filled_qty, 'Empty': r.empty_qty, 'PC In': r.pc_in, 'PC Out': r.pc_out,
      'Ch. No.': r.challan_no, 'Bill No.': r.bill_number,
      'Amount': r.amount, 'Remarks': r.remarks || ''
    })), getExportFileName('daily-report', { pageName: 'DSR', date }), 'DSR'
  );

  // Print/PDF (Phase 9): same popup-print pattern as bills/reports, plus a blank
  // Remarks box at the bottom for handwritten notes after printing.
  const handlePrint = async () => {
    if (!rows.length) { showToast('No data to print', 'info'); return; }
    const bizName = await getBusinessName();
    const all = tab === 'ALL';
    // Reference-sheet order: party, gas, quantities, challan, bill, amount, remarks.
    // Phase 14: Sr. numbers PER BILL; Party/Location/Ch.No./Bill No. print once per bill —
    // extra gas/size lines of the same bill leave those cells blank.
    const th = `<tr><th>Sr.</th><th>Party Name</th>${all ? '<th>Location</th>' : ''}<th>Gas</th><th>Size</th><th>Filled</th><th>Empty</th><th>PC In</th><th>PC Out</th><th>Ch. No.</th><th>Bill No.</th><th class="r">Amount</th><th>Remarks</th></tr>`;
    let billIdx = 0; let lastBillId = null;
    const tb = rows.map((r) => {
      const first = r.bill_id !== lastBillId;
      if (first) { billIdx++; lastBillId = r.bill_id; }
      return `<tr>`
        + `<td>${first ? billIdx : ''}</td>`
        + `<td>${first ? esc(r.customer_name || '') : ''}</td>`
        + (all ? `<td>${first ? esc(locationText(r.location)) : ''}</td>` : '')
        + `<td>${esc(r.gas_type)}</td><td>${esc(r.size)}</td><td>${r.filled_qty || ''}</td><td>${r.empty_qty || ''}</td><td>${r.pc_in || ''}</td><td>${r.pc_out || ''}</td>`
        + `<td>${first ? esc(r.challan_no || '-') : ''}</td>`
        + `<td>${first ? `<strong>${esc(r.bill_number)}</strong>` : ''}</td>`
        + `<td class="r">₹${(r.amount || 0).toFixed(2)}</td><td>${esc(r.remarks || '')}</td></tr>`;
    }).join('');
    const tf = `<tr class="tot"><td colspan="${all ? 5 : 4}" class="r">TOTAL</td><td>${t.filled_qty}</td><td>${t.empty_qty}</td><td>${t.pc_in}</td><td>${t.pc_out}</td><td></td><td></td><td class="r">₹${(t.amount || 0).toFixed(2)}</td><td></td></tr>`;
    const fileName = getExportFileName('daily-report', { pageName: 'DSR', date });
    const html = `<!DOCTYPE html><html><head><title>${fileName}</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:Arial,Helvetica,sans-serif;font-size:11px;padding:20px;color:#1e293b}
      h2{font-size:16px;font-weight:700;margin-bottom:4px}
      .sub{font-size:10px;color:#64748b;margin-bottom:4px}
      .meta{font-size:11px;margin-bottom:14px}
      table{border-collapse:collapse;width:100%}
      th{background:#1e293b;color:#fff;padding:6px 8px;text-align:left;font-size:10px;font-weight:600}
      td{padding:5px 8px;border-bottom:1px solid #e2e8f0;font-size:10px}
      .r{text-align:right}
      .tot td{font-weight:700;border-top:2px solid #1e293b}
      .remarks{margin-top:22px}
      .remarks .box{border:1px solid #94a3b8;border-radius:4px;height:110px;margin-top:6px}
      @page{margin:15mm}
    </style></head><body>
    <h2>${esc(bizName)} — Daily Sales Report (DSR)</h2>
    <div class="sub">Generated: ${formatDateTime(new Date())}</div>
    <div class="meta"><strong>Location:</strong> ${esc(data.location_label)} &nbsp;·&nbsp; <strong>Date:</strong> ${formatDate(data.date)} &nbsp;·&nbsp; <strong>Reporting Person:</strong> ${esc(data.reporting_person || '—')}</div>
    <table><thead>${th}</thead><tbody>${tb}</tbody><tfoot>${tf}</tfoot></table>
    <script>window.onload=function(){window.print();window.onafterprint=function(){window.close()}}<\/script>
    </body></html>`;
    const w = window.open('', '_blank', 'width=1000,height=700,scrollbars=yes');
    if (w) { w.document.write(html); w.document.close(); }
    else showToast('Please allow pop-ups to use Print / PDF.', 'info');
  };

  return (
    <div style={{marginTop:'0.5rem'}}>
      {/* Single row (Phase 10): location buttons · date · Print/Export */}
      <div className="btn-group" style={{flexWrap:'wrap', alignItems:'center'}}>
        <button className={`btn ${tab === 'ALL' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('ALL')}>All Locations</button>
        {LOCATIONS.map(l => (
          <button key={l} className={`btn ${tab === l ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(l)}>{LOCATION_LABELS[l]}</button>
        ))}
        <input type="date" className="form-control" style={{width:'auto', marginLeft:'auto'}}
          value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="btn btn-secondary" onClick={handlePrint} disabled={!rows.length}>🖨️ Print / PDF</button>
        <button className="btn btn-secondary" onClick={handleExport} disabled={!rows.length}>Export Excel</button>
      </div>

      {loading || !data ? <Spinner label="Loading DSR…" /> : (
        <>
          <div style={{display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:'0.5rem', margin:'0.75rem 0'}}>
            <div><strong>DSR — {data.location_label}</strong> · {formatDate(data.date)}</div>
            <div><strong>Reporting Person:</strong> {data.reporting_person || (tab === 'ALL' ? '—' : '(no manager set in Profile → Location Profiles)')}</div>
          </div>
          {rows.length === 0 ? (
            <EmptyState icon="🧾" message="No transactions on this date" hint="The DSR fills in automatically as bills are saved." />
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Sr.</th><th>Party Name</th>
                    {tab === 'ALL' && <th>Location</th>}
                    <th>Gas</th><th>Size</th><th>Filled</th><th>Empty</th><th>PC In</th><th>PC Out</th>
                    <th>Ch. No.</th><th>Bill No.</th><th>Amount</th><th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={rowKey(r)}>
                      <td>{i + 1}</td>
                      <td>{r.customer_name}</td>
                      {tab === 'ALL' && <td>{locationText(r.location)}</td>}
                      <td>{r.gas_type}</td>
                      <td>{r.size}</td>
                      <td>{r.filled_qty || ''}</td>
                      <td>{r.empty_qty || ''}</td>
                      <td>{r.pc_in || ''}</td>
                      <td>{r.pc_out || ''}</td>
                      <td>{r.challan_no || '-'}</td>
                      <td><strong>{r.bill_number}</strong></td>
                      <td>₹{(r.amount || 0).toFixed(2)}</td>
                      <td>
                        <input className="form-control" style={{minWidth:'130px', padding:'0.25rem 0.5rem', fontSize:'0.82rem'}}
                          placeholder="e.g. PC"
                          value={remarkDrafts[rowKey(r)] !== undefined ? remarkDrafts[rowKey(r)] : (r.remarks || '')}
                          onChange={(e) => setRemarkDrafts(prev => ({ ...prev, [rowKey(r)]: e.target.value }))}
                          onBlur={() => saveRemark(r)}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{fontWeight:700}}>
                    <td colSpan={tab === 'ALL' ? 5 : 4} style={{textAlign:'right'}}>TOTAL</td>
                    <td>{t.filled_qty}</td><td>{t.empty_qty}</td><td>{t.pc_in}</td><td>{t.pc_out}</td>
                    <td></td><td></td>
                    <td>₹{(t.amount || 0).toFixed(2)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Stock Summary — Filled + Empty tables per location per day (Phase 5, best-effort) ───
export function StockSummaryReport() {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [tab, setTab] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`${API_URL}/profile/locations`);
        const d = res.ok ? await res.json() : null;
        setTab((d && LOCATIONS.includes(d.active_location)) ? d.active_location : LOCATIONS[0]);
      } catch { setTab(LOCATIONS[0]); }
    })();
  }, []);

  // Per-location PC stock (Phase 11) — shown under the Filled/Empty tables.
  const [pcRows, setPcRows] = useState([]);

  useEffect(() => {
    if (!tab) return;
    (async () => {
      setLoading(true);
      try {
        const [res, pcRes] = await Promise.all([
          apiFetch(`${API_URL}/reports/stock-summary?date=${date}&location=${tab}`),
          apiFetch(`${API_URL}/reports/pc-stock?location=${tab}`)
        ]);
        setData(res.ok ? await res.json() : null);
        setPcRows(pcRes.ok ? await pcRes.json() : []);
      } catch { setData(null); setPcRows([]); }
      setLoading(false);
    })();
  }, [tab, date]);

  const rows = (data && data.rows) || [];
  const sum = (pick) => rows.reduce((s, r) => s + pick(r), 0);

  const renderTable = (title, cols) => (
    <div style={{marginTop:'1rem'}}>
      <h3 style={{marginBottom:'0.4rem'}}>{title}</h3>
      <div className="table-container">
        <table>
          <thead>
            <tr><th>Gas</th><th>Size</th>{cols.map(c => <th key={c.key}>{c.header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.gas_type}</td><td>{r.capacity}</td>
                {cols.map(c => <td key={c.key}>{c.get(r)}</td>)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{fontWeight:700}}>
              <td colSpan={2} style={{textAlign:'right'}}>TOTAL</td>
              {cols.map(c => <td key={c.key}>{sum(c.get)}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );

  // Print/PDF (Phase 9): both Filled and Empty tables in one popup-print document.
  const handlePrint = async () => {
    if (!rows.length) { showToast('No data to print', 'info'); return; }
    const bizName = await getBusinessName();
    const mkTable = (title, cols) => {
      const th = `<tr><th>Gas</th><th>Size</th>${cols.map(c => `<th>${esc(c.header)}</th>`).join('')}</tr>`;
      const tb = rows.map(r => `<tr><td>${esc(r.gas_type)}</td><td>${esc(r.capacity)}</td>${cols.map(c => `<td>${c.get(r)}</td>`).join('')}</tr>`).join('');
      const tf = `<tr class="tot"><td colspan="2" class="r">TOTAL</td>${cols.map(c => `<td>${sum(c.get)}</td>`).join('')}</tr>`;
      return `<h3>${esc(title)}</h3><table><thead>${th}</thead><tbody>${tb}</tbody><tfoot>${tf}</tfoot></table>`;
    };
    const fileName = getExportFileName('cylinder-stock', { pageName: 'Stock Summary', date });
    const html = `<!DOCTYPE html><html><head><title>${fileName}</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:Arial,Helvetica,sans-serif;font-size:11px;padding:20px;color:#1e293b}
      h2{font-size:16px;font-weight:700;margin-bottom:4px}
      h3{font-size:12px;font-weight:700;margin:16px 0 6px}
      .sub{font-size:10px;color:#64748b;margin-bottom:10px}
      table{border-collapse:collapse;width:100%}
      th{background:#1e293b;color:#fff;padding:6px 8px;text-align:left;font-size:10px;font-weight:600}
      td{padding:5px 8px;border-bottom:1px solid #e2e8f0;font-size:10px}
      .r{text-align:right}
      .tot td{font-weight:700;border-top:2px solid #1e293b}
      @page{margin:15mm}
    </style></head><body>
    <h2>${esc(bizName)} — Stock Summary · ${esc(data.location_label)} · ${formatDate(data.date)}</h2>
    <div class="sub">Generated: ${formatDateTime(new Date())}</div>
    ${mkTable('Filled Cylinder Stock', [
      { header: 'Opening', get: (r) => r.filled.opening },
      { header: data.filled_add_label || 'Add (Transfers In)', get: (r) => r.filled.add },
      { header: 'Issue (Given + Transfers Out)', get: (r) => r.filled.issue },
      { header: 'Closing', get: (r) => r.filled.closing }
    ])}
    ${mkTable('Empty Cylinder Stock', [
      { header: 'Opening', get: (r) => r.empty.opening },
      { header: 'Receive (Returns + Transfers In)', get: (r) => r.empty.receive },
      { header: data.empty_issue_label || 'Issue (Transfers Out)', get: (r) => r.empty.issue },
      { header: 'Closing', get: (r) => r.empty.closing }
    ])}
    <script>window.onload=function(){window.print();window.onafterprint=function(){window.close()}}<\/script>
    </body></html>`;
    const w = window.open('', '_blank', 'width=1000,height=700,scrollbars=yes');
    if (w) { w.document.write(html); w.document.close(); }
    else showToast('Please allow pop-ups to use Print / PDF.', 'info');
  };

  return (
    <div style={{marginTop:'0.5rem'}}>
      {/* Single row (Phase 10): location buttons · date · Print */}
      <div className="btn-group" style={{flexWrap:'wrap', alignItems:'center'}}>
        {LOCATIONS.map(l => (
          <button key={l} className={`btn ${tab === l ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(l)}>{LOCATION_LABELS[l]}</button>
        ))}
        <input type="date" className="form-control" style={{width:'auto', marginLeft:'auto'}}
          value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="btn btn-secondary" onClick={handlePrint} disabled={!rows.length}>🖨️ Print / PDF</button>
      </div>

      {loading || !data ? <Spinner label="Loading stock summary…" /> : rows.length === 0 ? (
        <EmptyState icon="📦" message="No stock or movements for this location/date" />
      ) : (
        <>
          {renderTable(`Filled Cylinder Stock — ${data.location_label} · ${formatDate(data.date)}`, [
            { key: 'o', header: 'Opening', get: (r) => r.filled.opening },
            // Chandisar: "Filled Today" from the daily Filling List (Phase 11); other sites: transfers in.
            { key: 'a', header: data.filled_add_label || 'Add (Transfers In)', get: (r) => r.filled.add },
            { key: 'i', header: 'Issue (Given + Transfers Out)', get: (r) => r.filled.issue },
            { key: 'c', header: 'Closing', get: (r) => r.filled.closing }
          ])}
          {renderTable(`Empty Cylinder Stock — ${data.location_label} · ${formatDate(data.date)}`, [
            { key: 'o', header: 'Opening', get: (r) => r.empty.opening },
            { key: 'r', header: 'Receive (Returns + Transfers In)', get: (r) => r.empty.receive },
            // Chandisar (Phase 12): empties leave the pool by being filled (Filling List) or
            // sent to filling vendors; other sites keep transfers-out.
            { key: 'i', header: data.empty_issue_label || 'Issue (Transfers Out)', get: (r) => r.empty.issue },
            { key: 'c', header: 'Closing', get: (r) => r.empty.closing }
          ])}
          {/* Per-location personal-cylinder stock (Phase 11) — separate from inventory. */}
          {pcRows.length > 0 && (
            <div style={{marginTop:'1rem'}}>
              <h3 style={{marginBottom:'0.4rem'}}>Personal Cylinders at {data.location_label}</h3>
              <div className="table-container">
                <table>
                  <thead><tr><th>Gas</th><th>Size</th><th>Quantity</th></tr></thead>
                  <tbody>
                    {pcRows.map((r, i) => (
                      <tr key={i}><td>{r.gas_type}</td><td>{r.capacity}</td><td><strong>{r.qty}</strong></td></tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{fontWeight:700}}>
                      <td colSpan={2} style={{textAlign:'right'}}>TOTAL</td>
                      <td>{pcRows.reduce((s, r) => s + r.qty, 0)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
          <p style={{color:'var(--text-muted)', fontSize:'0.78rem', marginTop:'0.75rem'}}>
            All figures derive automatically from bills and transfers ({data.filled_add_label === 'Filled Today' ? 'Chandisar’s "Filled Today" comes from the daily Filling List; ' : ''}the Empty table’s
            Issue row will later also reflect cylinders sent to filling vendors). A cylinder counts as "empty" while its latest
            movement is a customer return — this model will be refined after you use it in practice.
          </p>
        </>
      )}
    </div>
  );
}

// Report Table Component
export function ReportTable({ reportType, data }) {
  // Cap rendered rows (most lists are summary-sized, but ledger can be large).
  const [visible, more, open, setOpen] = useViewAll(data, 10);
  // Flat rows (same shape as Excel export) power the searchable "View All" modal.
  const reportRows = getReportRows(reportType, data);
  const reportCols = reportRows.length
    ? Object.keys(reportRows[0]).map(k => ({ header: k, cell: (r) => r[k] }))
    : [];
  const withToggle = (el) => (
    <>
      {el}
      {more && <ViewAllButton count={data.length} onClick={() => setOpen(true)} />}
      {open && (
        <ListModal
          title="Report"
          items={reportRows}
          columns={reportCols}
          searchKeys={reportCols.map(c => c.header)}
          searchPlaceholder="Search this report…"
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
  
  switch (reportType) {
    case 'over-limit':
      return withToggle(
        <table>
          <thead>
            <tr>
              <th>Customer Name</th>
              <th>Contact</th>
              <th>Cylinders Held</th>
              <th>Holding Limit</th>
              <th>Over By</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item, index) => (
              <tr key={item.customer_id || index} className="row-over-limit">
                <td>{item.company_name || 'N/A'}</td>
                <td>{item.phone_primary || 'N/A'}</td>
                <td>{item.cylinders_held || 0}</td>
                <td>{item.holding_limit || 0}</td>
                <td><strong>{(item.cylinders_held || 0) - (item.holding_limit || 0)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      );

    case 'outstanding':
      return withToggle(
        <table>
          <thead>
            <tr>
              <th>Customer Name</th>
              <th>Contact</th>
              <th>Outstanding Amount</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item, index) => (
              <tr key={item.customer_id || index}>
                <td>{item.company_name || 'N/A'}</td>
                <td>{item.phone_primary || 'N/A'}</td>
                <td>₹{(item.outstanding_amount || 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );

    case 'deposits':
      return withToggle(
        <table>
          <thead>
            <tr>
              <th>Customer Name</th>
              <th>Contact Person</th>
              <th>Contact</th>
              <th>Security Deposit</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item, index) => (
              <tr key={item.customer_id || index}>
                <td>{item.company_name || 'N/A'}</td>
                <td>{item.contact_person || 'N/A'}</td>
                <td>{item.phone_primary || 'N/A'}</td>
                <td>₹{(item.security_deposit || 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );

    default:
      return withToggle(
        <div>
          <div style={{padding: '0.75rem 1rem', backgroundColor: '#f8f9fa', borderRadius: '4px', marginBottom: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap'}}>
            <span><strong>Total Customers:</strong> {data.length}</span>
            <span><strong>Total Payment Due:</strong> ₹{data.reduce((s, i) => s + (i.bill_amount > 0 ? i.bill_amount : 0), 0).toFixed(2)}</span>
            <span><strong>Cylinders Out:</strong> {data.reduce((s, i) => s + (i.cylinder_hold || 0), 0)}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Sr. No.</th>
                <th>Customer Name</th>
                <th>Phone</th>
                <th>Payment Due</th>
                <th>Cylinder Hold</th>
                <th>Holding Limit</th>
                <th>Payment Status</th>
                <th>Cylinder Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item, index) => (
                <tr
                  key={item.customer_id || index}
                  className={item.status === 'OVER LIMIT' ? 'row-over-limit' : item.bill_amount < 0 ? 'row-credit' : ''}
                >
                  <td>{index + 1}</td>
                  <td>{item.company_name || 'N/A'}</td>
                  <td>{item.phone_primary || '-'}</td>
                  <td><strong>₹{(item.bill_amount || 0).toFixed(2)}</strong></td>
                  <td>{item.cylinder_hold || 0}</td>
                  <td>{item.is_filling_vendor ? 'Unlimited' : (item.holding_limit || 0)}</td>
                  <td>
                    {item.bill_amount > 0
                      ? <span className="badge badge-warning">Due</span>
                      : item.bill_amount < 0
                        ? <span className="badge badge-success">Credit</span>
                        : <span className="badge badge-success">Clear</span>
                    }
                  </td>
                  <td>
                    {item.status === 'OVER LIMIT'
                      ? <span className="badge badge-danger">OVER LIMIT</span>
                      : <span className="badge badge-success">OK</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}


// Payments Component
export function Payments({ onNavigate }) {
  const [payments, setPayments] = useState([]);
  const [payPagination, setPayPagination] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [payPage, setPayPage] = useState(1);

  useEffect(() => {
    fetchPayments();
    fetchCustomers();
  }, [payPage]);

  const fetchPayments = async () => {
    try {
      const response = await apiFetch(`${API_URL}/payments?page=${payPage}&limit=50`);
      const data = await response.json();
      setPayments(data.data || data);
      setPayPagination(data.pagination || null);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching payments:', error);
      setLoading(false);
    }
  };

  const fetchCustomers = async () => {
    try {
      const response = await apiFetch(`${API_URL}/customers?limit=200`);
      const result = await response.json();
      setCustomers(result.data || result);
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
  };

  const filteredPayments = payments.filter(p =>
    p.company_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.receipt_number.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const [payVisible, payMore, payOpen, setPayOpen] = useViewAll(filteredPayments, 10);

  const payColumns = [
    { header: 'Receipt No.', cell: (p) => <strong>{p.receipt_number}</strong> },
    { header: 'Challan No.', cell: (p) => p.challan_no || '-' },
    { header: 'Date', cell: (p) => formatDate(p.date) },
    { header: 'Customer', cell: (p) => p.company_name },
    { header: 'Bill No.', cell: (p) => p.bill_number || '-' },
    { header: 'Amount', cell: (p) => `₹${(p.amount_received || 0).toFixed(2)}` },
    { header: 'Discount', cell: (p) => `₹${(p.discount || 0).toFixed(2)}` },
    { header: 'Net', cell: (p) => `₹${((p.amount_received || 0) - (p.discount || 0)).toFixed(2)}` },
    { header: 'Mode', cell: (p) => paymentModeLabel(p.payment_mode) },
    { header: 'Cheque No. / UPI Txn ID', cell: (p) => paymentRef(p) },
    { header: 'Remarks', cell: (p) => p.remarks || '-' }
  ];

  if (loading) {
    return <Spinner label="Loading payments…" />;
  }

  return (
    <div>
      <div className="card">
        <h2>Payment Management</h2>
        
        <div className="btn-group">
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>
            💰 Record New Payment
          </button>
          {payments.length > 0 && (
            <button className="btn btn-secondary" onClick={() => exportToExcel(
              payments.map(p => ({
                'Receipt No.': p.receipt_number,
                'Challan No.': p.challan_no || '',
                'Date': formatDate(p.date),
                'Customer': p.company_name,
                'Bill No.': p.bill_number || '',
                'Amount Received': p.amount_received || 0,
                'Discount': p.discount || 0,
                'Net Amount': (p.amount_received || 0) - (p.discount || 0),
                'Payment Mode': paymentModeLabel(p.payment_mode),
                'Cheque No.': p.payment_mode === 'CHEQUE' ? (p.cheque_number || '') : '',
                'UPI Txn ID': (p.payment_mode === 'UPI' || p.payment_mode === 'ONLINE') ? (p.upi_transaction_id || '') : '',
                'Remarks': p.remarks || ''
              })), getExportFileName('payment-history'), 'Payments'
            )}>Export Excel</button>
          )}
        </div>

        {showForm && (
          <Modal title="Record New Payment" size="wide" onClose={() => setShowForm(false)}>
            <PaymentFormStandalone
              customers={customers}
              onSuccess={() => {
                setShowForm(false);
                fetchPayments();
              }}
              onCancel={() => setShowForm(false)}
            />
          </Modal>
        )}
      </div>

      <div className="card">
        <h3>Payment History</h3>
        
        <div className="search-bar sticky">
          <input
            type="text"
            placeholder="Search by customer name or receipt number..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="form-control"
          />
        </div>

        <div className="table-container" style={{marginTop: '1rem'}}>
          {filteredPayments.length === 0 ? (
            <EmptyState icon="💰" message="No payments found" hint={searchTerm ? 'Try a different search.' : 'Record your first payment above.'} />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Receipt No.</th>
                  <th>Challan No.</th>
                  <th>Date</th>
                  <th>Customer Name</th>
                  <th>Bill No.</th>
                  <th>Amount Received</th>
                  <th>Discount</th>
                  <th>Net Amount</th>
                  <th>Payment Mode</th>
                  <th>Cheque No. / UPI Txn ID</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {payVisible.map(payment => (
                  <tr key={payment._id}>
                    <td><strong>{payment.receipt_number}</strong></td>
                    <td>{payment.challan_no || '-'}</td>
                    <td>{formatDate(payment.date)}</td>
                    <td>{payment.company_name}</td>
                    <td>{payment.bill_number || '-'}</td>
                    <td>₹{(payment.amount_received || 0).toFixed(2)}</td>
                    <td>₹{(payment.discount || 0).toFixed(2)}</td>
                    <td><strong>₹{((payment.amount_received || 0) - (payment.discount || 0)).toFixed(2)}</strong></td>
                    <td>{paymentModeLabel(payment.payment_mode)}</td>
                    <td>{paymentRef(payment)}</td>
                    <td>{payment.remarks || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {payMore && <ViewAllButton count={filteredPayments.length} onClick={() => setPayOpen(true)} />}
          <Pagination pagination={payPagination} onPageChange={(p) => setPayPage(p)} />
        </div>

        {payOpen && (
          <ListModal title="Payment History" items={filteredPayments} columns={payColumns}
            searchKeys={['receipt_number', 'challan_no', 'company_name', (p) => p.amount_received, (p) => formatDate(p.date)]}
            searchPlaceholder="Search by receipt no., challan no., customer, amount, or date…"
            onClose={() => setPayOpen(false)} />
        )}

        <div style={{marginTop: '1rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px'}}>
          <h4>Summary</h4>
          <p><strong>Total Payments:</strong> {payPagination ? payPagination.total : filteredPayments.length}</p>
          <p><strong>Total Amount Received:</strong> ₹{filteredPayments.reduce((sum, p) => sum + (p.amount_received || 0), 0).toFixed(2)}</p>
          <p><strong>Total Discount Given:</strong> ₹{filteredPayments.reduce((sum, p) => sum + (p.discount || 0), 0).toFixed(2)}</p>
          <p><strong>Net Amount:</strong> ₹{filteredPayments.reduce((sum, p) => sum + (p.amount_received || 0) - (p.discount || 0), 0).toFixed(2)}</p>
        </div>
      </div>
    </div>
  );
}

// Standalone Payment Form Component (with customer selection)
export function PaymentFormStandalone({ customers, onSuccess, onCancel }) {
  const [formData, setFormData] = useState({
    customer_id: '',
    date: new Date().toISOString().split('T')[0],
    amount_received: '',
    discount: 0,
    payment_mode: 'CASH',
    cheque_number: '',
    upi_transaction_id: '',
    remarks: ''
  });
  const [errors, setErrors] = useState({});
  // Live-filtering combobox (Phase 11) — same pattern as the New Transaction page.
  const [custQuery, setCustQuery] = useState('');
  const [custOpen, setCustOpen] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!formData.customer_id) errs.customer_id = 'Please select a customer';
    if (!formData.date) errs.date = 'Date is required';
    if (!formData.amount_received || parseFloat(formData.amount_received) <= 0) errs.amount_received = 'Enter a valid amount';
    if (formData.payment_mode === 'CHEQUE' && !formData.cheque_number.trim()) errs.cheque_number = 'Cheque number is required';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    try {
      const response = await apiFetch(`${API_URL}/payments`, {
        method: 'POST',
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        const result = await response.json();
        showToast(`Payment recorded. Receipt No: ${result.receipt_number}`, 'success');
        onSuccess();
      } else {
        showToast(await apiErrorMessage(response, 'Error recording payment'));
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="form-group">
        <label>Select Customer *</label>
        <div style={{position:'relative'}}>
          <input
            type="text"
            className={`form-control ${errors.customer_id ? 'input-error' : ''}`}
            value={custQuery}
            placeholder="Type to search by name, contact person, or phone…"
            autoComplete="off"
            onChange={(e) => { setCustQuery(e.target.value); setCustOpen(true); if (formData.customer_id) setFormData({ ...formData, customer_id: '' }); }}
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
                  <div key={c._id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setFormData({ ...formData, customer_id: c._id }); setCustQuery(`${c.company_name}${c.phone_primary ? ' - ' + c.phone_primary : ''}`); setCustOpen(false); }}
                    style={{padding:'0.5rem 0.75rem', cursor:'pointer', fontSize:'0.85rem', borderBottom:'1px solid #f1f5f9'}}>
                    <strong>{c.company_name}</strong>
                    {c.contact_person ? ` · ${c.contact_person}` : ''} {c.phone_primary ? ` · ${c.phone_primary}` : ''}
                  </div>
                ));
              })()}
            </div>
          )}
        </div>
        {errors.customer_id && <div className="field-error">{errors.customer_id}</div>}
      </div>

      {(() => {
        const sel = customers.find(c => String(c._id) === String(formData.customer_id));
        if (!sel) return null;
        const pending = sel.current_bill_amount || 0;
        const isDue = pending > 0, isCredit = pending < 0;
        return (
          <div style={{
            display:'flex', justifyContent:'space-between', alignItems:'center',
            padding:'0.6rem 0.85rem', marginBottom:'0.85rem', borderRadius:'6px',
            background: isDue ? '#fef2f2' : isCredit ? '#f0fdf4' : '#f8fafc',
            border:`1px solid ${isDue ? '#fecaca' : isCredit ? '#bbf7d0' : 'var(--border)'}`
          }}>
            <span style={{fontSize:'0.85rem', color:'var(--text-2)'}}>Pending Amount</span>
            <strong style={{color: isDue ? '#dc2626' : isCredit ? '#16a34a' : 'var(--text-1)'}}>
              {isCredit ? `Credit ₹${Math.abs(pending).toFixed(2)}` : `₹${pending.toFixed(2)}`}
            </strong>
          </div>
        );
      })()}

      <PaymentFields formData={formData} setFormData={setFormData} errors={errors} />

      {formData.amount_received > 0 && (
        <div style={{padding: '0.75rem 1rem', backgroundColor: '#e7f3ff', borderRadius: '4px', margin: '0.25rem 0 0'}}>
          <p style={{margin: 0}}><strong>Net Amount: ₹{((parseFloat(formData.amount_received) || 0) - (parseFloat(formData.discount) || 0)).toFixed(2)}</strong></p>
        </div>
      )}

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">💾 Save Payment</button>
      </div>
    </form>
  );
}

// Cylinder Add / Edit Modal
export function CylinderModal({ cylinder, onClose, onSaved }) {
  const isEdit = !!cylinder;
  const [formData, setFormData] = useState({
    rotational_number: cylinder?.rotational_number || '',
    physical_number: cylinder?.physical_number || '',
    gas_type: cylinder?.gas_type || '',
    capacity: cylinder?.capacity || '',
    location: cylinder?.location || 'AT_PLANT_CHANDISAR',
    stock_state: cylinder?.stock_state || 'IN_STOCK',
    under_maintenance: cylinder?.under_maintenance || false
  });
  // Gas types and dependent capacities from the shared GAS_CAPACITIES map.
  const GAS_TYPES = GAS_TYPE_LIST;
  const CAPACITIES = formData.gas_type ? (GAS_CAPACITIES[formData.gas_type] || []) : [];
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // Gas type / capacity edits use the same gate as the maintenance toggle (Phase 9):
  // only while the cylinder is IN_STOCK at Chandisar Plant. Backend re-enforces.
  const typeLocked = isEdit && !(cylinder.location === 'AT_PLANT_CHANDISAR' && cylinder.stock_state === 'IN_STOCK');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!formData.rotational_number.trim() || !formData.gas_type.trim() || !formData.capacity.trim()) {
      setError('Rotational number, gas type, and capacity are all required');
      return;
    }

    setSaving(true);
    try {
      const url = isEdit ? `${API_URL}/cylinders/${cylinder._id}` : `${API_URL}/cylinders`;
      const method = isEdit ? 'PUT' : 'POST';
      const res = await apiFetch(url, { method, body: JSON.stringify(formData) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong');
      } else {
        onSaved();
      }
    } catch {
      setError('Network error');
    }
    setSaving(false);
  };

  const a11yRef = useModalA11y(onClose);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-wide" ref={a11yRef} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{isEdit ? '✏️ Edit Cylinder' : '➕ Add New Cylinder'}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <form onSubmit={handleSubmit}>
            <div className="form-row">
              <div className="form-group">
                <label>Rotational Number *</label>
                <input type="text" className="form-control" value={formData.rotational_number}
                  onChange={(e) => setFormData({...formData, rotational_number: e.target.value})}
                  placeholder="e.g. ROT-001" required />
              </div>
              <div className="form-group">
                <label>Physical Number</label>
                <input type="text" className="form-control" value={formData.physical_number}
                  onChange={(e) => setFormData({...formData, physical_number: e.target.value})}
                  placeholder="Stamped number (e.g. 482913)" />
                <small style={{color:'var(--text-muted)', fontSize:'0.78rem'}}>Optional — can be added later</small>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Gas Type *</label>
                <select className="form-control" value={formData.gas_type}
                  disabled={typeLocked}
                  title={typeLocked ? 'Gas type can only be changed while In Stock at Chandisar Plant' : undefined}
                  onChange={(e) => {
                    const gas = e.target.value;
                    // Reset capacity if it isn't valid for the newly chosen gas type.
                    const validCaps = GAS_CAPACITIES[gas] || [];
                    setFormData({
                      ...formData,
                      gas_type: gas,
                      capacity: validCaps.includes(formData.capacity) ? formData.capacity : ''
                    });
                  }} required>
                  <option value="">-- Select Gas Type --</option>
                  {GAS_TYPES.map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                  {formData.gas_type && !GAS_TYPES.includes(formData.gas_type) && (
                    <option value={formData.gas_type}>{formData.gas_type} (legacy)</option>
                  )}
                </select>
              </div>
              <div className="form-group">
                <label>Capacity *</label>
                <select className="form-control" value={formData.capacity}
                  onChange={(e) => setFormData({...formData, capacity: e.target.value})}
                  disabled={!formData.gas_type || typeLocked}
                  title={typeLocked ? 'Capacity can only be changed while In Stock at Chandisar Plant' : undefined}
                  required>
                  <option value="">{formData.gas_type ? '-- Select Capacity --' : '-- Select gas type first --'}</option>
                  {CAPACITIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                  {formData.capacity && !CAPACITIES.includes(formData.capacity) && (
                    <option value={formData.capacity}>{formData.capacity} (legacy)</option>
                  )}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Location</label>
                <select className="form-control" value={formData.location}
                  onChange={(e) => setFormData({...formData, location: e.target.value})}>
                  {LOCATIONS.map(l => <option key={l} value={l}>{LOCATION_LABELS[l]}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Stock State</label>
                <select className="form-control" value={formData.under_maintenance ? 'UNDER_MAINTENANCE' : formData.stock_state}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'UNDER_MAINTENANCE') {
                      setFormData({...formData, stock_state: 'IN_STOCK', under_maintenance: true, location: 'AT_PLANT_CHANDISAR'});
                    } else {
                      setFormData({...formData, stock_state: v, under_maintenance: false});
                    }
                  }}>
                  <option value="IN_STOCK">In Stock</option>
                  <option value="AT_CUSTOMER">At Customer</option>
                  <option value="UNDER_MAINTENANCE">Under Maintenance</option>
                </select>
                <small style={{color:'var(--text-muted)', fontSize:'0.78rem'}}>
                  Normally derived from bills — set manually only for onboarding corrections.
                </small>
              </div>
            </div>
            {error && <div className="alert alert-danger">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : (isEdit ? 'Update Cylinder' : 'Save Cylinder')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// Cylinder Inventory Page
export function CylinderInventory({ onViewCustomer }) {
  const [cylinders, setCylinders] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 300);
  const [cylPage, setCylPage] = useState(1);
  const [locFilters, setLocFilters] = useState([]);
  const [stateFilters, setStateFilters] = useState([]);
  const [modalCylinder, setModalCylinder] = useState(undefined);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [maintTarget, setMaintTarget] = useState(null);
  const [maintSaving, setMaintSaving] = useState(false);
  const [holders, setHolders] = useState({});
  const [counts, setCounts] = useState({ total: 0, inStock: 0, atCustomer: 0, maintenance: 0, byLocation: {} });

  const maintenanceView = stateFilters.includes('UNDER_MAINTENANCE');

  // Reset to page 1 when filters/search change
  useEffect(() => { setCylPage(1); setCylinders([]); setHasMore(true); }, [debouncedSearch, locFilters, stateFilters]);
  useEffect(() => { fetchCylinders(); }, [debouncedSearch, locFilters, stateFilters, cylPage]);
  useEffect(() => { fetchCounts(); fetchHolders(); }, []);

  const fetchCylinders = async () => {
    const isFirstPage = cylPage === 1;
    if (isFirstPage) setLoading(true); else setLoadingMore(true);
    try {
      let url = `${API_URL}/cylinders?page=${cylPage}&limit=50&`;
      if (debouncedSearch) url += `search=${encodeURIComponent(debouncedSearch)}&`;
      if (stateFilters.length) url += `state=${stateFilters.join(',')}&`;
      if (locFilters.length) url += `location=${locFilters.join(',')}`;
      const res = await apiFetch(url);
      const result = await res.json();
      const newData = result.data || result;
      setCylinders(prev => isFirstPage ? newData : [...prev, ...newData]);
      const pg = result.pagination;
      setHasMore(pg ? pg.page < pg.totalPages : false);
    } catch (error) {
      console.error('Error fetching cylinders:', error);
    }
    setLoading(false);
    setLoadingMore(false);
  };

  const loadMore = useCallback(() => {
    if (!loadingMore && hasMore) setCylPage(p => p + 1);
  }, [loadingMore, hasMore]);

  // Always reflects the full inventory (no search/stock filter), so the stat cards stay fixed.
  const fetchCounts = async () => {
    try {
      const res = await apiFetch(`${API_URL}/dashboard/cylinder-stock`);
      const stock = await res.json();
      setCounts({
        total: stock.totalCylinders || 0,
        inStock: stock.cylindersAtPlant || 0,
        atCustomer: stock.cylindersInRotation || 0,
        maintenance: stock.maintenanceCount || 0,
        byLocation: stock.byLocation || {}
      });
    } catch (error) {
      console.error('Error fetching cylinder counts:', error);
    }
  };

  // Current holder per at-customer cylinder — enables click-through to the customer's detail page.
  const fetchHolders = async () => {
    try {
      const res = await apiFetch(`${API_URL}/cylinders/in-rotation`);
      const list = await res.json();
      const map = {};
      (Array.isArray(list) ? list : []).forEach(c => {
        if (c.holder_id) map[c.rotational_number] = { holder_id: c.holder_id, holder_name: c.holder_name };
      });
      setHolders(map);
    } catch (e) { console.error('Error fetching holders:', e); }
  };

  // ── Filter-group toggles ──
  // Location: "All" clears the set; picking sites toggles them. While Under Maintenance is
  // selected, location is forced to Chandisar-only (maintenance exists only there).
  const toggleLocation = (loc) => {
    if (maintenanceView && loc !== 'AT_PLANT_CHANDISAR') return;
    setLocFilters(prev => prev.includes(loc) ? prev.filter(l => l !== loc) : [...prev, loc]);
  };
  const toggleState = (st) => {
    setStateFilters(prev => {
      const next = prev.includes(st) ? prev.filter(x => x !== st) : [...prev, st];
      if (next.includes('UNDER_MAINTENANCE')) setLocFilters(['AT_PLANT_CHANDISAR']);
      return next;
    });
  };

  // ── Maintenance toggle (backend re-enforces the Chandisar + IN_STOCK gate) ──
  const confirmMaintenance = async () => {
    if (!maintTarget) return;
    setMaintSaving(true);
    await setMaintenance(maintTarget.cyl, maintTarget.on);
    setMaintSaving(false);
    setMaintTarget(null);
  };

  const setMaintenance = async (cyl, on) => {
    try {
      const res = await apiFetch(`${API_URL}/cylinders/${cyl._id}/maintenance`, {
        method: 'POST', body: JSON.stringify({ on })
      });
      if (res.ok) {
        showToast(on ? `Cylinder ${cyl.rotational_number} moved to maintenance.` : `Cylinder ${cyl.rotational_number} returned to stock.`, 'success');
        refresh();
      } else showToast(await apiErrorMessage(res, 'Could not update maintenance state'));
    } catch { showToast('Could not update maintenance state'); }
  };

  const daysInMaintenance = (c) => {
    if (!c.maintenance_since) return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(c.maintenance_since).getTime()) / 86400000));
  };

  const refresh = () => { fetchCylinders(); fetchCounts(); fetchHolders(); };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`${API_URL}/cylinders/${deleteTarget._id}`, { method: 'DELETE' });
      if (res.ok) { showToast('Cylinder deleted.', 'success'); refresh(); }
      else showToast(await apiErrorMessage(res, 'Error deleting cylinder'));
    } catch { showToast('Error deleting cylinder'); }
    setDeleting(false);
    setDeleteTarget(null);
  };

  const [cylVisible, cylMore, cylOpen, setCylOpen] = useViewAll(cylinders, 10);

  const stockBadge = (c) => c.under_maintenance
    ? <span className="badge badge-danger">Under Maintenance</span>
    : c.stock_state === 'AT_CUSTOMER'
      ? <span className="badge badge-warning">At Customer</span>
      : <span className="badge badge-success">In Stock</span>;

  // Row-level maintenance action: 🔧 only for IN_STOCK @ Chandisar; ↩️ only while under maintenance.
  const maintenanceButton = (c) => {
    if (c.under_maintenance) {
      return (
        <button className="btn btn-secondary" title="Return to stock (back to In Stock at Chandisar)"
          style={{padding:'0.25rem 0.55rem'}}
          onClick={(e) => { e.stopPropagation(); setMaintTarget({ cyl: c, on: false }); }}>↩️</button>
      );
    }
    if (c.stock_state === 'IN_STOCK' && c.location === 'AT_PLANT_CHANDISAR') {
      return (
        <button className="btn btn-secondary" title="Move to maintenance"
          style={{padding:'0.25rem 0.55rem'}}
          onClick={(e) => { e.stopPropagation(); setMaintTarget({ cyl: c, on: true }); }}>🔧</button>
      );
    }
    // Invisible placeholder keeps every row's edit/delete pair left-aligned and evenly
    // spaced whether or not the maintenance toggle applies (Phase 7).
    return (
      <button className="btn btn-secondary" aria-hidden="true" tabIndex={-1}
        style={{padding:'0.25rem 0.55rem', visibility:'hidden'}}>🔧</button>
    );
  };

  const rowActions = (c) => (
    <div style={{display:'flex', gap:'0.4rem', justifyContent:'flex-start', whiteSpace:'nowrap'}}>
      {maintenanceButton(c)}
      <button className="btn btn-secondary" title="Edit"
        style={{padding:'0.25rem 0.55rem'}}
        onClick={(e) => { e.stopPropagation(); setCylOpen(false); setModalCylinder(c); }}>✏️</button>
      <button className="btn btn-danger" title="Delete"
        style={{padding:'0.25rem 0.55rem'}}
        onClick={(e) => { e.stopPropagation(); setDeleteTarget(c); }}>🗑️</button>
    </div>
  );

  // AT_CUSTOMER rows navigate to the holding customer's detail page (Currently Holding section).
  const rowClick = (c) => {
    if (c.stock_state !== 'AT_CUSTOMER' || !onViewCustomer) return;
    const h = holders[c.rotational_number];
    if (h && h.holder_id) onViewCustomer(String(h.holder_id));
    else showToast('No holding customer found for this cylinder.', 'info');
  };
  const isClickable = (c) => c.stock_state === 'AT_CUSTOMER' && !!onViewCustomer;

  // Holder name for AT_CUSTOMER rows (Phase 11) — same data source as the hover tooltip.
  const holderNameOf = (c) => c.stock_state === 'AT_CUSTOMER'
    ? (holders[c.rotational_number]?.holder_name || '—') : '';

  const cylColumns = [
    { header: 'Sr. No.', cell: (c, i) => i + 1 },
    { header: 'Rotational No.', cell: (c) => <strong>{c.rotational_number}</strong> },
    { header: 'Physical No.', cell: (c) => c.physical_number || '—' },
    { header: 'Gas Type', cell: (c) => c.gas_type },
    { header: 'Capacity', cell: (c) => c.capacity },
    { header: 'Holding Customer', cell: holderNameOf },
    { header: 'Location', cell: (c) => locationText(c.location) },
    { header: 'Stock', cell: stockBadge },
    ...(maintenanceView ? [{ header: 'Days in Maintenance', cell: (c) => c.under_maintenance ? daysInMaintenance(c) : '—' }] : []),
    { header: 'Action', cell: rowActions }
  ];

  return (
    <div>
      <div className="card">
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'0.75rem'}}>
          <h2 style={{margin:0, border:'none', padding:0}}>Cylinder Inventory</h2>
          <div className="btn-group" style={{margin:0}}>
            <button className="btn btn-secondary" onClick={() => exportToExcel(
              cylinders.map((c,i) => ({
                'Sr.': i+1,
                'Rotational No.': c.rotational_number,
                'Physical No.': c.physical_number,
                'Gas Type': c.gas_type,
                'Capacity': c.capacity,
                'Holding Customer': c.stock_state === 'AT_CUSTOMER' ? (holders[c.rotational_number]?.holder_name || '') : '',
                'Location': locationText(c.location),
                'State': cylinderStateText(c),
                'Days in Maintenance': c.under_maintenance ? Math.max(0, Math.floor((Date.now() - new Date(c.maintenance_since).getTime()) / 86400000)) : ''
              })), getExportFileName('cylinder-inventory'), 'Cylinders'
            )}>Export Excel</button>
            <button className="btn btn-primary" onClick={() => setModalCylinder(null)}>+ Add New Cylinder</button>
          </div>
        </div>

        <div className="stats-grid" style={{marginTop:'1.25rem', marginBottom:0}}>
          <div className="stat-card blue">
            <div className="stat-icon">🛢️</div>
            <div className="stat-body"><h3>Total Cylinders</h3><div className="value">{counts.total}</div></div>
          </div>
          <div className="stat-card green">
            <div className="stat-icon">🏭</div>
            <div className="stat-body"><h3>In Stock</h3><div className="value">{counts.inStock}</div></div>
          </div>
          <div className="stat-card orange">
            <div className="stat-icon">🔄</div>
            <div className="stat-body"><h3>At Customer</h3><div className="value">{counts.atCustomer}</div></div>
          </div>
          <div className="stat-card red">
            <div className="stat-icon">🔧</div>
            <div className="stat-body"><h3>Under Maintenance</h3><div className="value">{counts.maintenance}</div></div>
          </div>
        </div>
        <div style={{marginTop:'0.75rem', fontSize:'0.85rem', color:'var(--text-muted)'}}>
          In stock by site: {LOCATIONS.map(l => `${LOCATION_LABELS[l]}: ${counts.byLocation[l] || 0}`).join(' · ')}
        </div>
      </div>

      <div className="card">
        <div className="search-bar sticky">
          <input
            type="text"
            placeholder="Search by rotational no., physical no., or gas type..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="form-control"
          />
        </div>

        {/* Two independent multi-select filter groups. "All" = empty selection. */}
        <div style={{display:'flex', gap:'1.5rem', flexWrap:'wrap', alignItems:'center'}}>
          <div className="btn-group" style={{margin:0, alignItems:'center'}}>
            <span style={{fontSize:'0.78rem', color:'var(--text-muted)', marginRight:'0.35rem'}}>Location:</span>
            <button className={`btn ${locFilters.length === 0 ? 'btn-primary' : 'btn-secondary'}`}
              disabled={maintenanceView}
              title={maintenanceView ? 'Locked to Chandisar while Under Maintenance is selected' : undefined}
              onClick={() => setLocFilters([])}>All</button>
            {LOCATIONS.map(l => {
              const disabled = maintenanceView && l !== 'AT_PLANT_CHANDISAR';
              return (
                <button key={l}
                  className={`btn ${locFilters.includes(l) ? 'btn-primary' : 'btn-secondary'}`}
                  disabled={disabled}
                  title={disabled ? 'Maintenance only exists at Chandisar Plant' : undefined}
                  style={disabled ? {opacity:0.5, cursor:'not-allowed'} : {}}
                  onClick={() => toggleLocation(l)}>{LOCATION_LABELS[l]}</button>
              );
            })}
          </div>
          <div className="btn-group" style={{margin:0, alignItems:'center'}}>
            <span style={{fontSize:'0.78rem', color:'var(--text-muted)', marginRight:'0.35rem'}}>State:</span>
            <button className={`btn ${stateFilters.includes('IN_STOCK') ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => toggleState('IN_STOCK')}>In Stock</button>
            <button className={`btn ${stateFilters.includes('AT_CUSTOMER') ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => toggleState('AT_CUSTOMER')}>At Customer</button>
            <button className={`btn ${stateFilters.includes('UNDER_MAINTENANCE') ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => toggleState('UNDER_MAINTENANCE')}>🔧 Under Maintenance</button>
          </div>
        </div>

        {loading ? (
          <Spinner label="Loading cylinders…" />
        ) : (
          <div className="table-container" style={{marginTop:'1rem'}}>
            {cylinders.length === 0 ? (
              <EmptyState icon="🛢️" message="No cylinders found" hint={searchTerm || stateFilters.length || locFilters.length ? 'Try clearing the filters.' : 'Click “Add New Cylinder” to get started.'} />
            ) : (
              <>
              <table>
                <thead>
                  <tr>
                    <th>Sr.</th>
                    <th>Rotational No.</th>
                    <th>Physical No.</th>
                    <th>Gas Type</th>
                    <th>Capacity</th>
                    <th>Holding Customer</th>
                    <th>Location</th>
                    <th>Stock</th>
                    {maintenanceView && <th>Days in Maintenance</th>}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {cylVisible.map((c, index) => (
                    <tr key={c._id}
                      style={isClickable(c) ? {cursor:'pointer'} : {}}
                      title={isClickable(c) ? `View ${holders[c.rotational_number]?.holder_name || 'holding customer'}` : undefined}
                      onClick={() => rowClick(c)}>
                      <td>{index + 1}</td>
                      <td><strong>{c.rotational_number}</strong></td>
                      <td>{c.physical_number || '—'}</td>
                      <td>{c.gas_type}</td>
                      <td>{c.capacity}</td>
                      <td>{holderNameOf(c)}</td>
                      <td>{locationText(c.location)}</td>
                      <td>{stockBadge(c)}</td>
                      {maintenanceView && <td>{c.under_maintenance ? daysInMaintenance(c) : '—'}</td>}
                      <td onClick={(e) => e.stopPropagation()}>
                        <div style={{display:'flex', gap:'0.4rem', justifyContent:'flex-start', whiteSpace:'nowrap'}}>
                          {maintenanceButton(c)}
                          <button className="btn btn-secondary" title="Edit"
                            style={{padding:'0.3rem 0.6rem'}}
                            onClick={() => setModalCylinder(c)}>✏️</button>
                          <button className="btn btn-danger" title="Delete"
                            style={{padding:'0.3rem 0.6rem'}}
                            onClick={() => setDeleteTarget(c)}>🗑️</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {cylMore && <ViewAllButton count={cylinders.length} onClick={() => setCylOpen(true)} />}
              <InfiniteScroll hasMore={hasMore} loading={loadingMore} onLoadMore={loadMore} />
              </>
            )}
          </div>
        )}
      </div>

      {cylOpen && (
        <ListModal title="Cylinder Inventory" items={cylinders} columns={cylColumns}
          searchKeys={['rotational_number', 'physical_number', 'gas_type', 'capacity']}
          searchPlaceholder="Search by rotational no., physical no., gas type, or capacity…"
          initialSearch={searchTerm}
          rowTitle={(c) => isClickable(c) ? `View ${holders[c.rotational_number]?.holder_name || 'holding customer'}` : undefined}
          onRowClick={(c) => { if (isClickable(c)) { setCylOpen(false); rowClick(c); } }}
          onClose={() => setCylOpen(false)} />
      )}

      {modalCylinder !== undefined && (
        <CylinderModal
          cylinder={modalCylinder}
          onClose={() => setModalCylinder(undefined)}
          onSaved={() => { setModalCylinder(undefined); refresh(); }}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Delete cylinder?"
          message={`Delete cylinder ${deleteTarget.rotational_number}? This cannot be undone.`}
          confirmLabel="Delete"
          loading={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {maintTarget && (
        <ConfirmModal
          title={maintTarget.on ? 'Move to maintenance?' : 'Return to stock?'}
          message={maintTarget.on
            ? `Move cylinder ${maintTarget.cyl.rotational_number} to Under Maintenance?`
            : `Return cylinder ${maintTarget.cyl.rotational_number} to In Stock at Chandisar Plant?`}
          confirmLabel={maintTarget.on ? 'Move to Maintenance' : 'Return to Stock'}
          loading={maintSaving}
          onConfirm={confirmMaintenance}
          onCancel={() => setMaintTarget(null)}
        />
      )}
    </div>
  );
}

// ─── Transaction History Page ───
// All bills/transactions across every customer in one place. Rows open a full bill detail modal.

// Colored direction/type label: FILLED(GIVEN)=blue, EMPTY(RECEIVED)=red, SWAP=orange.
// DB value stays GIVEN/RECEIVED; only the displayed text is Filled/Empty (see directionText).
// Shared transaction-type badge (Phase 14): one consistent icon + label + color set used
// everywhere a transaction type is displayed (history pages, detail modal, success screen).
// Phase 15 palette: FILLED Blue #2563EB · EMPTY Red #EF233C · SWAP Purple #9333EA · TRANSFER Green #16A34A
const TXN_TYPE_STYLES = {
  GIVEN:    { icon: '⬆', label: 'FILLED',   bg: '#dbeafe', fg: '#2563EB' },
  RECEIVED: { icon: '⬇', label: 'EMPTY',    bg: '#fee2e2', fg: '#EF233C' },
  SWAP:     { icon: '🔄', label: 'SWAP',     bg: '#f3e8ff', fg: '#9333EA' },
  TRANSFER: { icon: '⇄', label: 'TRANSFER', bg: '#dcfce7', fg: '#16A34A' }
};
export function directionLabel(d, opts = {}) {
  let s = TXN_TYPE_STYLES[d];
  // Filling-vendor bills (Phase 16): GIVEN = sent for filling → cylinders LEAVE empty
  // (EMPTY colors, outbound ⬆); RECEIVED = received back filled → cylinders RETURN full
  // (FILLED colors, inbound ⬇). Inverse of the normal-customer semantics above.
  if (opts.vendor && d === 'GIVEN') {
    s = { icon: '⬆', label: 'EMPTY (SENT)', bg: TXN_TYPE_STYLES.RECEIVED.bg, fg: TXN_TYPE_STYLES.RECEIVED.fg };
  } else if (opts.vendor && d === 'RECEIVED') {
    s = { icon: '⬇', label: 'FILLED (BACK)', bg: TXN_TYPE_STYLES.GIVEN.bg, fg: TXN_TYPE_STYLES.GIVEN.fg };
  }
  if (!s) return <span>{directionText(d)}</span>;
  return (
    <span style={{display:'inline-flex', alignItems:'center', gap:'0.3rem', padding:'0.1rem 0.55rem',
      borderRadius:'999px', fontSize:'0.72rem', fontWeight:700, background:s.bg, color:s.fg, whiteSpace:'nowrap'}}>
      {s.icon} {s.label}
    </span>
  );
}

export function TransactionHistory() {
  const [bills, setBills] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [billPage, setBillPage] = useState(1);
  const [dateFilter, setDateFilter] = useState(() => {
    const x = new Date();
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  });
  const [locFilter, setLocFilter] = useState('');
  const [detailBillId, setDetailBillId] = useState(null);
  const [editBillId, setEditBillId] = useState(null);
  const [editAuth, setEditAuth] = useState(null);

  useEffect(() => { setBillPage(1); setBills([]); setHasMore(true); }, [dateFilter]);
  useEffect(() => { load(); }, [billPage, dateFilter]);
  const load = async () => {
    const isFirstPage = billPage === 1;
    if (isFirstPage) setLoading(true); else setLoadingMore(true);
    try {
      let billUrl = `${API_URL}/bills?page=${billPage}&limit=50`;
      if (dateFilter) billUrl += `&date=${dateFilter}`;
      const fetches = [apiFetch(billUrl)];
      if (isFirstPage) fetches.push(apiFetch(`${API_URL}/payments?limit=200`));
      const results = await Promise.all(fetches);
      const bData = await results[0].json();
      const newBills = bData.data || bData;
      setBills(prev => isFirstPage ? newBills : [...prev, ...newBills]);
      const pg = bData.pagination;
      setHasMore(pg ? pg.page < pg.totalPages : false);
      if (isFirstPage && results[1]) {
        const pData = await results[1].json();
        setPayments(pData.data || pData);
      }
    } catch (e) {
      console.error('Error loading transaction history:', e);
    }
    setLoading(false);
    setLoadingMore(false);
  };

  const loadMoreBills = useCallback(() => {
    if (!loadingMore && hasMore) setBillPage(p => p + 1);
  }, [loadingMore, hasMore]);

  const rows = bills.map(b => {
    const isTransfer = b.transaction_category === 'INTERNAL_TRANSFER';
    return {
      _id: b._id,
      date: b.bill_date,
      bill_number: b.bill_number,
      challan_no: b.challan_no || '',
      company_name: isTransfer
        ? `Internal Transfer: ${locationText(b.from_location)} → ${locationText(b.to_location)}`
        : (b.company_name || ''),
      transaction_type: b.transaction_type,
      cylinders: isTransfer
        ? (b.line_items || []).length
        : (b.total_given_qty || 0) + (b.total_received_qty || 0),
      amount: b.total_bill_amount || 0,
      // Transfers belong to both endpoints for the location filter; customer bills to their site.
      locations: isTransfer ? [b.from_location, b.to_location] : [b.location],
      edited: !!(b.edit_history && b.edit_history.length)  // "Updated" badge (item 11)
    };
  });

  // Local YYYY-MM-DD (matches the <input type="date"> value) — never UTC.
  const localYMD = (d) => {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  };

  const term = searchTerm.trim().toLowerCase();
  const filtered = rows.filter(r => {
    if (dateFilter && localYMD(r.date) !== dateFilter) return false;
    if (locFilter && !r.locations.includes(locFilter)) return false;
    if (!term) return true;
    return [r.bill_number, r.challan_no, r.company_name, formatDate(r.date), directionText(r.transaction_type)]
      .some(v => String(v || '').toLowerCase().includes(term));
  });

  // Grouped by calendar day (rows arrive newest-first from the API) — no truncation (Phase 8).
  const groups = [];
  filtered.forEach((r, i) => {
    r.sr = i + 1; // continuous Sr. No. across day groups (Phase 9)
    const key = localYMD(r.date);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(r);
    else groups.push({ key, label: formatDate(r.date), rows: [r] });
  });
  // With a single-day date filter the group header is redundant — hide it (Phase 9);
  // it still shows when browsing all dates, and in the View All popup.
  const showGroupHeaders = !dateFilter;

  const [open, setOpen] = useState(false);

  // Live bill-number refresh (Phase 9): patch the row in place after an inline rename —
  // no refetch needed, and no "Updated" badge (bill-number edits skip edit_history).
  const onBillNumberChanged = (billId, newNumber) => {
    setBills(prev => prev.map(b => b._id === billId ? { ...b, bill_number: newNumber } : b));
  };

  const columns = [
    { header: 'Sr. No.', cell: (r, i) => i + 1 },
    { header: 'Date', cell: (r) => formatDate(r.date) },
    { header: 'Bill No.', cell: (r) => <><strong>{r.bill_number}</strong>{r.edited && <span className="badge badge-warning" style={{marginLeft:'0.35rem', fontSize:'0.62rem'}}>Updated</span>}</> },
    { header: 'Challan No.', cell: (r) => r.challan_no || '-' },
    { header: 'Customer', cell: (r) => r.company_name },
    { header: 'Type', cell: (r) => directionLabel(r.transaction_type) },
    { header: 'Cylinders', cell: (r) => r.cylinders },
    { header: 'Total Amount', cell: (r) => `₹${r.amount.toFixed(2)}` }
  ];

  const exportRows = () => filtered.map((r, i) => ({
    'Sr.': i + 1,
    'Date': formatDate(r.date),
    'Bill No.': r.bill_number,
    'Challan No.': r.challan_no,
    'Customer': r.company_name,
    'Transaction Type': directionText(r.transaction_type),
    'Cylinders': r.cylinders,
    'Total Amount': r.amount
  }));

  const handleExport = () => exportToExcel(exportRows(), getExportFileName('transaction-history'), 'Transactions');

  // Prints exactly the current filtered view (date + location + search) — Phase 8.
  const handlePrintList = () => {
    const bits = ['Transaction History'];
    if (dateFilter) bits.push(formatDate(dateFilter));
    if (locFilter) bits.push(LOCATION_LABELS[locFilter]);
    printReportPopup(bits.join(' — '), exportRows(), getExportFileName('transaction-history', { date: dateFilter || undefined }));
  };

  if (loading) return <Spinner label="Loading transactions…" />;

  return (
    <div>
      <div className="card">
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'0.75rem'}}>
          <h2 style={{margin:0, border:'none', padding:0}}>Transaction History</h2>
          <div className="btn-group" style={{margin:0}}>
            <button className="btn btn-secondary" onClick={handlePrintList} disabled={!filtered.length}>🖨️ Print / PDF</button>
            <button className="btn btn-secondary" onClick={handleExport} disabled={!filtered.length}>Export Excel</button>
            <button className="btn btn-secondary" onClick={() => setOpen(true)} disabled={!rows.length}>View All ({rows.length})</button>
          </div>
        </div>
        <p style={{color:'var(--text-muted)', fontSize:'0.82rem', marginTop:'0.5rem'}}>
          All bills across every customer, grouped by date. Click a row to view the full transaction, its cylinders, and its payment history.
        </p>

        <div className="search-bar sticky" style={{marginTop:'0.75rem'}}>
          <input type="text" className="form-control"
            placeholder="Search by bill no., challan no., customer, date, or type…"
            value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>

        {/* Location + date filters (Phase 8) — combinable; Print/PDF prints exactly this view. */}
        <div style={{display:'flex', gap:'1rem', flexWrap:'wrap', alignItems:'center', marginTop:'0.5rem'}}>
          <div className="btn-group" style={{margin:0}}>
            <button className={`btn ${locFilter === '' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setLocFilter('')}>All Places</button>
            {LOCATIONS.map(l => (
              <button key={l} className={`btn ${locFilter === l ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setLocFilter(locFilter === l ? '' : l)}>{LOCATION_LABELS[l]}</button>
            ))}
          </div>
          <div style={{display:'flex', gap:'0.4rem', alignItems:'center'}}>
            <input type="date" className="form-control" style={{width:'auto'}}
              value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
            {dateFilter && (
              <button className="btn btn-secondary" onClick={() => setDateFilter('')}>✕ Clear date</button>
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon="🧾" message="No transactions found" hint={searchTerm || dateFilter || locFilter ? 'Try clearing the search or filters.' : 'Record a transaction to see it here.'} />
        ) : (
          <div className="table-container" style={{marginTop:'1rem'}}>
            <table>
              <thead>
                <tr>
                  <th>Sr. No.</th><th>Date</th><th>Bill No.</th><th>Challan No.</th><th>Customer Name</th>
                  <th>Type</th><th>Cylinders</th><th>Total Amount</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <React.Fragment key={g.key}>
                    {showGroupHeaders && (
                    <tr>
                      <td colSpan={8} style={{background:'var(--bg, #f1f5f9)', fontWeight:700, fontSize:'0.8rem', padding:'0.35rem 0.75rem'}}>
                        📅 {g.label} — {g.rows.length} transaction{g.rows.length === 1 ? '' : 's'}
                      </td>
                    </tr>
                    )}
                    {g.rows.map((r) => (
                      <tr key={r._id} style={{cursor:'pointer'}} onClick={() => setDetailBillId(r._id)}>
                        <td>{r.sr}</td>
                        <td>{formatDate(r.date)}</td>
                        <td><strong>{r.bill_number}</strong>{r.edited && <span className="badge badge-warning" style={{marginLeft:'0.35rem', fontSize:'0.62rem'}}>Updated</span>}</td>
                        <td>{r.challan_no || '-'}</td>
                        <td>{r.company_name}</td>
                        <td>{directionLabel(r.transaction_type)}</td>
                        <td>{r.cylinders}</td>
                        <td>₹{r.amount.toFixed(2)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            <InfiniteScroll hasMore={hasMore} loading={loadingMore} onLoadMore={loadMoreBills} />
          </div>
        )}
      </div>

      {open && (
        <ListModal title="Transaction History" items={rows} columns={columns}
          groupBy={(r) => formatDate(r.date)}
          searchKeys={['bill_number', 'challan_no', 'company_name', 'transaction_type', 'status', (r) => formatDate(r.date)]}
          searchPlaceholder="Search by bill no., challan no., customer, date, type, or payment status…"
          onRowClick={(r) => { setOpen(false); setDetailBillId(r._id); }}
          onClose={() => setOpen(false)} />
      )}

      {detailBillId && !editBillId && (
        <TransactionDetailModal billId={detailBillId} payments={payments}
          onClose={() => setDetailBillId(null)}
          onEdit={(auth) => { setEditAuth(auth); setEditBillId(detailBillId); }}
          onBillNumberChanged={onBillNumberChanged}
          onDeleted={() => { setDetailBillId(null); load(); }} />
      )}

      {editBillId && (
        <EditBillModal billId={editBillId} stepUpToken={editAuth?.step_up_token || ''}
          onClose={() => setEditBillId(null)}
          onSaved={() => { const id = editBillId; setEditBillId(null); load(); setDetailBillId(id); }} />
      )}
    </div>
  );
}

// Full bill detail modal: summary + cylinders + payment history, with Print/PDF and Excel export.
// Edit/Delete respect the 3-day creation window (backend re-enforces); bill_number stays
// editable forever via the inline "Edit Bill No." control shown once the bill is locked.
export function TransactionDetailModal({ billId, payments, onClose, onEdit, onDeleted, onBillNumberChanged }) {
  const [bill, setBill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editNumber, setEditNumber] = useState(null); // string while the bill-no editor is open
  // Step-up gate (Phase 18): 'edit' | 'delete' while the approval modal is open. Verification
  // authorizes WHO can act — the 3-day lock above stays the hard outer boundary either way.
  const [stepUpFor, setStepUpFor] = useState(null);

  const locked = !!(bill && bill.createdAt && (Date.now() - new Date(bill.createdAt).getTime()) > 3 * 86400000);

  const handleDelete = async (stepUpToken) => {
    setDeleting(true);
    try {
      const res = await apiFetch(`${API_URL}/bills/${billId}`, {
        method: 'DELETE',
        headers: stepUpToken ? { 'x-step-up-token': stepUpToken } : {}
      });
      if (res.ok) {
        showToast('Bill deleted. Cylinders reverted to their previous state.', 'success');
        onDeleted && onDeleted();
      } else {
        showToast(await apiErrorMessage(res, 'Could not delete bill'));
      }
    } catch { showToast('Could not delete bill'); }
    setDeleting(false);
    setConfirmDelete(false);
  };

  const saveBillNumber = async () => {
    const value = String(editNumber || '').trim();
    if (!value) { showToast('Bill number cannot be empty'); return; }
    try {
      // bill_number-only edit: line_items omitted → backend keeps everything else untouched.
      const res = await apiFetch(`${API_URL}/bills/${billId}`, {
        method: 'PUT',
        body: JSON.stringify({ bill_number: value, logEdit: true })
      });
      if (res.ok) {
        showToast('Bill number updated.', 'success');
        setBill(prev => ({ ...prev, bill_number: value }));
        setEditNumber(null);
        // Live refresh (Phase 9): let the opener list patch its row immediately.
        if (onBillNumberChanged) onBillNumberChanged(billId, value);
      } else {
        showToast(await apiErrorMessage(res, 'Could not update bill number'));
      }
    } catch { showToast('Could not update bill number'); }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await apiFetch(`${API_URL}/bills/${billId}`);
        const data = await res.json();
        if (active) { setBill(res.ok ? data : null); setLoading(false); }
      } catch { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [billId]);

  // Payments linked to this bill (by bill number).
  const billPayments = (bill && payments) ? payments.filter(p => p.bill_number && p.bill_number === bill.bill_number) : [];

  // Transform the API bill into the shape printSavedBill expects, and print.
  const handlePrint = () => {
    if (!bill) return;
    printSavedBill({
      bill_number: bill.bill_number,
      bill_date: bill.bill_date,
      transaction_type: bill.transaction_type,
      customer_name: bill.company_name,
      customer_address: bill.address,
      customer_gst: bill.gst_number || '',
      challan_no: bill.challan_no,
      amount: bill.total_bill_amount || 0,
      lines: (bill.line_items || []).map(li => ({
        direction: li.direction, gas: li.gas_type_name, size: li.size_label,
        serials: li.serial_number ? [li.serial_number] : [],   // personal-only lines have no serial
        qty: li.quantity || 0, rate: li.rate || 0, amount: li.amount || 0,
        personalCyl: li.direction === 'GIVEN' ? (li.personalCylindersOut || 0) : (li.personalCylindersIn || 0)
      }))
    });
  };

  const handleExport = () => {
    if (!bill) return;
    const rows = (bill.line_items || []).map((li, i) => {
      const p = li.direction === 'GIVEN' ? (li.personalCylindersOut || 0) : (li.personalCylindersIn || 0);
      return {
        'Sr.': i + 1, 'Direction': directionText(li.direction), 'Gas Type': li.gas_type_name, 'Size': li.size_label,
        'Cylinder': li.serial_number, 'Qty': li.serial_number ? (li.quantity || 1) : 0, 'Personal Cyl.': p,
        'Rate': li.rate || 0, 'Amount': li.amount || 0
      };
    });
    exportToExcel(rows, getExportFileName('bill', { customerName: bill.company_name, billNo: bill.bill_number, date: bill.bill_date }), 'Bill');
  };

  const wasEdited = !!(bill && bill.edit_history && bill.edit_history.length);

  return (
    <Modal title={bill ? `Transaction ${bill.bill_number}${wasEdited ? '  •  Updated' : ''}` : 'Transaction'} size="wide" onClose={onClose}>
      {loading ? (
        <Spinner label="Loading transaction…" />
      ) : !bill ? (
        <EmptyState icon="⚠️" message="Could not load this transaction" />
      ) : (
        <>
          {/* Bill number is editable in place (Phase 8) — saved via a bill_number-only update
              that is quietly recorded in bill_number_history and never marks the bill "Updated". */}
          <div style={{display:'flex', gap:'0.5rem', alignItems:'center', flexWrap:'wrap', marginBottom:'0.75rem'}}>
            <span style={{fontSize:'0.72rem', color:'var(--text-muted)'}}>Bill No.</span>
            {editNumber === null ? (
              <>
                <strong style={{fontSize:'1.05rem'}}>{bill.bill_number}</strong>
                <button type="button" className="btn btn-secondary" style={{padding:'0.2rem 0.55rem', fontSize:'0.78rem'}}
                  title="Edit bill number" onClick={() => setEditNumber(bill.bill_number || '')}>✏️</button>
              </>
            ) : (
              <>
                <input className="form-control" style={{maxWidth:'220px'}} value={editNumber} autoFocus
                  onChange={(e) => setEditNumber(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveBillNumber(); if (e.key === 'Escape') setEditNumber(null); }} />
                <button type="button" className="btn btn-primary" onClick={saveBillNumber}>Save</button>
                <button type="button" className="btn btn-secondary" onClick={() => setEditNumber(null)}>Cancel</button>
              </>
            )}
          </div>

          <div className="form-row cols-3" style={{marginBottom:'0.5rem'}}>
            <div><div style={{fontSize:'0.72rem', color:'var(--text-muted)'}}>Date</div><div>{formatDate(bill.bill_date)}</div></div>
            <div><div style={{fontSize:'0.72rem', color:'var(--text-muted)'}}>Customer</div><div>{bill.company_name}</div></div>
            <div><div style={{fontSize:'0.72rem', color:'var(--text-muted)'}}>Type</div><div>{directionLabel(bill.transaction_type)}</div></div>
            <div>
              <div style={{fontSize:'0.72rem', color:'var(--text-muted)'}}>Location</div>
              <div>{bill.transaction_category === 'INTERNAL_TRANSFER'
                ? `${locationText(bill.from_location)} → ${locationText(bill.to_location)}`
                : locationText(bill.location)}</div>
            </div>
            <div><div style={{fontSize:'0.72rem', color:'var(--text-muted)'}}>Challan No.</div><div>{bill.challan_no || '-'}</div></div>
            <div><div style={{fontSize:'0.72rem', color:'var(--text-muted)'}}>Total Amount</div><div><strong>₹{(bill.total_bill_amount || 0).toFixed(2)}</strong></div></div>
          </div>

          <h4 style={{margin:'1rem 0 0.4rem'}}>Cylinders</h4>
          <div className="table-container">
            <table>
              <thead><tr><th>Direction</th><th>Gas Type</th><th>Size</th><th>Cylinder</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
              <tbody>
                {(bill.line_items || []).map((li, i) => {
                  // Same rendering rule as the success screen: personal counts ride on the line —
                  // Qty = "inventory + N personal", Amount (stored) = rate × (inventory + personal out).
                  const p = li.direction === 'GIVEN' ? (li.personalCylindersOut || 0) : (li.personalCylindersIn || 0);
                  const inv = li.serial_number ? (li.quantity || 1) : 0;
                  return (
                  <tr key={i}>
                    <td>{directionLabel(li.direction)}</td><td>{li.gas_type_name}</td><td>{li.size_label}</td>
                    <td>{li.serial_number}
                      {p > 0 && <span style={{color:'var(--text-2)'}}>{li.serial_number ? ', ' : ''}(Personal Cyl. ×{p})</span>}
                    </td>
                    <td>{p > 0 ? `${inv} + ${p} personal` : inv}</td>
                    <td>₹{(li.rate || 0).toFixed(2)}</td><td>₹{(li.amount || 0).toFixed(2)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h4 style={{margin:'1rem 0 0.4rem'}}>Payment History</h4>
          {billPayments.length === 0 ? (
            <p style={{color:'var(--text-muted)', fontSize:'0.85rem'}}>No payments linked to this transaction.</p>
          ) : (
            <div className="table-container">
              <table>
                <thead><tr><th>Receipt No.</th><th>Date</th><th>Amount</th><th>Discount</th><th>Net</th><th>Mode</th><th>Cheque No. / UPI Txn ID</th></tr></thead>
                <tbody>
                  {billPayments.map((p) => (
                    <tr key={p._id}>
                      <td><strong>{p.receipt_number}</strong></td>
                      <td>{formatDate(p.date)}</td>
                      <td>₹{(p.amount_received || 0).toFixed(2)}</td>
                      <td>₹{(p.discount || 0).toFixed(2)}</td>
                      <td>₹{((p.amount_received || 0) - (p.discount || 0)).toFixed(2)}</td>
                      <td>{paymentModeLabel(p.payment_mode)}</td>
                      <td>{paymentRef(p)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {wasEdited && (
            <>
              <h4 style={{margin:'1rem 0 0.4rem'}}>Edit History</h4>
              <div style={{background:'#f8fafc', border:'1px solid var(--border)', borderRadius:'6px', padding:'0.6rem 0.85rem', fontSize:'0.8rem'}}>
                {bill.edit_history.map((h, i) => (
                  <div key={i} style={{marginBottom: i < bill.edit_history.length - 1 ? '0.6rem' : 0}}>
                    <div style={{color:'var(--text-muted)', fontSize:'0.72rem'}}>
                      {formatDateTime(h.edited_at)} · {h.edited_by || 'user'}
                      {h.authorized_by && <span style={{color:'#16A34A'}}> · 🛡️ approved by {h.authorized_by} ({h.authorized_via})</span>}
                    </div>
                    <ul style={{margin:'0.2rem 0 0 1rem', padding:0}}>
                      {(h.changes || []).map((c, j) => <li key={j}>{c}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}

          {locked && (
            <div className="alert alert-warning" style={{marginTop:'0.75rem', fontSize:'0.82rem'}}>
              🔒 This bill is older than 3 days — editing and deleting are locked. Only the bill number can still be changed.
            </div>
          )}
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
            <button type="button" className="btn btn-secondary" onClick={handleExport}>Export Excel</button>
            {!locked && onEdit && bill.transaction_category !== 'INTERNAL_TRANSFER' && (
              <button type="button" className="btn btn-secondary" title="Requires approval from a trusted person"
                onClick={() => setStepUpFor('edit')}>✏️ Edit</button>
            )}
            {!locked && onDeleted && (
              <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>🗑️ Delete</button>
            )}
            <button type="button" className="btn btn-primary" onClick={handlePrint}>🖨 Print / PDF</button>
          </div>

          {confirmDelete && (
            <ConfirmModal
              title="Delete this bill?"
              message={`Delete ${bill.bill_number}? Every cylinder on it will revert to its previous location and stock state. Linked payments are kept as-is. This cannot be undone. A trusted person must approve next.`}
              confirmLabel="Continue to approval"
              onConfirm={() => { setConfirmDelete(false); setStepUpFor('delete'); }}
              onCancel={() => setConfirmDelete(false)}
              loading={deleting}
            />
          )}
          {stepUpFor && (
            <StepUpVerificationModal
              title={stepUpFor === 'delete' ? `Approve deleting ${bill.bill_number}` : `Approve editing ${bill.bill_number}`}
              context={`${stepUpFor === 'delete' ? 'delete' : 'edit'} Bill ${bill.bill_number}${bill.company_name ? ` for ${bill.company_name}` : ''}`}
              message="This action needs approval from a trusted person."
              onVerified={(auth) => {
                setStepUpFor(null);
                if (stepUpFor === 'delete') handleDelete(auth.step_up_token);
                else onEdit(auth);
              }}
              onClose={() => setStepUpFor(null)}
            />
          )}
          <div style={{fontSize:'0.75rem', color:'var(--text-muted)', textAlign:'right', marginTop:'0.4rem'}}>
            Tip: In the Chrome print dialog, uncheck “Headers and footers” for the cleanest output.
          </div>
        </>
      )}
    </Modal>
  );
}

// Edit Bill modal (item 11). Editable date/challan/type + line items; saves via PUT /api/bills/:id.
// sameSession=true (used from the just-created screen) skips the audit-log entry.
export function EditBillModal({ billId, sameSession = false, stepUpToken = '', onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [meta, setMeta] = useState({ bill_number: '', company_name: '', phone_primary: '' });
  const [form, setForm] = useState({ bill_number: '', bill_date: '', challan_no: '', transaction_type: 'GIVEN', lines: [] });
  const [gasTypes, setGasTypes] = useState([]);
  const [sizes, setSizes] = useState([]);
  const [invCyls, setInvCyls] = useState([]);   // inventory, for serial → gas/size auto-match
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null); // { message, onConfirm } — smart-dependency confirmation

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [bRes, gRes, sRes, cRes] = await Promise.all([
          apiFetch(`${API_URL}/bills/${billId}`),
          apiFetch(`${API_URL}/masters/gas-types`),
          apiFetch(`${API_URL}/masters/cylinder-sizes`),
          apiFetch(`${API_URL}/cylinders`)
        ]);
        const b = await bRes.json();
        if (!active) return;
        setGasTypes(await gRes.json());
        setSizes(await sRes.json());
        setInvCyls(await cRes.json());
        setMeta({ bill_number: b.bill_number, company_name: b.company_name, phone_primary: b.phone_primary });
        setForm({
          bill_number: b.bill_number || '',
          bill_date: (b.bill_date || '').slice(0, 10),
          challan_no: b.challan_no || '',
          transaction_type: b.transaction_type,
          // Split into inventory lines (serial set) and standalone personal rows
          // (_personal: true; one per direction + gas + size, counts summed — even when the
          // stored count sits attached to an inventory line). save() does the reverse mapping.
          lines: (() => {
            const invLines = [];
            const personal = {}; // "dir|gas|size" -> merged personal row
            (b.line_items || []).forEach(li => {
              const gid = String(li.gas_type_id?._id || li.gas_type_id || '');
              const sid = String(li.cylinder_size_id?._id || li.cylinder_size_id || '');
              const p = (li.direction === 'GIVEN' ? li.personalCylindersOut : li.personalCylindersIn) || 0;
              if (li.serial_number) {
                invLines.push({ direction: li.direction, gas_type_id: gid, cylinder_size_id: sid, serial_number: li.serial_number, rate: li.rate || 0 });
              }
              if (p > 0) {
                const key = `${li.direction}|${gid}|${sid}`;
                if (!personal[key]) personal[key] = { direction: li.direction, gas_type_id: gid, cylinder_size_id: sid, _personal: true, personalCount: 0, rate: li.rate || 0 };
                personal[key].personalCount += p;
                if (!personal[key].rate) personal[key].rate = li.rate || 0;
              }
            });
            return [...invLines, ...Object.values(personal)];
          })()
        });
        setLoading(false);
      } catch { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [billId]);

  const gasNameById = (id) => gasTypes.find(g => String(g._id) === String(id))?.gas_type_name;
  const sizesForGas = (gasId) => {
    const gn = gasNameById(gasId);
    const valid = gn ? (GAS_CAPACITIES[gn] || null) : null;
    const list = valid ? sizes.filter(s => valid.includes(s.size_label)) : sizes;
    return sortCapacities(list, s => s.size_label);
  };
  const setLineFields = (i, patch) => setForm(f => ({ ...f, lines: f.lines.map((l, j) => j === i ? { ...l, ...patch } : l) }));
  const addLine = (direction) => setForm(f => ({ ...f, lines: [...f.lines, { direction, gas_type_id: '', cylinder_size_id: '', serial_number: '', rate: 0 }] }));
  const addPersonalLine = (direction) => setForm(f => ({ ...f, lines: [...f.lines, { direction, gas_type_id: '', cylinder_size_id: '', _personal: true, personalCount: 1, rate: 0 }] }));
  const removeLine = (i) => setForm(f => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }));

  // ── Smart field dependencies (with confirmation; controlled inputs revert on cancel) ──
  const requestGasChange = (i, newGas) => {
    const l = form.lines[i];
    if (l._personal) { setLineFields(i, { gas_type_id: newGas, cylinder_size_id: '' }); return; } // no serial to protect
    if (l.cylinder_size_id || String(l.serial_number || '').trim()) {
      setConfirm({
        message: 'Changing gas type will clear the Cylinder Size and Cylinder No. for this line. Continue?',
        onConfirm: () => setLineFields(i, { gas_type_id: newGas, cylinder_size_id: '', serial_number: '' })
      });
    } else {
      setLineFields(i, { gas_type_id: newGas });
    }
  };
  const requestSizeChange = (i, newSize) => {
    const l = form.lines[i];
    if (l._personal) { setLineFields(i, { cylinder_size_id: newSize }); return; }
    if (String(l.serial_number || '').trim()) {
      setConfirm({
        message: 'Changing cylinder size will clear the Cylinder No. for this line. Continue?',
        onConfirm: () => setLineFields(i, { cylinder_size_id: newSize, serial_number: '' })
      });
    } else {
      setLineFields(i, { cylinder_size_id: newSize });
    }
  };
  // ── Real-time per-cylinder availability validation (inline, edit context) ──
  // Runs when a cylinder number is finalized (blur). Stores the result on the line as `_val`:
  //   { state: 'error'|'warn'|'ok', message }. Save is blocked while any line has state === 'error'.
  // Cylinders already on this bill (same direction) are exempt — the backend handles that via transactionId.
  const validateLine = async (i) => {
    const l = form.lines[i];
    const val = String(l.serial_number || '').trim();
    if (!val) { setLineFields(i, { _val: null }); return; }
    const low = val.toLowerCase();
    // Local: same number twice in the same section → hard error (no server call needed).
    const dupSameDir = form.lines.some((x, j) => j !== i && x.direction === l.direction &&
      String(x.serial_number || '').trim().toLowerCase() === low);
    if (dupSameDir) { setLineFields(i, { _val: { state: 'error', message: `${val} already added in this bill.` } }); return; }
    // Same number in the OPPOSITE section → swap round-trip; treat as valid, skip server validation.
    const inOpposite = form.lines.some((x, j) => j !== i && x.direction !== l.direction &&
      String(x.serial_number || '').trim().toLowerCase() === low);
    if (inOpposite) { setLineFields(i, { _val: { state: 'ok', message: '' } }); return; }
    try {
      const res = await apiFetch(`${API_URL}/bills/validate-cylinder`, {
        method: 'POST',
        body: JSON.stringify({
          cylinderNo: val,
          direction: l.direction === 'GIVEN' ? 'given' : 'received',
          transactionId: billId
        })
      });
      const data = await res.json();
      if (!res.ok) { setLineFields(i, { _val: null }); return; } // endpoint failure → don't block the user
      if (data.valid === false) setLineFields(i, { _val: { state: 'error', message: data.message } });
      else if (data.warningOnly) setLineFields(i, { _val: { state: 'warn', message: data.message } });
      else setLineFields(i, { _val: { state: 'ok', message: '' } });
    } catch { setLineFields(i, { _val: null }); }
  };

  // On leaving the Cylinder No. field: (1) offer gas/size auto-match if it differs, then (2) validate availability.
  // Unknown numbers are accepted as manual/personal entries (no auto-match popup), but still validated (server skips them).
  const onSerialBlur = (i) => {
    const l = form.lines[i];
    const val = String(l.serial_number || '').trim();
    validateLine(i);
    if (!val) return;
    const cyl = invCyls.find(c => String(c.rotational_number).toLowerCase() === val.toLowerCase());
    if (!cyl) return; // not in inventory → manual, no popup
    const gid = String(gasTypes.find(g => g.gas_type_name === cyl.gas_type)?._id || '');
    const sid = String(sizes.find(s => s.size_label === cyl.capacity)?._id || '');
    if (gid === String(l.gas_type_id) && sid === String(l.cylinder_size_id)) return; // matches → silent
    setConfirm({
      message: `${cyl.rotational_number} is ${cyl.gas_type} / ${cyl.capacity}. Do you want to update this line to match?`,
      onConfirm: () => setLineFields(i, { gas_type_id: gid, cylinder_size_id: sid })
    });
  };

  const hasBlockingErrors = () => form.lines.some(l => l._val && l._val.state === 'error');

  const save = async () => {
    setError('');
    if (!form.bill_number.trim()) { setError('Bill number cannot be empty.'); return; }
    if (!form.challan_no.trim()) { setError('Challan number is required.'); return; }
    if (!form.lines.length) { setError('At least one cylinder line is required.'); return; }
    for (const l of form.lines) {
      if (!l.gas_type_id || !l.cylinder_size_id) {
        setError('Each line needs a gas type and size.'); return;
      }
      if (l._personal) {
        if ((Number(l.personalCount) || 0) <= 0) { setError('Each personal cylinder line needs a quantity of at least 1.'); return; }
      } else if (!String(l.serial_number || '').trim()) {
        setError('Each cylinder line needs a cylinder number.'); return;
      }
    }
    if (hasBlockingErrors()) { setError('Resolve the highlighted cylinder errors before saving.'); return; }
    setSaving(true);
    try {
      const res = await apiFetch(`${API_URL}/bills/${billId}`, {
        method: 'PUT',
        headers: stepUpToken ? { 'x-step-up-token': stepUpToken } : {},
        body: JSON.stringify({
          bill_number: form.bill_number.trim(), // uniqueness re-validated server-side on every edit
          bill_date: form.bill_date,
          challan_no: form.challan_no,
          transaction_type: form.transaction_type,
          logEdit: !sameSession,
          // Inventory rows carry the serial and no personal counts; each personal row becomes a
          // personal-only line (serial '') with its count on Out (Filled) / In (Empty) — the shape
          // the backend already accepts. Amount rule is recomputed server-side: rate × (qty + out).
          line_items: form.lines.map(l => l._personal
            ? {
                direction: l.direction, gas_type_id: l.gas_type_id, cylinder_size_id: l.cylinder_size_id,
                serial_number: '', rate: l.direction === 'GIVEN' ? (Number(l.rate) || 0) : 0,
                personalCylindersIn: l.direction === 'RECEIVED' ? (Number(l.personalCount) || 0) : 0,
                personalCylindersOut: l.direction === 'GIVEN' ? (Number(l.personalCount) || 0) : 0
              }
            : {
                direction: l.direction, gas_type_id: l.gas_type_id, cylinder_size_id: l.cylinder_size_id,
                serial_number: l.serial_number, rate: Number(l.rate) || 0,
                personalCylindersIn: 0, personalCylindersOut: 0
              })
        })
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to update bill'); setSaving(false); return; }
      if (data.amount_changed) {
        showToast(`Bill amount changed from ₹${(data.old_amount || 0).toFixed(2)} to ₹${(data.new_amount || 0).toFixed(2)}. Existing payments are not affected.`, 'info');
      } else {
        showToast('Bill updated.', 'success');
      }
      setSaving(false);
      onSaved && onSaved(billId);
    } catch { setError('Network error'); setSaving(false); }
  };

  // Render one direction's lines as a section (blue = given, red = received):
  // an OUR CYLINDERS (inventory) table, then ONE grouped "Personal Cylinders" table —
  // each rendered only when it has entries.
  const renderSection = (direction, title, cls) => {
    const inv = form.lines.map((l, i) => ({ l, i })).filter(x => x.l.direction === direction && !x.l._personal);
    const pers = form.lines.map((l, i) => ({ l, i })).filter(x => x.l.direction === direction && x.l._personal);
    const gasSelect = (l, i) => (
      <select className="form-control" style={{ minWidth: '110px' }} value={l.gas_type_id} onChange={e => requestGasChange(i, e.target.value)}>
        <option value="">--</option>
        {sortGasTypes(gasTypes, g => g.gas_type_name).map(g => <option key={g._id} value={g._id}>{g.gas_type_name}</option>)}
      </select>
    );
    const sizeSelect = (l, i) => (
      <select className="form-control" style={{ minWidth: '95px' }} value={l.cylinder_size_id} onChange={e => requestSizeChange(i, e.target.value)}>
        <option value="">--</option>
        {sizesForGas(l.gas_type_id).map(s => <option key={s._id} value={s._id}>{s.size_label}</option>)}
      </select>
    );
    return (
      <div className={`txn-section ${cls}`} style={{ marginTop: '1rem' }}>
        <h3>{title}</h3>
        {inv.length === 0 && pers.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0.25rem 0' }}>No cylinders in this section.</p>
        )}

        {inv.length > 0 && (
          <div className="table-container">
            <table>
              <thead><tr>
                <th>Gas Type</th><th>Size</th><th>Cylinder No.</th>
                {direction === 'GIVEN' && <th>Rate</th>}
                {direction === 'GIVEN' && <th>Amount</th>}
                <th></th>
              </tr></thead>
              <tbody>
                {inv.map(({ l, i }) => {
                  const colSpan = direction === 'GIVEN' ? 6 : 4;
                  const v = l._val;
                  const serialStyle = v && v.state === 'error'
                    ? { borderColor: 'var(--danger, #DC2626)' }
                    : (v && v.state === 'warn' ? { borderColor: '#f59e0b' } : {});
                  return (
                  <React.Fragment key={i}>
                  <tr>
                    <td>{gasSelect(l, i)}</td>
                    <td>{sizeSelect(l, i)}</td>
                    <td>
                      <input type="text" className="form-control" style={{ minWidth: '110px', ...serialStyle }} value={l.serial_number}
                        onChange={e => setLineFields(i, { serial_number: e.target.value, _val: null })}
                        onBlur={() => onSerialBlur(i)} />
                    </td>
                    {direction === 'GIVEN' && (
                      <td><input type="number" className="form-control" style={{ width: '90px' }} value={l.rate}
                        onChange={e => setLineFields(i, { rate: e.target.value })} /></td>
                    )}
                    {direction === 'GIVEN' && (
                      <td style={{ whiteSpace: 'nowrap' }}>₹{(Number(l.rate) || 0).toFixed(2)}</td>
                    )}
                    <td><button type="button" className="btn btn-danger" style={{ padding: '0.25rem 0.5rem' }} onClick={() => removeLine(i)}>×</button></td>
                  </tr>
                  {v && v.message && (
                    <tr>
                      <td colSpan={colSpan} style={{
                        padding: '0.3rem 0.5rem 0.55rem', fontSize: '0.8rem', borderTop: 'none',
                        color: v.state === 'error' ? 'var(--danger, #DC2626)' : '#b45309'
                      }}>
                        {v.state === 'error' ? '⛔ ' : '⚠️ '}{v.message}
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {pers.length > 0 && (
          <>
            <h4 style={{ margin: '0.85rem 0 0.35rem', fontSize: '0.82rem' }}>
              🔄 Personal Cylinders
              <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '0.5rem', fontSize: '0.72rem' }}>
                (customer's own — not tracked in our inventory)
              </span>
            </h4>
            <div className="table-container">
              <table>
                <thead><tr>
                  <th>Gas Type</th><th>Size</th><th>Quantity</th>
                  {direction === 'GIVEN' && <th>Rate</th>}
                  {direction === 'GIVEN' && <th>Amount</th>}
                  <th></th>
                </tr></thead>
                <tbody>
                  {pers.map(({ l, i }) => (
                    <tr key={i}>
                      <td>{gasSelect(l, i)}</td>
                      <td>{sizeSelect(l, i)}</td>
                      <td>
                        <input type="number" className="form-control" style={{ width: '90px' }} min="1" step="1" placeholder="0"
                          value={(Number(l.personalCount) || 0) === 0 ? '' : l.personalCount}
                          onChange={e => {
                            const v = e.target.value;
                            setLineFields(i, { personalCount: v === '' ? 0 : Math.max(0, parseInt(v, 10) || 0) });
                          }} />
                      </td>
                      {direction === 'GIVEN' && (
                        <td><input type="number" className="form-control" style={{ width: '90px' }} value={l.rate}
                          onChange={e => setLineFields(i, { rate: e.target.value })} /></td>
                      )}
                      {direction === 'GIVEN' && (
                        <td style={{ whiteSpace: 'nowrap' }}>₹{((Number(l.rate) || 0) * (Number(l.personalCount) || 0)).toFixed(2)}</td>
                      )}
                      <td><button type="button" className="btn btn-danger" style={{ padding: '0.25rem 0.5rem' }} onClick={() => removeLine(i)}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary" onClick={() => addLine(direction)}>+ Add Cylinder</button>
          <button type="button" className="btn btn-secondary" onClick={() => addPersonalLine(direction)}>+ Add Personal Cylinder</button>
        </div>
      </div>
    );
  };

  return (
    <Modal title={`Edit Bill — ${meta.bill_number || ''}`} size="wide" onClose={onClose}>
      {loading ? <Spinner label="Loading bill…" /> : (
        <>
          <div style={{background:'#f8fafc', border:'1px solid var(--border)', borderRadius:'6px', padding:'0.5rem 0.85rem', marginBottom:'0.85rem', fontSize:'0.85rem'}}>
            <strong>Bill No.:</strong> {meta.bill_number} &nbsp;·&nbsp; <strong>Customer:</strong> {meta.company_name} {meta.phone_primary ? `(${meta.phone_primary})` : ''}
          </div>

          <div className="form-row cols-3">
            <div className="form-group">
              <label>Bill No. *</label>
              <input type="text" className="form-control" value={form.bill_number}
                onChange={e => setForm({ ...form, bill_number: e.target.value })} />
              <small style={{color:'var(--text-muted)', fontSize:'0.75rem'}}>Must stay unique across all bills.</small>
            </div>
            <div className="form-group">
              <label>Bill Date</label>
              <input type="date" className="form-control" value={form.bill_date} onChange={e => setForm({ ...form, bill_date: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Challan No. *</label>
              <input type="text" className="form-control" value={form.challan_no} onChange={e => setForm({ ...form, challan_no: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Transaction Type</label>
              <select className="form-control" value={form.transaction_type} onChange={e => setForm({ ...form, transaction_type: e.target.value })}>
                <option value="GIVEN">FILLED</option>
                <option value="RECEIVED">EMPTY</option>
                <option value="SWAP">SWAP</option>
              </select>
            </div>
          </div>

          {renderSection('GIVEN', 'Cylinders Filled to Customer', 'txn-section-given')}
          {renderSection('RECEIVED', 'Cylinders Empty from Customer', 'txn-section-received')}

          {error && <div className="alert alert-danger" style={{marginTop:'0.75rem'}}>{error}</div>}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving || hasBlockingErrors()}>{saving ? 'Saving…' : 'Save Changes'}</button>
          </div>
        </>
      )}

      {confirm && (
        <ConfirmModal
          title="Confirm change"
          message={confirm.message}
          confirmLabel="Continue"
          danger={false}
          onConfirm={() => { confirm.onConfirm(); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </Modal>
  );
}

// Cylinder Aging Report Page
export function CylinderAgingReport({ onViewCustomer }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('gte');        // 'gte' (default) | 'range'
  const [minDays, setMinDays] = useState('');
  const [maxDays, setMaxDays] = useState('');
  const [thresholdDays, setThresholdDays] = useState('');
  const [sortBy, setSortBy] = useState('daysOut'); // 'daysOut' | 'customer'
  const [sortOrder, setSortOrder] = useState('desc');
  // Location tab: defaults to the user's active_location (Phase 2) once loaded.
  const [locTab, setLocTab] = useState(null); // null = not yet resolved

  // Resolve the default tab from active_location (read, not duplicated).
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`${API_URL}/profile/locations`);
        const data = res.ok ? await res.json() : null;
        setLocTab((data && LOCATIONS.includes(data.active_location)) ? data.active_location : LOCATIONS[0]);
      } catch { setLocTab(LOCATIONS[0]); }
    })();
  }, []);

  const fetchReport = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ mode, sortBy, sortOrder, location: locTab });
      if (mode === 'range') {
        if (minDays !== '') p.set('minDays', minDays);
        if (maxDays !== '') p.set('maxDays', maxDays);
      } else {
        if (thresholdDays !== '') p.set('thresholdDays', thresholdDays);
      }
      const res = await apiFetch(`${API_URL}/cylinders/aging-report?${p.toString()}`);
      setRows(await res.json());
      setLoading(false);
    } catch (error) {
      console.error('Error fetching aging report:', error);
      setLoading(false);
    }
  };

  useEffect(() => { if (locTab) fetchReport(); }, [mode, minDays, maxDays, thresholdDays, sortBy, sortOrder, locTab]);

  // Rows with a resolved holder navigate to that customer's detail (aging-history section).
  const rowNav = (r) => {
    if (r.customer_id && onViewCustomer) onViewCustomer(String(r.customer_id));
  };

  // Live days-out so the figure stays current without a re-fetch
  const liveDays = (d) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null;
  const fmtDate = (d) => d ? formatDate(d) : '—';

  const handleExport = () => {
    exportToExcel(
      rows.map((r, i) => ({
        'Sr.': i + 1,
        'Rotational No.': r.rotational_number,
        'Days Out': liveDays(r.date_given) ?? '',
        'Gas Type': r.gas_type,
        'Capacity': r.capacity,
        'Customer': r.customer_name || '(no given record)',
        'Contact': r.customer_phone || '',
        'Address': r.customer_address || '',
        'Date Filled': fmtDate(r.date_given),
        'Bill No.': r.bill_number || '',
        'Challan No.': r.challan_no || '',
        'Rate': r.rate ?? ''
      })), getExportFileName('aging-report'), 'Aging'
    );
  };

  const [agingVisible, agingMore, agingOpen, setAgingOpen] = useViewAll(rows, 10);

  // Physical No. lives only in Cylinder Inventory (Phase 7/8); Sr. No. added for the view-all.
  const agingColumns = [
    { header: 'Sr. No.', cell: (r, i) => i + 1 },
    { header: 'Rotational No.', cell: (r) => <strong>{r.rotational_number}</strong> },
    { header: 'Days Out', cell: (r) => { const d = liveDays(r.date_given); return d === null ? '—' : d; } },
    { header: 'Gas Type', cell: (r) => r.gas_type },
    { header: 'Capacity', cell: (r) => r.capacity },
    { header: 'Customer', cell: (r) => r.customer_name || '(no given record)' },
    { header: 'Contact', cell: (r) => r.customer_phone || '—' },
    { header: 'Date Filled', cell: (r) => fmtDate(r.date_given) },
    { header: 'Bill No.', cell: (r) => r.bill_number || '—' },
    { header: 'Challan No.', cell: (r) => r.challan_no || '—' }
  ];

  return (
    <div>
      <div className="card">
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'0.75rem'}}>
          <h2 style={{margin:0, border:'none', padding:0}}>Cylinder Aging Report</h2>
          <button className="btn btn-secondary" onClick={handleExport} disabled={!rows.length}>Export Excel</button>
        </div>
        <p style={{color:'var(--text-muted)', fontSize:'0.82rem', marginTop:'0.5rem'}}>
          Every cylinder currently <strong>with customers</strong> with its latest "Filled" details and how many days it has been out.
          Click a row to open the holding customer's aging history.
        </p>

        {/* Location tabs — display split only; the days-held calculation is unchanged. */}
        <div className="btn-group" style={{marginTop:'0.75rem'}}>
          {LOCATIONS.map(l => (
            <button key={l} className={`btn ${locTab === l ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setLocTab(l)}>{LOCATION_LABELS[l]}</button>
          ))}
        </div>

        {/* Filters */}
        <div className="form-row" style={{marginTop:'1rem'}}>
          <div className="form-group">
            <label>Days Out — Filter Mode</label>
            <select className="form-control" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="gte">X or more</option>
              <option value="range">Range (min–max)</option>
            </select>
          </div>

          {mode === 'range' ? (
            <>
              <div className="form-group">
                <label>Min Days</label>
                <input type="number" className="form-control" min="0" value={minDays}
                  onChange={(e) => setMinDays(e.target.value)} placeholder="e.g. 15" />
              </div>
              <div className="form-group">
                <label>Max Days</label>
                <input type="number" className="form-control" min="0" value={maxDays}
                  onChange={(e) => setMaxDays(e.target.value)} placeholder="e.g. 45" />
              </div>
            </>
          ) : (
            <div className="form-group">
              <label>Threshold (days or more)</label>
              <input type="number" className="form-control" min="0" value={thresholdDays}
                onChange={(e) => setThresholdDays(e.target.value)} placeholder="e.g. 30" />
            </div>
          )}

          <div className="form-group">
            <label>Sort By</label>
            <select className="form-control" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="daysOut">Days Out</option>
              <option value="customer">Customer Name</option>
            </select>
          </div>
          <div className="form-group">
            <label>Order</label>
            <select className="form-control" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
              {sortBy === 'customer'
                ? <><option value="asc">A → Z</option><option value="desc">Z → A</option></>
                : <><option value="desc">Longest out first</option><option value="asc">Shortest out first</option></>}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <Spinner label="Loading aging report…" />
        ) : rows.length === 0 ? (
          <EmptyState icon="⏱️" message="No cylinders match this filter" hint="Adjust the day range or sorting above." />
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Sr.</th>
                  <th>Rotational No.</th>
                  <th>Days Out</th>
                  <th>Gas Type</th>
                  <th>Capacity</th>
                  <th>Customer</th>
                  <th>Contact</th>
                  <th>Date Filled</th>
                  <th>Bill No.</th>
                  <th>Challan No.</th>
                  <th>Rate</th>
                </tr>
              </thead>
              <tbody>
                {agingVisible.map((r, index) => {
                  const days = liveDays(r.date_given);
                  return (
                    <tr key={r.rotational_number + '-' + index}
                      className={r.no_given_record ? 'row-over-limit' : ''}
                      style={{whiteSpace:'nowrap', ...(r.customer_id && onViewCustomer ? {cursor:'pointer'} : {})}}
                      title={r.customer_id && onViewCustomer ? `View ${r.customer_name}'s aging history` : undefined}
                      onClick={() => rowNav(r)}>
                      <td>{index + 1}</td>
                      <td><strong>{r.rotational_number}</strong></td>
                      <td><strong>{days === null ? '—' : days}</strong></td>
                      <td>{r.gas_type}</td>
                      <td>{r.capacity}</td>
                      <td>
                        {r.customer_name || <span className="badge badge-warning">No given record</span>}
                      </td>
                      <td>{r.customer_phone || '—'}</td>
                      <td>{fmtDate(r.date_given)}</td>
                      <td>{r.bill_number || '—'}</td>
                      <td>{r.challan_no || '—'}</td>
                      <td>{r.rate !== null && r.rate !== undefined ? `₹${r.rate.toFixed(2)}` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {agingMore && <ViewAllButton count={rows.length} onClick={() => setAgingOpen(true)} />}
          </div>
        )}
        <p style={{color:'var(--text-muted)', fontSize:'0.78rem', marginTop:'0.75rem'}}>
          Showing {rows.length} cylinder(s). Rows highlighted in red are in-rotation but have no matching "Filled" transaction — they always appear regardless of the day filter.
        </p>
      </div>

      {agingOpen && (
        <ListModal title={`Cylinder Aging Report — ${locTab ? LOCATION_LABELS[locTab] : ''}`} items={rows} columns={agingColumns}
          searchKeys={['rotational_number', 'gas_type', 'capacity', 'customer_name']}
          searchPlaceholder="Search by rotational no., gas type, or customer…"
          onRowClick={(r) => { if (r.customer_id && onViewCustomer) { setAgingOpen(false); rowNav(r); } }}
          onClose={() => setAgingOpen(false)} />
      )}
    </div>
  );
}

// ─── Chandisar Filling List (Phase 11, redesigned Phase 13) ───
// Staff stage cylinder entries locally through the day and commit them with an explicit Save;
// Edit reopens a saved day in the same staged view for further changes. Feeds ONLY the
// Chandisar stock summary ("Filled Today" + the Empty-Issue component) — it never alters
// Cylinder.location/stock_state and never creates or touches a Bill.
export function FillingListPage() {
  const localToday = () => {
    const x = new Date();
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  };
  const [date, setDate] = useState(localToday());
  const [saved, setSaved] = useState([]);          // committed entries (server truth, with repeat badges)
  const [staged, setStaged] = useState([]);        // local, uncommitted entries being edited
  const [mode, setMode] = useState('edit');        // 'edit' (staged view) | 'view' (saved view)
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Field order matches the New Transaction page: Gas Type → Size → Cylinder No. (Phase 13).
  // Gas/size persist across additions; only the cylinder number clears.
  const [form, setForm] = useState({ gas_type: '', capacity: '', rotational_number: '' });
  const [cylinders, setCylinders] = useState([]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`${API_URL}/filling-log?date=${date}`);
      const list = res.ok ? await res.json() : [];
      setSaved(list);
      setStaged([]);
      setDirty(false);
      setMode(list.length ? 'view' : 'edit');
    } catch { setSaved([]); setStaged([]); setMode('edit'); }
    setLoading(false);
  };
  useEffect(() => { load(); }, [date]);
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`${API_URL}/cylinders`);
        if (res.ok) setCylinders(await res.json());
      } catch {}
    })();
  }, []);

  // Typing a known cylinder number auto-fills gas/size from inventory.
  const knownCyl = form.rotational_number
    ? cylinders.find(c => c.rotational_number === form.rotational_number.trim())
    : null;

  const addStaged = () => {
    const rot = form.rotational_number.trim();
    const gas = knownCyl ? knownCyl.gas_type : form.gas_type;
    const cap = knownCyl ? knownCyl.capacity : form.capacity;
    if (!gas || !cap) {
      showToast(rot
        ? `"${rot}" is not in inventory — pick its gas type and size first.`
        : 'Pick a gas type and size, or type a known cylinder number.');
      return;
    }
    setStaged(prev => [...prev, { rotational_number: rot, gas_type: gas, capacity: cap }]);
    setDirty(true);
    // Gas/size stay put for the next entry of the same run; only the number clears (Phase 13).
    setForm(prev => ({ ...prev, rotational_number: '' }));
  };

  const removeStaged = (idx) => { setStaged(prev => prev.filter((_, i) => i !== idx)); setDirty(true); };

  const startEdit = () => {
    setStaged(saved.map(e => ({ rotational_number: e.rotational_number || '', gas_type: e.gas_type, capacity: e.capacity })));
    setDirty(false);
    setMode('edit');
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      const res = await apiFetch(`${API_URL}/filling-log`, {
        method: 'PUT',
        body: JSON.stringify({ date, entries: staged })
      });
      if (res.ok) {
        const list = await res.json();
        setSaved(list);
        setStaged([]);
        setDirty(false);
        setMode('view');
        showToast(`Filling list saved — ${list.length} entr${list.length === 1 ? 'y' : 'ies'} for ${formatDate(date)}.`, 'success');
      } else showToast(await apiErrorMessage(res, 'Could not save the filling list'));
    } catch { showToast('Could not save the filling list'); }
    setSaving(false);
  };

  // Local repeat hint for the staged view (informational; the saved view uses server data).
  const stagedRepeat = (idx) => {
    const rot = (staged[idx].rotational_number || '').trim();
    if (!rot) return 0;
    let n = 0;
    for (let i = 0; i <= idx; i++) if ((staged[i].rotational_number || '').trim() === rot) n++;
    return n;
  };

  const comboCounts = (list) => {
    const counts = {};
    list.forEach(e => { const k = `${e.gas_type} · ${e.capacity}`; counts[k] = (counts[k] || 0) + 1; });
    return counts;
  };

  const repeatBadge = (index, count) => index > 1 && (
    <span className="badge badge-warning" style={{marginLeft:'0.4rem', fontSize:'0.62rem'}}
      title={`This cylinder appears ${count} times in today's filling list`}>
      {index === 2 ? 'Filled twice today' : `Filled ×${index} today`}
    </span>
  );

  return (
    <div>
      <div className="card">
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'0.75rem'}}>
          <h2 style={{margin:0, border:'none', padding:0}}>⛽ Filling List — Chandisar Plant</h2>
          <input type="date" className="form-control" style={{width:'auto'}} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <p style={{color:'var(--text-muted)', fontSize:'0.82rem', marginTop:'0.5rem'}}>
          Stage cylinders as they are filled, then press <strong>Save</strong> to commit the day's list.
          This log only feeds the Chandisar Stock Summary — it never changes a cylinder's location/state and never creates a bill.
        </p>

        {mode === 'edit' && (
          <div className="form-row cols-3" style={{alignItems:'end', marginTop:'0.75rem'}}>
            <div className="form-group" style={{marginBottom:0}}>
              <label>Gas Type</label>
              <select className="form-control" value={knownCyl ? knownCyl.gas_type : form.gas_type} disabled={!!knownCyl}
                onChange={(e) => setForm({ ...form, gas_type: e.target.value, capacity: '' })}>
                <option value="">-- Select --</option>
                {GAS_TYPE_LIST.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="form-group" style={{marginBottom:0}}>
              <label>Size</label>
              <select className="form-control" value={knownCyl ? knownCyl.capacity : form.capacity}
                disabled={!!knownCyl || !form.gas_type}
                onChange={(e) => setForm({ ...form, capacity: e.target.value })}>
                <option value="">-- Select --</option>
                {(GAS_CAPACITIES[knownCyl ? knownCyl.gas_type : form.gas_type] || []).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group" style={{marginBottom:0}}>
              <label>Cylinder No. (auto-fills gas/size)</label>
              <div style={{display:'flex', gap:'0.4rem'}}>
                <input className="form-control" placeholder="e.g. 1024" value={form.rotational_number}
                  onChange={(e) => setForm({ ...form, rotational_number: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addStaged(); } }} />
                <button className="btn btn-primary" onClick={addStaged}>+ Add</button>
              </div>
              {/* No separate confirmation line (Phase 13 addendum) — the Gas Type/Size
                  dropdowns to the left already reflect the auto-filled values. */}
            </div>
          </div>
        )}
      </div>

      {mode === 'edit' ? (
        <div className="card">
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'0.75rem'}}>
            <h2 style={{margin:0, border:'none', padding:0}}>
              Staged for {formatDate(date)} ({staged.length})
              {dirty && <span className="badge badge-warning" style={{marginLeft:'0.5rem', fontSize:'0.65rem'}}>Unsaved changes</span>}
            </h2>
            <div className="btn-group" style={{margin:0}}>
              {saved.length > 0 && (
                <button className="btn btn-secondary" onClick={load} disabled={saving}>Cancel</button>
              )}
              <button className="btn btn-primary" onClick={saveAll} disabled={saving}>
                {saving ? 'Saving…' : `💾 Save (${staged.length})`}
              </button>
            </div>
          </div>
          {Object.keys(comboCounts(staged)).length > 0 && (
            <p style={{color:'var(--text-muted)', fontSize:'0.82rem', margin:'0.4rem 0 0.75rem'}}>
              {Object.entries(comboCounts(staged)).map(([k, n]) => `${k}: ${n}`).join('  ·  ')}
            </p>
          )}
          {staged.length === 0 ? (
            <EmptyState icon="⛽" message="Nothing staged yet" hint="Add cylinders above as they are filled, then press Save." />
          ) : (
            <div className="table-container" style={{marginTop:'0.5rem'}}>
              <table>
                <thead><tr><th>Sr.</th><th>Gas Type</th><th>Size</th><th>Cylinder No.</th><th>Action</th></tr></thead>
                <tbody>
                  {staged.map((e, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{e.gas_type}</td>
                      <td>{e.capacity}</td>
                      <td>
                        <strong>{e.rotational_number || '—'}</strong>
                        {repeatBadge(stagedRepeat(i), stagedRepeat(i))}
                      </td>
                      <td>
                        <button className="btn btn-danger" style={{padding:'0.25rem 0.55rem'}} title="Remove (not saved yet)"
                          onClick={() => removeStaged(i)}>🗑️</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="card">
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'0.75rem'}}>
            <h2 style={{margin:0, border:'none', padding:0}}>Filled on {formatDate(date)} ({saved.length})</h2>
            <button className="btn btn-primary" onClick={startEdit}>✏️ Edit</button>
          </div>
          {Object.keys(comboCounts(saved)).length > 0 && (
            <p style={{color:'var(--text-muted)', fontSize:'0.82rem', margin:'0.4rem 0 0.75rem'}}>
              {Object.entries(comboCounts(saved)).map(([k, n]) => `${k}: ${n}`).join('  ·  ')}
            </p>
          )}
          {loading ? <Spinner label="Loading filling list…" /> : (
            <div className="table-container">
              <table>
                <thead><tr><th>Sr.</th><th>Gas Type</th><th>Size</th><th>Cylinder No.</th><th>Recorded At</th></tr></thead>
                <tbody>
                  {saved.map((e, i) => (
                    <tr key={e.entry_id}>
                      <td>{i + 1}</td>
                      <td>{e.gas_type}</td>
                      <td>{e.capacity}</td>
                      <td>
                        <strong>{e.rotational_number || '—'}</strong>
                        {repeatBadge(e.repeat_index, e.repeat_count)}
                      </td>
                      <td>{formatDateTime(e.recorded_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
