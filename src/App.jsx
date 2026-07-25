import { useState, useEffect } from 'react'
import AuthPage from './components/AuthPage'
import ClearDataModal from './components/ClearDataModal'
import Dashboard from './pages/Dashboard'
import CustomerMaster from './pages/CustomerMaster'
import CustomerDetail from './pages/CustomerDetail'
import TransactionEntry from './pages/TransactionEntry'
import Payments from './pages/Payments'
import Outstanding from './pages/Outstanding'
import Reports from './pages/Reports'

export default function App() {
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('authToken'))
  const [currentUser, setCurrentUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('currentUser')) } catch { return null }
  })
  const [currentPage, setCurrentPage] = useState('dashboard')
  const [selectedCustomerId, setSelectedCustomerId] = useState(null)
  const [showClearModal, setShowClearModal] = useState(false)

  useEffect(() => {
    const handleLogout = () => { setAuthToken(null); setCurrentUser(null) }
    window.addEventListener('auth-logout', handleLogout)
    return () => window.removeEventListener('auth-logout', handleLogout)
  }, [])

  const handleAuthSuccess = (data) => {
    localStorage.setItem('authToken', data.token)
    localStorage.setItem('currentUser', JSON.stringify({ name: data.name, email: data.email }))
    setAuthToken(data.token)
    setCurrentUser({ name: data.name, email: data.email })
  }

  const handleLogout = () => {
    localStorage.removeItem('authToken')
    localStorage.removeItem('currentUser')
    setAuthToken(null)
    setCurrentUser(null)
  }

  if (!authToken) {
    return <AuthPage onAuthSuccess={handleAuthSuccess} />
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':       return <Dashboard onNavigate={setCurrentPage} />
      case 'customers':       return <CustomerMaster onNavigate={setCurrentPage} onSelectCustomer={setSelectedCustomerId} />
      case 'customer-detail': return <CustomerDetail customerId={selectedCustomerId} onBack={() => setCurrentPage('customers')} />
      case 'new-transaction': return <TransactionEntry onBack={() => setCurrentPage('dashboard')} />
      case 'payments':        return <Payments onNavigate={setCurrentPage} />
      case 'outstanding':     return <Outstanding onNavigate={setCurrentPage} onSelectCustomer={setSelectedCustomerId} />
      case 'reports':         return <Reports />
      default:                return <Dashboard onNavigate={setCurrentPage} />
    }
  }

  const pageTitles = {
    'dashboard':       'Dashboard',
    'new-transaction': 'New Transaction',
    'payments':        'Payments',
    'outstanding':     'Outstanding Dues',
    'customers':       'Customers',
    'customer-detail': 'Customer Detail',
    'reports':         'Reports',
  }

  const navItems = [
    { key: 'dashboard',       icon: '🏠', label: 'Dashboard' },
    { key: 'new-transaction', icon: '🧾', label: 'New Transaction' },
    { key: 'payments',        icon: '💰', label: 'Payments' },
    { key: 'outstanding',     icon: '📊', label: 'Outstanding' },
    { key: 'customers',       icon: '👥', label: 'Customers' },
    { key: 'reports',         icon: '📈', label: 'Reports' },
  ]

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

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
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="sidebar-clear" onClick={() => setShowClearModal(true)} title="Clear all data">🗑️</button>
            <button className="sidebar-logout" style={{ flex: 1 }} onClick={handleLogout}>Sign Out</button>
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
            setShowClearModal(false)
            setCurrentPage('dashboard')
            alert('All data has been cleared.')
          }}
        />
      )}
    </div>
  )
}
