const { useState, useEffect } = React;

const API_URL = 'http://localhost:3001/api';

// Authenticated fetch — adds Bearer token from localStorage automatically
async function apiFetch(url, options = {}) {
  const token = localStorage.getItem('authToken');
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    window.dispatchEvent(new Event('auth-logout'));
  }
  return res;
}

// Excel export helper — uses SheetJS (loaded via CDN)
function exportToExcel(rows, filename, sheetName) {
  if (!rows || rows.length === 0) { alert('No data to export'); return; }
  try {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, (sheetName || 'Data').substring(0, 31));
    XLSX.writeFile(wb, `${filename}.xlsx`);
  } catch (err) {
    console.error('Excel export error:', err);
    alert('Excel export failed: ' + err.message);
  }
}

// Auth Page Component
function AuthPage({ onAuthSuccess }) {
  const [mode, setMode] = useState('signin');
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const body = mode === 'signup'
        ? { name: formData.name, email: formData.email, password: formData.password }
        : { email: formData.email, password: formData.password };

      const res = await fetch(`${API_URL}/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong');
      } else {
        onAuthSuccess(data);
      }
    } catch {
      setError('Network error. Is the server running?');
    }
    setLoading(false);
  };

  const switchMode = () => {
    setMode(mode === 'signin' ? 'signup' : 'signin');
    setError('');
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo">🔵</div>
          <h1>CylinderPro</h1>
          <p>Gas Cylinder Management System</p>
        </div>

        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${mode === 'signin' ? 'active' : ''}`}
            onClick={() => { setMode('signin'); setError(''); }}
          >Sign In</button>
          <button
            type="button"
            className={`auth-tab ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => { setMode('signup'); setError(''); }}
          >Sign Up</button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {mode === 'signup' && (
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
              placeholder={mode === 'signup' ? 'Minimum 6 characters' : 'Your password'}
              required
            />
          </div>

          {error && <div className="alert alert-danger" style={{marginBottom: '1rem'}}>{error}</div>}

          <button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
            {loading ? 'Please wait...' : (mode === 'signin' ? 'Sign In' : 'Create Account')}
          </button>
        </form>

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
function ClearDataModal({ onClose, onCleared }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const handleClear = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch(`${API_URL}/auth/clear-data`, {
        method: 'POST',
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
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
                <button type="submit" className="btn btn-danger" disabled={loading}>
                  {loading ? 'Deleting...' : 'Delete All My Data'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// Outstanding Receivables Component
function OutstandingReceivables({ onNavigate, onSelectCustomer }) {
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

  const toggle = (item) => {
    setSelectedCustomer(
      selectedCustomer && selectedCustomer.customer_id === item.customer_id ? null : item
    );
  };

  if (loading) return <div className="loading">Loading outstanding amounts...</div>;

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
                'Phone': r.phone_primary || '',
                'Total Billed': r.total_billed || 0,
                'Total Paid': r.total_paid || 0,
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
                {data.map((item, index) => (
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
                    <td>{item.phone_primary || '-'}</td>
                    <td>₹{(item.total_billed || 0).toFixed(2)}</td>
                    <td>₹{(item.total_paid || 0).toFixed(2)}</td>
                    <td><strong style={{color: '#e74c3c'}}>₹{(item.outstanding_amount || 0).toFixed(2)}</strong></td>
                    <td>
                      <button
                        className="btn btn-primary"
                        style={{padding: '0.25rem 0.75rem', fontSize: '0.875rem'}}
                        onClick={() => toggle(item)}
                      >
                        {selectedCustomer && selectedCustomer.customer_id === item.customer_id ? 'Cancel' : 'Record Payment'}
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
          </div>
        )}
      </div>

      {selectedCustomer && (
        <div className="card" style={{borderLeft: '4px solid #27ae60'}}>
          <h3>
            Record Payment — {selectedCustomer.company_name}
            {selectedCustomer.customer_type === 'ONE_TIME' && (
              <span className="badge badge-warning" style={{marginLeft: '0.5rem', fontSize: '0.8rem'}}>One-Time</span>
            )}
          </h3>
          <p style={{color: '#7f8c8d', marginBottom: '1rem'}}>
            Outstanding: <strong style={{color: '#e74c3c'}}>₹{selectedCustomer.outstanding_amount.toFixed(2)}</strong>
          </p>
          <PaymentForm
            customerId={String(selectedCustomer.customer_id)}
            onSuccess={() => { setSelectedCustomer(null); fetchOutstanding(); }}
            onCancel={() => setSelectedCustomer(null)}
          />
        </div>
      )}
    </div>
  );
}

// Main App Component
function App() {
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('authToken'));
  const [currentUser, setCurrentUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('currentUser')); } catch { return null; }
  });
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [showClearModal, setShowClearModal] = useState(false);

  useEffect(() => {
    const handleLogout = () => { setAuthToken(null); setCurrentUser(null); };
    window.addEventListener('auth-logout', handleLogout);
    return () => window.removeEventListener('auth-logout', handleLogout);
  }, []);

  const handleAuthSuccess = (data) => {
    localStorage.setItem('authToken', data.token);
    localStorage.setItem('currentUser', JSON.stringify({ name: data.name, email: data.email }));
    setAuthToken(data.token);
    setCurrentUser({ name: data.name, email: data.email });
  };

  const handleLogout = () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    setAuthToken(null);
    setCurrentUser(null);
  };

  if (!authToken) {
    return <AuthPage onAuthSuccess={handleAuthSuccess} />;
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard onNavigate={setCurrentPage} />;
      case 'customers':
        return <CustomerMaster onNavigate={setCurrentPage} onSelectCustomer={setSelectedCustomerId} />;
      case 'customer-detail':
        return <CustomerDetail customerId={selectedCustomerId} onBack={() => setCurrentPage('customers')} />;
      case 'new-transaction':
        return <TransactionEntry onBack={() => setCurrentPage('dashboard')} />;
      case 'payments':
        return <Payments onNavigate={setCurrentPage} />;
      case 'outstanding':
        return <OutstandingReceivables onNavigate={setCurrentPage} onSelectCustomer={setSelectedCustomerId} />;
      case 'reports':
        return <Reports />;
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
    'reports':         'Reports',
  };

  const navItems = [
    { key: 'dashboard',       icon: '🏠', label: 'Dashboard' },
    { key: 'new-transaction', icon: '🧾', label: 'New Transaction' },
    { key: 'payments',        icon: '💰', label: 'Payments' },
    { key: 'outstanding',     icon: '📊', label: 'Outstanding' },
    { key: 'customers',       icon: '👥', label: 'Customers' },
    { key: 'reports',         icon: '📈', label: 'Reports' },
  ];

  const today = new Date().toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  return (
    <div className="app-shell">
      <aside className="sidebar">
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
              className={`nav-link ${currentPage === item.key ? 'active' : ''}`}
              onClick={() => setCurrentPage(item.key)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-name">{currentUser?.name || 'User'}</div>
            <div className="sidebar-user-email">{currentUser?.email || ''}</div>
          </div>
          <div style={{display:'flex', gap:'0.5rem'}}>
            <button className="sidebar-clear" onClick={() => setShowClearModal(true)} title="Clear all data">🗑️</button>
            <button className="sidebar-logout" style={{flex:1}} onClick={handleLogout}>Sign Out</button>
          </div>
        </div>
      </aside>

      <div className="main-content">
        <div className="topbar">
          <span className="topbar-title">{pageTitles[currentPage] || 'CylinderPro'}</span>
          <span className="topbar-date">{today}</span>
        </div>
        <div className="container">
          {renderPage()}
        </div>
      </div>

      {showClearModal && (
        <ClearDataModal
          onClose={() => setShowClearModal(false)}
          onCleared={() => {
            setShowClearModal(false);
            setCurrentPage('dashboard');
            alert('All data has been cleared.');
          }}
        />
      )}
    </div>
  );
}

// Dashboard Component
function Dashboard({ onNavigate }) {
  const [stats, setStats] = useState(null);
  const [overLimitCustomers, setOverLimitCustomers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [statsRes, overLimitRes] = await Promise.all([
        apiFetch(`${API_URL}/dashboard/stats`),
        apiFetch(`${API_URL}/dashboard/over-limit`)
      ]);
      setStats(await statsRes.json());
      setOverLimitCustomers(await overLimitRes.json());
      setLoading(false);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading dashboard...</div>;
  }

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
                {overLimitCustomers.map(customer => (
                  <tr key={customer.customer_id} className="row-over-limit">
                    <td>{customer.company_name}</td>
                    <td>{customer.cylinders_held}</td>
                    <td>{customer.holding_limit}</td>
                    <td><strong>{customer.cylinders_held - customer.holding_limit}</strong></td>
                    <td>{customer.phone_primary}</td>
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
function CustomerMaster({ onNavigate, onSelectCustomer }) {
  const [customers, setCustomers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCustomers();
  }, [searchTerm, statusFilter]);

  const fetchCustomers = async () => {
    try {
      let url = `${API_URL}/customers?`;
      if (searchTerm) url += `search=${searchTerm}&`;
      if (statusFilter) url += `status=${statusFilter}`;

      const response = await apiFetch(url);
      const data = await response.json();
      setCustomers(data);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching customers:', error);
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading customers...</div>;
  }

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
        <div className="search-bar">
          <input
            type="text"
            placeholder="Search by name, contact, or TIN..."
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
        </div>

        <div style={{display:'flex', justifyContent:'flex-end', marginBottom:'0.5rem'}}>
          <button className="btn btn-secondary" onClick={() => exportToExcel(
            customers.map((c,i) => ({
              'Sr.': i+1,
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
                <th>Deposit</th>
                <th>Status</th>
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
                  <td>{customer.company_name}</td>
                  <td>{customer.contact_person}</td>
                  <td>{customer.phone_primary}</td>
                  <td>{customer.holding_limit}</td>
                  <td>{customer.cylinders_held}</td>
                  <td>₹{customer.current_bill_amount?.toFixed(2)}</td>
                  <td>₹{customer.security_deposit?.toFixed(2)}</td>
                  <td>
                    {customer.status === 'OVER LIMIT' && (
                      <span className="badge badge-danger">OVER LIMIT</span>
                    )}
                    {customer.status === 'ACTIVE' && (
                      <span className="badge badge-success">ACTIVE</span>
                    )}
                  </td>
                  <td>
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        onSelectCustomer(customer.customer_id);
                        onNavigate('customer-detail');
                      }}
                    >
                      View Detail
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Customer Form Component
function CustomerForm({ onSuccess, onCancel, customer = null }) {
  const [formData, setFormData] = useState({
    company_name: customer?.company_name || '',
    contact_person: customer?.contact_person || '',
    phone_primary: customer?.phone_primary || '',
    phone_alternate: customer?.phone_alternate || '',
    address: customer?.address || '',
    tin_number: customer?.tin_number || '',
    security_deposit: customer?.security_deposit || 0,
    holding_limit: customer?.holding_limit || 0,
    is_active: customer?.is_active !== undefined ? customer.is_active : 1
  });

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const url = customer
        ? `${API_URL}/customers/${customer.customer_id}`
        : `${API_URL}/customers`;
      const method = customer ? 'PUT' : 'POST';

      const response = await apiFetch(url, {
        method,
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        alert(customer ? 'Customer updated successfully!' : 'Customer added successfully!');
        onSuccess();
      } else {
        alert('Error saving customer');
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error saving customer');
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{marginTop: '1rem'}}>
      <div className="form-row">
        <div className="form-group">
          <label>Company / Customer Name *</label>
          <input type="text" name="company_name" value={formData.company_name}
            onChange={handleChange} className="form-control" required />
        </div>
        <div className="form-group">
          <label>Contact Person *</label>
          <input type="text" name="contact_person" value={formData.contact_person}
            onChange={handleChange} className="form-control" required />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Primary Contact Number *</label>
          <input type="tel" name="phone_primary" value={formData.phone_primary}
            onChange={handleChange} className="form-control" required />
        </div>
        <div className="form-group">
          <label>Alternate Contact Number</label>
          <input type="tel" name="phone_alternate" value={formData.phone_alternate}
            onChange={handleChange} className="form-control" />
        </div>
      </div>

      <div className="form-group">
        <label>Address *</label>
        <textarea name="address" value={formData.address}
          onChange={handleChange} className="form-control" rows="3" required />
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>TIN Number</label>
          <input type="text" name="tin_number" value={formData.tin_number}
            onChange={handleChange} className="form-control" />
        </div>
        <div className="form-group">
          <label>Security Deposit</label>
          <input type="number" name="security_deposit" value={formData.security_deposit}
            onChange={handleChange} className="form-control" min="0" step="0.01" />
        </div>
      </div>

      <div className="form-group">
        <label>Holding Limit (Max Cylinders) *</label>
        <input type="number" name="holding_limit" value={formData.holding_limit}
          onChange={handleChange} className="form-control" min="0" required />
      </div>

      <div className="btn-group">
        <button type="submit" className="btn btn-primary">
          {customer ? 'Update Customer' : 'Save Customer'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// Render the app
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
