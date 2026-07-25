import { useState, useEffect } from 'react'
import { apiFetch, API_URL, exportToExcel } from '../api'
import CustomerForm from '../components/CustomerForm'

export default function CustomerMaster({ onNavigate, onSelectCustomer }) {
  const [customers, setCustomers] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchCustomers() }, [searchTerm, statusFilter])

  const fetchCustomers = async () => {
    try {
      let url = `${API_URL}/customers?`
      if (searchTerm) url += `search=${searchTerm}&`
      if (statusFilter) url += `status=${statusFilter}`
      const res = await apiFetch(url)
      setCustomers(await res.json())
      setLoading(false)
    } catch (err) {
      console.error('Error fetching customers:', err)
      setLoading(false)
    }
  }

  if (loading) return <div className="loading">Loading customers...</div>

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
            onSuccess={() => { setShowForm(false); fetchCustomers() }}
            onCancel={() => setShowForm(false)}
          />
        )}
      </div>

      <div className="card">
        <div className="search-bar">
          <input type="text" placeholder="Search by name, contact, or TIN..."
            value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="form-control" />
        </div>

        <div className="btn-group">
          {['', 'ACTIVE', 'OVER_LIMIT', 'ZERO_BALANCE'].map((f, i) => (
            <button key={f} className={`btn ${statusFilter === f ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setStatusFilter(f)}>
              {['All', 'Active', 'Over Limit', 'Zero Balance'][i]}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
          <button className="btn btn-secondary" onClick={() => exportToExcel(
            customers.map((c, i) => ({
              'Sr.': i + 1,
              'Company Name': c.company_name,
              'Contact Person': c.contact_person || '',
              'Phone': c.phone_primary || '',
              'Holding Limit': c.holding_limit || 0,
              'Cylinders Held': c.cylinders_held || 0,
              'Bill Amount': c.current_bill_amount || 0,
              'Security Deposit': c.security_deposit || 0,
              'Status': c.status || ''
            })), 'Customers_List', 'Customers'
          )}>Export Excel</button>
        </div>

        <div className="table-container" style={{ marginTop: '1rem' }}>
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
                <th>Deposit</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c, index) => (
                <tr key={c.customer_id}
                  className={c.status === 'OVER LIMIT' ? 'row-over-limit' : c.current_bill_amount < 0 ? 'row-credit' : ''}>
                  <td>{index + 1}</td>
                  <td>{c.company_name}</td>
                  <td>{c.contact_person}</td>
                  <td>{c.phone_primary}</td>
                  <td>{c.holding_limit}</td>
                  <td>{c.cylinders_held}</td>
                  <td>₹{c.current_bill_amount?.toFixed(2)}</td>
                  <td>₹{c.security_deposit?.toFixed(2)}</td>
                  <td>
                    {c.status === 'OVER LIMIT' && <span className="badge badge-danger">OVER LIMIT</span>}
                    {c.status === 'ACTIVE' && <span className="badge badge-success">ACTIVE</span>}
                  </td>
                  <td>
                    <button className="btn btn-primary" onClick={() => {
                      onSelectCustomer(c.customer_id)
                      onNavigate('customer-detail')
                    }}>View Detail</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
