import { useState } from 'react'
import { apiFetch, API_URL } from '../api'

export default function PaymentForm({ customerId, onSuccess, onCancel }) {
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    amount_received: '',
    discount: 0,
    payment_mode: 'CASH',
    cheque_number: '',
    remarks: ''
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      const res = await apiFetch(`${API_URL}/payments`, {
        method: 'POST',
        body: JSON.stringify({ ...formData, customer_id: customerId })
      })
      if (res.ok) {
        alert('Payment recorded successfully!')
        onSuccess()
      } else {
        alert('Error recording payment')
      }
    } catch (err) {
      console.error('Error:', err)
      alert('Error recording payment')
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
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

        <div className="form-group">
          <label>Discount</label>
          <input type="number" className="form-control" value={formData.discount}
            onChange={(e) => setFormData({ ...formData, discount: e.target.value })} min="0" step="0.01" />
        </div>
      </div>

      <div className="form-group">
        <label>Remarks</label>
        <textarea className="form-control" value={formData.remarks}
          onChange={(e) => setFormData({ ...formData, remarks: e.target.value })} rows="2" />
      </div>

      <div className="btn-group">
        <button type="submit" className="btn btn-primary">Save Payment</button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
