import { useState, useEffect } from 'react'
import { apiFetch, API_URL } from '../api'
import CylinderItem from '../components/CylinderItem'
import PaymentForm from '../components/PaymentForm'

export default function TransactionEntry({ onBack }) {
  const [customerType, setCustomerType] = useState('REGULAR')
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [customers, setCustomers] = useState([])
  const [transactionType, setTransactionType] = useState('GIVEN')
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0])
  const [remarks, setRemarks] = useState('')
  const [givenItems, setGivenItems] = useState([])
  const [receivedItems, setReceivedItems] = useState([])
  const [gasTypes, setGasTypes] = useState([])
  const [cylinderSizes, setCylinderSizes] = useState([])
  const [oneTimeCustomer, setOneTimeCustomer] = useState({ company_name: '', contact_person: '', phone_primary: '', address: '' })
  const [savedBill, setSavedBill] = useState(null)
  const [showPostSavePaymentForm, setShowPostSavePaymentForm] = useState(false)

  useEffect(() => {
    fetchCustomers()
    fetchMasterData()
  }, [])

  const fetchCustomers = async () => {
    try {
      const res = await apiFetch(`${API_URL}/customers`)
      setCustomers(await res.json())
    } catch (err) { console.error('Error fetching customers:', err) }
  }

  const fetchMasterData = async () => {
    try {
      const [gasRes, sizeRes] = await Promise.all([
        apiFetch(`${API_URL}/masters/gas-types`),
        apiFetch(`${API_URL}/masters/cylinder-sizes`)
      ])
      setGasTypes(await gasRes.json())
      setCylinderSizes(await sizeRes.json())
    } catch (err) { console.error('Error fetching master data:', err) }
  }

  const addGivenItem = () => setGivenItems([...givenItems, { gas_type_id: '', cylinder_size_id: '', serial_numbers: [], quantity: 0, rate: 0, amount: 0, direction: 'GIVEN', serialInput: '' }])
  const addReceivedItem = () => setReceivedItems([...receivedItems, { gas_type_id: '', cylinder_size_id: '', serial_numbers: [], quantity: 0, direction: 'RECEIVED', serialInput: '' }])

  const updateItem = (items, setItems, index, field, value) => {
    const updated = [...items]
    updated[index][field] = value
    if (field === 'quantity' || field === 'rate') {
      updated[index].amount = updated[index].quantity * updated[index].rate
    }
    setItems(updated)
  }

  const addSerialNumber = (items, setItems, index) => {
    const serial = items[index].serialInput.trim()
    if (!serial) return
    const updated = [...items]
    updated[index].serial_numbers.push(serial)
    updated[index].quantity = updated[index].serial_numbers.length
    updated[index].serialInput = ''
    if (updated[index].direction === 'GIVEN') {
      updated[index].amount = updated[index].quantity * updated[index].rate
    }
    setItems(updated)
  }

  const removeSerialNumber = (items, setItems, itemIndex, serialIndex) => {
    const updated = [...items]
    updated[itemIndex].serial_numbers.splice(serialIndex, 1)
    updated[itemIndex].quantity = updated[itemIndex].serial_numbers.length
    if (updated[itemIndex].direction === 'GIVEN') {
      updated[itemIndex].amount = updated[itemIndex].quantity * updated[itemIndex].rate
    }
    setItems(updated)
  }

  const totalGiven = givenItems.reduce((s, i) => s + i.quantity, 0)
  const totalReceived = receivedItems.reduce((s, i) => s + i.quantity, 0)
  const totalAmount = givenItems.reduce((s, i) => s + i.amount, 0)
  const newCylinderHold = (selectedCustomer?.cylinders_held || 0) + totalGiven - totalReceived
  const isOverLimit = selectedCustomer && newCylinderHold > selectedCustomer.holding_limit

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (customerType === 'REGULAR' && !selectedCustomer) { alert('Please select a customer'); return }
    if (customerType === 'ONE_TIME' && !oneTimeCustomer.company_name) { alert('Please enter customer details'); return }
    if (givenItems.length === 0 && receivedItems.length === 0) { alert('Please add at least one cylinder'); return }
    for (const item of [...givenItems, ...receivedItems]) {
      if (item.serial_numbers.length === 0) { alert('Please add serial numbers for all cylinders'); return }
    }

    const billData = {
      customer_id: selectedCustomer?.customer_id,
      customer_type: customerType,
      one_time_customer: customerType === 'ONE_TIME' ? oneTimeCustomer : null,
      bill_date: billDate,
      transaction_type: transactionType,
      remarks,
      given_items: givenItems.length > 0 ? givenItems : null,
      received_items: receivedItems.length > 0 ? receivedItems : null
    }

    try {
      const res = await apiFetch(`${API_URL}/bills`, { method: 'POST', body: JSON.stringify(billData) })
      if (res.ok) {
        const result = await res.json()
        setSavedBill({
          bill_id: result.bill_id,
          bill_number: result.bill_number,
          amount: totalAmount,
          customer_id: selectedCustomer?.customer_id,
          customer_name: selectedCustomer?.company_name
        })
      } else { alert('Error creating bill') }
    } catch (err) { console.error('Error:', err); alert('Error creating bill') }
  }

  if (savedBill) {
    return (
      <div className="card">
        <div className="alert alert-success">
          Bill <strong>{savedBill.bill_number}</strong> created successfully!
          {savedBill.amount > 0 && <span> &nbsp; Bill Amount: <strong>₹{savedBill.amount.toFixed(2)}</strong></span>}
          {savedBill.customer_name && <span> &nbsp; Customer: <strong>{savedBill.customer_name}</strong></span>}
        </div>

        {!showPostSavePaymentForm ? (
          <div>
            <p style={{ margin: '1rem 0' }}>Would you like to record payment received for this bill?</p>
            <div className="btn-group">
              {savedBill.customer_id && (
                <button className="btn btn-primary" onClick={() => setShowPostSavePaymentForm(true)}>
                  Record Payment Now
                </button>
              )}
              <button className="btn btn-secondary" onClick={onBack}>Skip — Back to Dashboard</button>
            </div>
          </div>
        ) : (
          <div>
            <h3 style={{ margin: '1rem 0 0.5rem' }}>Record Payment Received</h3>
            <PaymentForm customerId={savedBill.customer_id} onSuccess={onBack}
              onCancel={() => setShowPostSavePaymentForm(false)} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="card">
      <h2>New Transaction / Bill</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Customer Type</label>
          <div>
            <label style={{ marginRight: '1rem' }}>
              <input type="radio" value="REGULAR" checked={customerType === 'REGULAR'}
                onChange={(e) => setCustomerType(e.target.value)} /> Regular Customer
            </label>
            <label>
              <input type="radio" value="ONE_TIME" checked={customerType === 'ONE_TIME'}
                onChange={(e) => setCustomerType(e.target.value)} /> One-Time Customer
            </label>
          </div>
        </div>

        {customerType === 'REGULAR' && (
          <div className="form-group">
            <label>Search Customer</label>
            <select className="form-control" onChange={(e) => {
              const c = customers.find(c => c.customer_id === e.target.value)
              setSelectedCustomer(c)
            }}>
              <option value="">-- Select Customer --</option>
              {customers.map(c => (
                <option key={c.customer_id} value={c.customer_id}>{c.company_name} - {c.phone_primary}</option>
              ))}
            </select>

            {selectedCustomer && (
              <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
                <p><strong>Name:</strong> {selectedCustomer.company_name}</p>
                <p><strong>Contact:</strong> {selectedCustomer.phone_primary}</p>
                <p><strong>Current Bill Amount:</strong> ₹{selectedCustomer.current_bill_amount?.toFixed(2)}</p>
                <p><strong>Cylinders Held:</strong> {selectedCustomer.cylinders_held}</p>
                <p><strong>Holding Limit:</strong> {selectedCustomer.holding_limit}</p>
                {selectedCustomer.status === 'OVER LIMIT' && <p style={{ color: 'red' }}><strong>Status: OVER LIMIT</strong></p>}
              </div>
            )}
          </div>
        )}

        {customerType === 'ONE_TIME' && (
          <div>
            <div className="form-row">
              <div className="form-group">
                <label>Customer Name *</label>
                <input type="text" className="form-control" value={oneTimeCustomer.company_name}
                  onChange={(e) => setOneTimeCustomer({ ...oneTimeCustomer, company_name: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Contact Person</label>
                <input type="text" className="form-control" value={oneTimeCustomer.contact_person}
                  onChange={(e) => setOneTimeCustomer({ ...oneTimeCustomer, contact_person: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Contact Number *</label>
                <input type="tel" className="form-control" value={oneTimeCustomer.phone_primary}
                  onChange={(e) => setOneTimeCustomer({ ...oneTimeCustomer, phone_primary: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Address</label>
                <input type="text" className="form-control" value={oneTimeCustomer.address}
                  onChange={(e) => setOneTimeCustomer({ ...oneTimeCustomer, address: e.target.value })} />
              </div>
            </div>
          </div>
        )}

        <div className="form-row">
          <div className="form-group">
            <label>Bill Date</label>
            <input type="date" className="form-control" value={billDate}
              onChange={(e) => setBillDate(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Transaction Type</label>
            <select className="form-control" value={transactionType}
              onChange={(e) => setTransactionType(e.target.value)}>
              <option value="GIVEN">Cylinders Given</option>
              <option value="RECEIVED">Cylinders Received</option>
              <option value="SWAP">Swap (Given + Received)</option>
            </select>
          </div>
        </div>

        {(transactionType === 'GIVEN' || transactionType === 'SWAP') && (
          <div style={{ marginTop: '2rem' }}>
            <h3>Cylinders Given to Customer</h3>
            {givenItems.map((item, index) => (
              <CylinderItem key={index} item={item} index={index} gasTypes={gasTypes} cylinderSizes={cylinderSizes}
                onUpdate={(field, value) => updateItem(givenItems, setGivenItems, index, field, value)}
                onAddSerial={() => addSerialNumber(givenItems, setGivenItems, index)}
                onRemoveSerial={(si) => removeSerialNumber(givenItems, setGivenItems, index, si)}
                onRemove={() => setGivenItems(givenItems.filter((_, i) => i !== index))}
                showRate={true} />
            ))}
            <button type="button" className="btn btn-primary" onClick={addGivenItem}>+ Add Cylinder Type</button>
          </div>
        )}

        {(transactionType === 'RECEIVED' || transactionType === 'SWAP') && (
          <div style={{ marginTop: '2rem' }}>
            <h3>Cylinders Received from Customer</h3>
            {receivedItems.map((item, index) => (
              <CylinderItem key={index} item={item} index={index} gasTypes={gasTypes} cylinderSizes={cylinderSizes}
                onUpdate={(field, value) => updateItem(receivedItems, setReceivedItems, index, field, value)}
                onAddSerial={() => addSerialNumber(receivedItems, setReceivedItems, index)}
                onRemoveSerial={(si) => removeSerialNumber(receivedItems, setReceivedItems, index, si)}
                onRemove={() => setReceivedItems(receivedItems.filter((_, i) => i !== index))}
                showRate={false} />
            ))}
            <button type="button" className="btn btn-primary" onClick={addReceivedItem}>+ Add Cylinder Type</button>
          </div>
        )}

        <div style={{ marginTop: '2rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
          <h3>Bill Summary</h3>
          <p><strong>Total Cylinders Given:</strong> {totalGiven}</p>
          <p><strong>Total Cylinders Received:</strong> {totalReceived}</p>
          <p><strong>Net Cylinder Change:</strong> {totalGiven - totalReceived}</p>
          <p><strong>Bill Amount:</strong> ₹{totalAmount.toFixed(2)}</p>
          {selectedCustomer && (
            <>
              <p><strong>Previous Outstanding:</strong> ₹{selectedCustomer.current_bill_amount?.toFixed(2)}</p>
              <p><strong>New Total Outstanding:</strong> ₹{(selectedCustomer.current_bill_amount + totalAmount).toFixed(2)}</p>
              <p><strong>Previous Cylinders Held:</strong> {selectedCustomer.cylinders_held}</p>
              <p><strong>New Cylinders Held:</strong> {newCylinderHold}</p>
              <p><strong>Holding Limit:</strong> {selectedCustomer.holding_limit}</p>
              {isOverLimit && <p style={{ color: 'red', fontWeight: 'bold' }}>⚠️ WARNING: Customer will be OVER LIMIT after this transaction!</p>}
            </>
          )}
        </div>

        <div className="form-group">
          <label>Remarks / Notes</label>
          <textarea className="form-control" value={remarks}
            onChange={(e) => setRemarks(e.target.value)} rows="3" />
        </div>

        <div className="btn-group">
          <button type="submit" className="btn btn-primary">Save Bill</button>
          <button type="button" className="btn btn-secondary" onClick={onBack}>Cancel</button>
        </div>
      </form>
    </div>
  )
}
