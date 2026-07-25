import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { apiFetch, API_URL } from '../api'
import PaymentForm from '../components/PaymentForm'

export default function CustomerDetail({ customerId, onBack }) {
  const [customer, setCustomer] = useState(null)
  const [givenTransactions, setGivenTransactions] = useState([])
  const [receivedTransactions, setReceivedTransactions] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showPaymentForm, setShowPaymentForm] = useState(false)

  useEffect(() => { if (customerId) fetchCustomerDetail() }, [customerId])

  const fetchCustomerDetail = async () => {
    try {
      const [customerRes, givenRes, receivedRes, paymentsRes] = await Promise.all([
        apiFetch(`${API_URL}/customers/${customerId}`),
        apiFetch(`${API_URL}/customers/${customerId}/transactions/given`),
        apiFetch(`${API_URL}/customers/${customerId}/transactions/received`),
        apiFetch(`${API_URL}/customers/${customerId}/payments`)
      ])
      setCustomer(await customerRes.json())
      setGivenTransactions(await givenRes.json())
      setReceivedTransactions(await receivedRes.json())
      setPayments(await paymentsRes.json())
      setLoading(false)
    } catch (err) {
      console.error('Error fetching customer detail:', err)
      setLoading(false)
    }
  }

  const exportCustomerExcel = () => {
    const d2 = (d) => d ? new Date(d).toLocaleDateString('en-IN') : ''
    const rs = (n) => parseFloat((n || 0).toFixed(2))

    const infoRows = [
      { Field: 'Company Name', Value: customer.company_name || '' },
      { Field: 'Contact Person', Value: customer.contact_person || '' },
      { Field: 'Phone', Value: customer.phone_primary || '' },
      { Field: 'Address', Value: customer.address || '' },
      { Field: 'TIN Number', Value: customer.tin_number || '' },
      { Field: 'Cylinders Held', Value: customer.cylinders_held || 0 },
      { Field: 'Holding Limit', Value: customer.holding_limit || 0 },
      { Field: 'Amount Due', Value: rs(customer.current_bill_amount) },
      { Field: 'Total Billed', Value: rs(customer.total_billed) },
      { Field: 'Total Received', Value: rs(customer.total_received) },
      { Field: 'Security Deposit', Value: rs(customer.security_deposit) },
    ]

    const givenRows = givenTransactions.length ? givenTransactions.map(t => ({
      'Date': d2(t.date), 'Bill No': t.bill_number || '', 'Gas Type': t.gas_type_name || '',
      'Size': t.size_label || '', 'Serial No': t.serial_number || '',
      'Qty': t.quantity || 0, 'Rate': rs(t.rate), 'Amount': rs(t.amount)
    })) : [{ 'Note': 'No cylinders given yet' }]

    const receivedRows = receivedTransactions.length ? receivedTransactions.map(t => ({
      'Date': d2(t.date), 'Bill No': t.bill_number || '', 'Gas Type': t.gas_type_name || '',
      'Size': t.size_label || '', 'Serial No': t.serial_number || '', 'Qty': t.quantity || 0
    })) : [{ 'Note': 'No cylinders received yet' }]

    const paymentRows = payments.length ? payments.map(p => ({
      'Receipt No': p.receipt_number || '', 'Date': d2(p.date),
      'Amount Received': rs(p.amount_received), 'Discount': rs(p.discount),
      'Net Amount': rs((p.amount_received || 0) - (p.discount || 0)),
      'Mode': p.payment_mode || '', 'Cheque No': p.cheque_number || '', 'Remarks': p.remarks || ''
    })) : [{ 'Note': 'No payments recorded yet' }]

    try {
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(infoRows), 'Customer Info')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(givenRows), 'Cylinders Given')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(receivedRows), 'Cylinders Received')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(paymentRows), 'Payments')
      const fname = (customer.company_name || 'Customer').replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '_')
      XLSX.writeFile(wb, `${fname}_Data.xlsx`)
    } catch (err) {
      console.error('Excel export failed:', err)
      alert('Excel export failed: ' + err.message)
    }
  }

  const printCustomer = () => {
    const d2 = (d) => d ? new Date(d).toLocaleDateString('en-IN') : ''
    const rs = (n) => '₹' + (n || 0).toFixed(2)

    const section = (title, headers, rows) => {
      if (!rows.length) return `<h3 style="margin:16px 0 4px">${title}</h3><p style="color:#64748b;font-size:10px">No records</p>`
      const th = headers.map(h => `<th>${h}</th>`).join('')
      const tb = rows.map(r => `<tr>${r.map(v => `<td>${v}</td>`).join('')}</tr>`).join('')
      return `<h3 style="margin:16px 0 6px;font-size:12px">${title}</h3>
        <table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`
    }

    const infoTable = `<table style="width:auto;margin-bottom:8px">
      <tr><td><b>Company</b></td><td>${customer.company_name}</td><td style="padding-left:20px"><b>Phone</b></td><td>${customer.phone_primary || ''}</td></tr>
      <tr><td><b>Contact</b></td><td>${customer.contact_person || ''}</td><td style="padding-left:20px"><b>TIN</b></td><td>${customer.tin_number || ''}</td></tr>
      <tr><td><b>Amount Due</b></td><td>${rs(customer.current_bill_amount)}</td><td style="padding-left:20px"><b>Cylinders Held</b></td><td>${customer.cylinders_held || 0}</td></tr>
    </table>`

    const givenSec = section('Cylinders Given',
      ['Date', 'Bill No', 'Gas Type', 'Size', 'Serial No', 'Qty', 'Rate', 'Amount'],
      givenTransactions.map(t => [d2(t.date), t.bill_number, t.gas_type_name, t.size_label, t.serial_number, t.quantity, rs(t.rate), rs(t.amount)])
    )
    const recvSec = section('Cylinders Received',
      ['Date', 'Bill No', 'Gas Type', 'Size', 'Serial No', 'Qty'],
      receivedTransactions.map(t => [d2(t.date), t.bill_number, t.gas_type_name, t.size_label, t.serial_number, t.quantity])
    )
    const pymtSec = section('Payment History',
      ['Receipt No', 'Date', 'Amount', 'Discount', 'Net', 'Mode', 'Cheque No', 'Remarks'],
      payments.map(p => [p.receipt_number, d2(p.date), rs(p.amount_received), rs(p.discount), rs((p.amount_received || 0) - (p.discount || 0)), p.payment_mode, p.cheque_number || '', p.remarks || ''])
    )

    const html = `<!DOCTYPE html><html><head><title>${customer.company_name}</title>
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
    <h2>CylinderPro — Customer Report: ${customer.company_name}</h2>
    <p style="color:#64748b;font-size:10px;margin-bottom:12px">Generated: ${new Date().toLocaleString('en-IN')}</p>
    ${infoTable}${givenSec}${recvSec}${pymtSec}
    <script>window.onload=function(){window.print();window.onafterprint=function(){window.close()}}<\/script>
    </body></html>`

    const w = window.open('', '_blank', 'width=1000,height=700,scrollbars=yes')
    if (w) { w.document.write(html); w.document.close() }
    else { alert('Please allow pop-ups for Print / PDF.') }
  }

  if (loading) return <div className="loading">Loading customer details...</div>
  if (!customer) return <div className="alert alert-danger">Customer not found</div>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <button className="btn btn-secondary" onClick={onBack}>← Back to List</button>
        <div className="btn-group" style={{ margin: 0 }}>
          <button className="btn btn-secondary" onClick={printCustomer}>Print / PDF</button>
          <button className="btn btn-secondary" onClick={exportCustomerExcel}>Export Excel</button>
        </div>
      </div>

      <div className="card">
        <h2>Customer Information</h2>
        <div className="form-row">
          <div>
            <p><strong>Company Name:</strong> {customer.company_name}</p>
            <p><strong>Contact Person:</strong> {customer.contact_person}</p>
            <p><strong>Phone:</strong> {customer.phone_primary}</p>
            {customer.phone_alternate && <p><strong>Alt Phone:</strong> {customer.phone_alternate}</p>}
          </div>
          <div>
            <p><strong>Address:</strong> {customer.address}</p>
            <p><strong>TIN Number:</strong> {customer.tin_number || 'N/A'}</p>
            <p><strong>Security Deposit:</strong> ₹{customer.security_deposit?.toFixed(2)}</p>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Cylinder Summary</h2>
        <div className="stats-grid">
          <div className="stat-card blue"><h3>Currently Held</h3><div className="value">{customer.cylinders_held}</div></div>
          <div className="stat-card green"><h3>Total Given (All Time)</h3><div className="value">{customer.total_given}</div></div>
          <div className="stat-card orange"><h3>Total Received (All Time)</h3><div className="value">{customer.total_received_qty}</div></div>
          <div className="stat-card purple"><h3>Holding Limit</h3><div className="value">{customer.holding_limit}</div></div>
        </div>

        {customer.status === 'OVER LIMIT' && (
          <div className="alert alert-danger">
            ⚠️ Customer is currently OVER LIMIT by {customer.cylinders_held - customer.holding_limit} cylinders
          </div>
        )}

        {customer.cylinder_breakdown?.length > 0 && (
          <div>
            <h3>Breakdown by Type</h3>
            <table>
              <thead>
                <tr><th>Gas Type</th><th>Size</th><th>Total Given</th><th>Total Received</th><th>Currently Held</th></tr>
              </thead>
              <tbody>
                {customer.cylinder_breakdown.map((item, i) => (
                  <tr key={i}>
                    <td>{item.gas_type_name}</td><td>{item.size_label}</td>
                    <td>{item.total_given}</td><td>{item.total_received}</td>
                    <td><strong>{item.currently_held}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Financial Summary</h2>
        <div className="form-row">
          <div>
            <p><strong>Amount Due:</strong> ₹{customer.current_bill_amount?.toFixed(2)}</p>
            <p><strong>Total Billed:</strong> ₹{customer.total_billed?.toFixed(2)}</p>
            <p><strong>Total Received:</strong> ₹{customer.total_received?.toFixed(2)}</p>
          </div>
          <div>
            <p><strong>Total Discount:</strong> ₹{customer.total_discount?.toFixed(2)}</p>
            <p><strong>Security Deposit:</strong> ₹{customer.security_deposit?.toFixed(2)}</p>
          </div>
        </div>

        <button className="btn btn-primary" onClick={() => setShowPaymentForm(!showPaymentForm)}>
          {showPaymentForm ? 'Cancel' : 'Record Payment'}
        </button>

        {showPaymentForm && (
          <PaymentForm customerId={customerId}
            onSuccess={() => { setShowPaymentForm(false); fetchCustomerDetail() }}
            onCancel={() => setShowPaymentForm(false)} />
        )}
      </div>

      <div className="card">
        <h2>Cylinders Given History</h2>
        <div className="table-container">
          {givenTransactions.length === 0 ? <p>No cylinders given yet.</p> : (
            <table>
              <thead>
                <tr><th>Date</th><th>Bill No.</th><th>Gas Type</th><th>Size</th><th>Serial Number</th><th>Quantity</th><th>Rate</th><th>Amount</th></tr>
              </thead>
              <tbody>
                {givenTransactions.map(t => (
                  <tr key={t.line_item_id}>
                    <td>{new Date(t.date).toLocaleDateString()}</td>
                    <td>{t.bill_number}</td><td>{t.gas_type_name}</td><td>{t.size_label}</td>
                    <td>{t.serial_number}</td><td>{t.quantity}</td>
                    <td>₹{(t.rate || 0).toFixed(2)}</td><td>₹{(t.amount || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Cylinders Received History</h2>
        <div className="table-container">
          {receivedTransactions.length === 0 ? <p>No cylinders received yet.</p> : (
            <table>
              <thead>
                <tr><th>Date</th><th>Bill No.</th><th>Gas Type</th><th>Size</th><th>Serial Number</th><th>Quantity</th></tr>
              </thead>
              <tbody>
                {receivedTransactions.map(t => (
                  <tr key={t.line_item_id}>
                    <td>{new Date(t.date).toLocaleDateString()}</td>
                    <td>{t.bill_number}</td><td>{t.gas_type_name}</td><td>{t.size_label}</td>
                    <td>{t.serial_number}</td><td>{t.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Payment History</h2>
        <div className="table-container">
          <table>
            <thead>
              <tr><th>Receipt No.</th><th>Date</th><th>Amount</th><th>Discount</th><th>Mode</th><th>Cheque No.</th><th>Remarks</th></tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.receipt_id}>
                  <td>{p.receipt_number}</td>
                  <td>{new Date(p.date).toLocaleDateString()}</td>
                  <td>₹{p.amount_received.toFixed(2)}</td>
                  <td>₹{p.discount.toFixed(2)}</td>
                  <td>{p.payment_mode}</td>
                  <td>{p.cheque_number || '-'}</td>
                  <td>{p.remarks || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
