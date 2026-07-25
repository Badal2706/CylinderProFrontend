import { useState } from 'react'
import { apiFetch, API_URL } from '../api'

export default function PaymentFormStandalone({ customers, onSuccess, onCancel }) {
  const [formData, setFormData] = useState({
    customer_id: '',
    date: new Date().toISOString().split('T')[0],
    amount_received: '',
    discount: 0,
    payment_mode: 'CASH',
    cheque_number: '',
    remarks: ''
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.customer_id) { alert('Please select a customer'); return }
    if (formData.payment_mode === 'CHEQUE' && !formData.cheque_number) { alert('Please enter cheque number'); return }

    try {
      const res = await apiFetch(`${API_URL}/payments`, {
        method: 'POST',
        body: JSON.stringify(formData)
      })
      if (res.ok) {
        const result = await res.json()
        alert(`Payment recorded successfully! Receipt No: ${result.receipt_number}`)
        onSuccess()
      } else {
        const error = await res.json()
        alert(`Error recording payment: ${error.error}`)
      }
    } catch (err) {
      console.error('Error:', err)
      alert('Error recording payment')
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: '1rem', padding: '1.5rem', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
      <h3>Record New Payment</h3>

      <div className="form-group">
        <label>Select Customer *</label>
        <select className="form-control" value={formData.customer_id}
          onChange={(e) => setFormData({ ...formData, customer_id: e.target.value })} required>
          <option value="">-- Select Customer --</option>
          {customers.map(c => (
            <option key={c._id} value={c._id}>{c.company_name} - {c.phone_primary}</option>
          ))}
        </select>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Date *</label>
          <input type="date" className="form-control" value={formData.date}
            onChange={(e) => setFormData({ ...formData, date: e.target.value })} required />
        </div>
        <div className="form-group">
          <label>Amount Received *</label>
          <input type="number" className="form-control" value={formData.amount_received}
            onChange={(e) => setFormData({ ...formData, amount_received: e.target.value })}
            min="0" step="0.01" required />
        </div>
        <div className="form-group">
          <label>Discount</label>
          <input type="number" className="form-control" value={formData.discount}
            onChange={(e) => setFormData({ ...formData, discount: e.target.value })} min="0" step="0.01" />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Payment Mode *</label>
          <select className="form-control" value={formData.payment_mode}
            onChange={(e) => setFormData({ ...formData, payment_mode: e.target.value })} required>
            <option value="CASH">Cash</option>
            <option value="CHEQUE">Cheque</option>
            <option value="ONLINE">Online Transfer</option>
          </select>
        </div>
        {formData.payment_mode === 'CHEQUE' && (
          <div className="form-group">
            <label>Cheque Number *</label>
            <input type="text" className="form-control" value={formData.cheque_number}
              onChange={(e) => setFormData({ ...formData, cheque_number: e.target.value })} required />
          </div>
        )}
      </div>

      <div className="form-group">
        <label>Remarks</label>
        <textarea className="form-control" value={formData.remarks}
          onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
          rows="3" placeholder="Optional notes about this payment..." />
      </div>

      {formData.amount_received > 0 && (
        <div style={{ padding: '1rem', backgroundColor: '#e7f3ff', borderRadius: '4px', marginBottom: '1rem' }}>
          <p style={{ margin: 0 }}>
            <strong>Net Amount: ₹{((parseFloat(formData.amount_received) || 0) - (parseFloat(formData.discount) || 0)).toFixed(2)}</strong>
          </p>
        </div>
      )}

      <div className="btn-group">
        <button type="submit" className="btn btn-primary">💾 Save Payment</button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
