import { useState } from 'react'
import { apiFetch, API_URL } from '../api'

export default function ClearDataModal({ onClose, onCleared }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  const handleClear = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await apiFetch(`${API_URL}/auth/clear-data`, {
        method: 'POST',
        body: JSON.stringify({ password })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Something went wrong')
      } else {
        onCleared()
      }
    } catch {
      setError('Network error')
    }
    setLoading(false)
  }

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
            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <p style={{ marginBottom: '1rem', color: 'var(--text-2)' }}>
                Are you sure you want to delete all your data?
              </p>
              <div className="btn-group" style={{ justifyContent: 'center' }}>
                <button className="btn btn-danger" onClick={() => setConfirmed(true)}>
                  Yes, I want to clear all data
                </button>
                <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleClear} style={{ marginTop: '1rem' }}>
              <div className="form-group">
                <label>Enter your password to confirm</label>
                <input type="password" className="form-control" value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your account password" autoFocus required />
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
  )
}
