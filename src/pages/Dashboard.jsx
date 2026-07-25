import { useState, useEffect } from 'react'
import { apiFetch, API_URL } from '../api'

export default function Dashboard({ onNavigate }) {
  const [stats, setStats] = useState(null)
  const [overLimitCustomers, setOverLimitCustomers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchDashboardData() }, [])

  const fetchDashboardData = async () => {
    try {
      const [statsRes, overLimitRes] = await Promise.all([
        apiFetch(`${API_URL}/dashboard/stats`),
        apiFetch(`${API_URL}/dashboard/over-limit`)
      ])
      setStats(await statsRes.json())
      setOverLimitCustomers(await overLimitRes.json())
      setLoading(false)
    } catch (err) {
      console.error('Error fetching dashboard data:', err)
      setLoading(false)
    }
  }

  if (loading) return <div className="loading">Loading dashboard...</div>

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card green">
          <div className="stat-icon">💸</div>
          <div className="stat-body">
            <h3>Outstanding</h3>
            <div className="value">₹{(stats?.total_outstanding || 0).toFixed(0)}</div>
          </div>
        </div>
        <div className="stat-card blue">
          <div className="stat-icon">👥</div>
          <div className="stat-body">
            <h3>Customers</h3>
            <div className="value">{stats?.total_customers || 0}</div>
          </div>
        </div>
        <div className="stat-card orange">
          <div className="stat-icon">🔵</div>
          <div className="stat-body">
            <h3>Cylinders Out</h3>
            <div className="value">{stats?.total_cylinders_out || 0}</div>
          </div>
        </div>
        <div className="stat-card purple">
          <div className="stat-icon">⚠️</div>
          <div className="stat-body">
            <h3>Over Limit</h3>
            <div className="value">{overLimitCustomers.length}</div>
          </div>
        </div>
        <div className="stat-card green">
          <div className="stat-icon">📋</div>
          <div className="stat-body">
            <h3>Today's Bills</h3>
            <div className="value">{stats?.today_transactions || 0}</div>
          </div>
        </div>
        <div className="stat-card blue">
          <div className="stat-icon">🏦</div>
          <div className="stat-body">
            <h3>Security Deposit</h3>
            <div className="value">₹{(stats?.total_security_deposit || 0).toFixed(0)}</div>
          </div>
        </div>
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
                {overLimitCustomers.map(c => (
                  <tr key={c.customer_id} className="row-over-limit">
                    <td>{c.company_name}</td>
                    <td>{c.cylinders_held}</td>
                    <td>{c.holding_limit}</td>
                    <td><strong>{c.cylinders_held - c.holding_limit}</strong></td>
                    <td>{c.phone_primary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
