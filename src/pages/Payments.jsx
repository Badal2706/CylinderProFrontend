import { useState, useEffect } from 'react'
import { apiFetch, API_URL, exportToExcel } from '../api'
import PaymentFormStandalone from '../components/PaymentFormStandalone'

export default function Payments({ onNavigate }) {
  const [payments, setPayments] = useState([])
  const [customers, setCustomers] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => { fetchPayments(); fetchCustomers() }, [])

  const fetchPayments = async () => {
    try {
      const res = await apiFetch(`${API_URL}/payments`)
      setPayments(await res.json())
      setLoading(false)
    } catch (err) { console.error('Error fetching payments:', err); setLoading(false) }
  }

  const fetchCustomers = async () => {
    try {
      const res = await apiFetch(`${API_URL}/customers`)
      setCustomers(await res.json())
    } catch (err) { console.error('Error fetching customers:', err) }
  }

  const filteredPayments = payments.filter(p =>
    p.company_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.receipt_number.toLowerCase().includes(searchTerm.toLowerCase())
  )

  if (loading) return <div className="loading">Loading payments...</div>

  return (
    <div>
      <div className="card">
        <h2>Payment Management</h2>
        <div className="btn-group">
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : '💰 Record New Payment'}
          </button>
          {payments.length > 0 && (
            <button className="btn btn-secondary" onClick={() => exportToExcel(
              payments.map(p => ({
                'Receipt No.': p.receipt_number,
                'Date': new Date(p.date).toLocaleDateString(),
                'Customer': p.company_name,
                'Bill No.': p.bill_number || '',
                'Amount Received': p.amount_received || 0,
                'Discount': p.discount || 0,
                'Net Amount': (p.amount_received || 0) - (p.discount || 0),
                'Payment Mode': p.payment_mode,
                'Cheque No.': p.cheque_number || '',
                'Remarks': p.remarks || ''
              })), 'Payments_History', 'Payments'
            )}>Export Excel</button>
          )}
        </div>

        {showForm && (
          <PaymentFormStandalone customers={customers}
            onSuccess={() => { setShowForm(false); fetchPayments() }}
            onCancel={() => setShowForm(false)} />
        )}
      </div>

      <div className="card">
        <h3>Payment History</h3>
        <div className="search-bar">
          <input type="text" placeholder="Search by customer name or receipt number..."
            value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="form-control" />
        </div>

        <div className="table-container" style={{ marginTop: '1rem' }}>
          {filteredPayments.length === 0 ? <p>No payments recorded yet.</p> : (
            <table>
              <thead>
                <tr>
                  <th>Receipt No.</th><th>Date</th><th>Customer Name</th><th>Bill No.</th>
                  <th>Amount Received</th><th>Discount</th><th>Net Amount</th>
                  <th>Payment Mode</th><th>Cheque No.</th><th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayments.map(p => (
                  <tr key={p._id}>
                    <td><strong>{p.receipt_number}</strong></td>
                    <td>{new Date(p.date).toLocaleDateString()}</td>
                    <td>{p.company_name}</td>
                    <td>{p.bill_number || '-'}</td>
                    <td>₹{(p.amount_received || 0).toFixed(2)}</td>
                    <td>₹{(p.discount || 0).toFixed(2)}</td>
                    <td><strong>₹{((p.amount_received || 0) - (p.discount || 0)).toFixed(2)}</strong></td>
                    <td>{p.payment_mode}</td>
                    <td>{p.cheque_number || '-'}</td>
                    <td>{p.remarks || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
          <h4>Summary</h4>
          <p><strong>Total Payments:</strong> {filteredPayments.length}</p>
          <p><strong>Total Amount Received:</strong> ₹{filteredPayments.reduce((s, p) => s + (p.amount_received || 0), 0).toFixed(2)}</p>
          <p><strong>Total Discount Given:</strong> ₹{filteredPayments.reduce((s, p) => s + (p.discount || 0), 0).toFixed(2)}</p>
          <p><strong>Net Amount:</strong> ₹{filteredPayments.reduce((s, p) => s + (p.amount_received || 0) - (p.discount || 0), 0).toFixed(2)}</p>
        </div>
      </div>
    </div>
  )
}
