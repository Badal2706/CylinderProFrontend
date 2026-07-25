import { useState, useEffect } from 'react'
import { apiFetch, API_URL, exportToExcel } from '../api'
import PaymentForm from '../components/PaymentForm'

export default function Outstanding({ onNavigate, onSelectCustomer }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedCustomer, setSelectedCustomer] = useState(null)

  useEffect(() => { fetchOutstanding() }, [])

  const fetchOutstanding = async () => {
    try {
      const res = await apiFetch(`${API_URL}/reports/outstanding`)
      setData(await res.json())
      setLoading(false)
    } catch (err) { console.error('Error fetching outstanding:', err); setLoading(false) }
  }

  const totalOutstanding = data.reduce((s, c) => s + (c.outstanding_amount || 0), 0)
  const totalBilled = data.reduce((s, c) => s + (c.total_billed || 0), 0)
  const totalPaid = data.reduce((s, c) => s + (c.total_paid || 0), 0)

  const toggle = (item) => {
    setSelectedCustomer(
      selectedCustomer && selectedCustomer.customer_id === item.customer_id ? null : item
    )
  }

  if (loading) return <div className="loading">Loading outstanding amounts...</div>

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>Outstanding Receivables — Money to Collect</h2>
          {data.length > 0 && (
            <button className="btn btn-secondary" onClick={() => exportToExcel(
              data.map((r, i) => ({
                'Sr.': i + 1, 'Customer': r.company_name, 'Type': r.customer_type,
                'Contact': r.contact_person || '', 'Phone': r.phone_primary || '',
                'Total Billed': r.total_billed || 0, 'Total Paid': r.total_paid || 0,
                'Outstanding': r.outstanding_amount || 0
              })), 'Outstanding_Dues', 'Outstanding'
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
                  <th>Sr.</th><th>Customer Name</th><th>Type</th><th>Contact</th><th>Phone</th>
                  <th>Total Billed</th><th>Total Paid</th><th>Outstanding</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.map((item, index) => (
                  <tr key={String(item.customer_id)}
                    style={selectedCustomer?.customer_id === item.customer_id ? { backgroundColor: '#e8f5e9' } : {}}>
                    <td>{index + 1}</td>
                    <td>
                      {item.customer_type === 'REGULAR' ? (
                        <span className="clickable" onClick={() => {
                          onSelectCustomer(String(item.customer_id))
                          onNavigate('customer-detail')
                        }}>{item.company_name}</span>
                      ) : item.company_name}
                    </td>
                    <td>
                      {item.customer_type === 'ONE_TIME'
                        ? <span className="badge badge-warning">One-Time</span>
                        : <span className="badge badge-success">Regular</span>}
                    </td>
                    <td>{item.contact_person || '-'}</td>
                    <td>{item.phone_primary || '-'}</td>
                    <td>₹{(item.total_billed || 0).toFixed(2)}</td>
                    <td>₹{(item.total_paid || 0).toFixed(2)}</td>
                    <td><strong style={{ color: '#e74c3c' }}>₹{(item.outstanding_amount || 0).toFixed(2)}</strong></td>
                    <td>
                      <button className="btn btn-primary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}
                        onClick={() => toggle(item)}>
                        {selectedCustomer?.customer_id === item.customer_id ? 'Cancel' : 'Record Payment'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: '#34495e', color: 'white', fontWeight: 'bold' }}>
                  <td colSpan="5">TOTAL</td>
                  <td>₹{totalBilled.toFixed(2)}</td>
                  <td>₹{totalPaid.toFixed(2)}</td>
                  <td>₹{totalOutstanding.toFixed(2)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {selectedCustomer && (
        <div className="card" style={{ borderLeft: '4px solid #27ae60' }}>
          <h3>
            Record Payment — {selectedCustomer.company_name}
            {selectedCustomer.customer_type === 'ONE_TIME' && (
              <span className="badge badge-warning" style={{ marginLeft: '0.5rem', fontSize: '0.8rem' }}>One-Time</span>
            )}
          </h3>
          <p style={{ color: '#7f8c8d', marginBottom: '1rem' }}>
            Outstanding: <strong style={{ color: '#e74c3c' }}>₹{selectedCustomer.outstanding_amount.toFixed(2)}</strong>
          </p>
          <PaymentForm customerId={String(selectedCustomer.customer_id)}
            onSuccess={() => { setSelectedCustomer(null); fetchOutstanding() }}
            onCancel={() => setSelectedCustomer(null)} />
        </div>
      )}
    </div>
  )
}
