import { useState } from 'react'
import { apiFetch, API_URL } from '../api'

export default function CustomerForm({ onSuccess, onCancel, customer = null }) {
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
  })

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value })

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      const url = customer ? `${API_URL}/customers/${customer.customer_id}` : `${API_URL}/customers`
      const method = customer ? 'PUT' : 'POST'
      const res = await apiFetch(url, { method, body: JSON.stringify(formData) })
      if (res.ok) {
        alert(customer ? 'Customer updated successfully!' : 'Customer added successfully!')
        onSuccess()
      } else {
        alert('Error saving customer')
      }
    } catch (err) {
      console.error('Error:', err)
      alert('Error saving customer')
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: '1rem' }}>
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
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
