// Transaction Entry Component
function TransactionEntry({ onBack }) {
  const [customerType, setCustomerType] = useState('REGULAR');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [transactionType, setTransactionType] = useState('GIVEN');
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0]);
  const [remarks, setRemarks] = useState('');
  const [givenItems, setGivenItems] = useState([]);
  const [receivedItems, setReceivedItems] = useState([]);
  const [gasTypes, setGasTypes] = useState([]);
  const [cylinderSizes, setCylinderSizes] = useState([]);
  const [oneTimeCustomer, setOneTimeCustomer] = useState({
    company_name: '',
    contact_person: '',
    phone_primary: '',
    address: ''
  });
  const [savedBill, setSavedBill] = useState(null);
  const [showPostSavePaymentForm, setShowPostSavePaymentForm] = useState(false);

  useEffect(() => {
    fetchCustomers();
    fetchMasterData();
  }, []);

  const fetchCustomers = async () => {
    try {
      const response = await apiFetch(`${API_URL}/customers`);
      const data = await response.json();
      setCustomers(data);
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
  };

  const fetchMasterData = async () => {
    try {
      const [gasRes, sizeRes] = await Promise.all([
        apiFetch(`${API_URL}/masters/gas-types`),
        apiFetch(`${API_URL}/masters/cylinder-sizes`)
      ]);
      
      const gasData = await gasRes.json();
      const sizeData = await sizeRes.json();
      
      setGasTypes(gasData);
      setCylinderSizes(sizeData);
    } catch (error) {
      console.error('Error fetching master data:', error);
    }
  };

  const addGivenItem = () => {
    setGivenItems([...givenItems, {
      gas_type_id: '',
      cylinder_size_id: '',
      serial_numbers: [],
      quantity: 0,
      rate: 0,
      amount: 0,
      direction: 'GIVEN',
      serialInput: ''
    }]);
  };

  const addReceivedItem = () => {
    setReceivedItems([...receivedItems, {
      gas_type_id: '',
      cylinder_size_id: '',
      serial_numbers: [],
      quantity: 0,
      direction: 'RECEIVED',
      serialInput: ''
    }]);
  };

  const updateGivenItem = (index, field, value) => {
    const updated = [...givenItems];
    updated[index][field] = value;
    
    if (field === 'quantity' || field === 'rate') {
      updated[index].amount = updated[index].quantity * updated[index].rate;
    }
    
    setGivenItems(updated);
  };

  const updateReceivedItem = (index, field, value) => {
    const updated = [...receivedItems];
    updated[index][field] = value;
    setReceivedItems(updated);
  };

  const addSerialNumber = (items, setItems, index) => {
    const serialNumber = items[index].serialInput.trim();
    if (serialNumber) {
      const updated = [...items];
      updated[index].serial_numbers.push(serialNumber);
      updated[index].quantity = updated[index].serial_numbers.length;
      updated[index].serialInput = '';
      
      if (updated[index].direction === 'GIVEN') {
        updated[index].amount = updated[index].quantity * updated[index].rate;
      }
      
      setItems(updated);
    }
  };

  const removeSerialNumber = (items, setItems, itemIndex, serialIndex) => {
    const updated = [...items];
    updated[itemIndex].serial_numbers.splice(serialIndex, 1);
    updated[itemIndex].quantity = updated[itemIndex].serial_numbers.length;
    
    if (updated[itemIndex].direction === 'GIVEN') {
      updated[itemIndex].amount = updated[itemIndex].quantity * updated[itemIndex].rate;
    }
    
    setItems(updated);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validation
    if (customerType === 'REGULAR' && !selectedCustomer) {
      alert('Please select a customer');
      return;
    }

    if (customerType === 'ONE_TIME' && !oneTimeCustomer.company_name) {
      alert('Please enter customer details');
      return;
    }

    if (givenItems.length === 0 && receivedItems.length === 0) {
      alert('Please add at least one cylinder');
      return;
    }

    // Validate serial numbers
    const allItems = [...givenItems, ...receivedItems];
    for (const item of allItems) {
      if (item.serial_numbers.length === 0) {
        alert('Please add serial numbers for all cylinders');
        return;
      }
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
    };

    try {
      const response = await apiFetch(`${API_URL}/bills`, {
        method: 'POST',
        body: JSON.stringify(billData)
      });

      if (response.ok) {
        const result = await response.json();
        setSavedBill({
          bill_id: result.bill_id,
          bill_number: result.bill_number,
          amount: totalAmount,
          customer_id: selectedCustomer?.customer_id,
          customer_name: selectedCustomer?.company_name
        });
      } else {
        alert('Error creating bill');
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error creating bill');
    }
  };

  const totalGiven = givenItems.reduce((sum, item) => sum + item.quantity, 0);
  const totalReceived = receivedItems.reduce((sum, item) => sum + item.quantity, 0);
  const totalAmount = givenItems.reduce((sum, item) => sum + item.amount, 0);
  const newCylinderHold = (selectedCustomer?.cylinders_held || 0) + totalGiven - totalReceived;
  const isOverLimit = selectedCustomer && newCylinderHold > selectedCustomer.holding_limit;

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
            <p style={{margin: '1rem 0'}}>Would you like to record payment received for this bill?</p>
            <div className="btn-group">
              {savedBill.customer_id && (
                <button className="btn btn-primary" onClick={() => setShowPostSavePaymentForm(true)}>
                  Record Payment Now
                </button>
              )}
              <button className="btn btn-secondary" onClick={onBack}>
                Skip — Back to Dashboard
              </button>
            </div>
          </div>
        ) : (
          <div>
            <h3 style={{margin: '1rem 0 0.5rem'}}>Record Payment Received</h3>
            <PaymentForm
              customerId={savedBill.customer_id}
              onSuccess={onBack}
              onCancel={() => setShowPostSavePaymentForm(false)}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <h2>New Transaction / Bill</h2>
      
      <form onSubmit={handleSubmit}>
        {/* Customer Type Selection */}
        <div className="form-group">
          <label>Customer Type</label>
          <div>
            <label style={{marginRight: '1rem'}}>
              <input
                type="radio"
                value="REGULAR"
                checked={customerType === 'REGULAR'}
                onChange={(e) => setCustomerType(e.target.value)}
              /> Regular Customer
            </label>
            <label>
              <input
                type="radio"
                value="ONE_TIME"
                checked={customerType === 'ONE_TIME'}
                onChange={(e) => setCustomerType(e.target.value)}
              /> One-Time Customer
            </label>
          </div>
        </div>

        {/* Regular Customer Selection */}
        {customerType === 'REGULAR' && (
          <div className="form-group">
            <label>Search Customer</label>
            <select
              className="form-control"
              onChange={(e) => {
                const customer = customers.find(c => c.customer_id === e.target.value);
                setSelectedCustomer(customer);
              }}
            >
              <option value="">-- Select Customer --</option>
              {customers.map(customer => (
                <option key={customer.customer_id} value={customer.customer_id}>
                  {customer.company_name} - {customer.phone_primary}
                </option>
              ))}
            </select>

            {selectedCustomer && (
              <div style={{marginTop: '1rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px'}}>
                <p><strong>Name:</strong> {selectedCustomer.company_name}</p>
                <p><strong>Contact:</strong> {selectedCustomer.phone_primary}</p>
                <p><strong>Current Bill Amount:</strong> ₹{selectedCustomer.current_bill_amount?.toFixed(2)}</p>
                <p><strong>Cylinders Held:</strong> {selectedCustomer.cylinders_held}</p>
                <p><strong>Holding Limit:</strong> {selectedCustomer.holding_limit}</p>
                {selectedCustomer.status === 'OVER LIMIT' && (
                  <p style={{color: 'red'}}><strong>Status: OVER LIMIT</strong></p>
                )}
              </div>
            )}
          </div>
        )}

        {/* One-Time Customer Form */}
        {customerType === 'ONE_TIME' && (
          <div>
            <div className="form-row">
              <div className="form-group">
                <label>Customer Name *</label>
                <input
                  type="text"
                  className="form-control"
                  value={oneTimeCustomer.company_name}
                  onChange={(e) => setOneTimeCustomer({...oneTimeCustomer, company_name: e.target.value})}
                  required
                />
              </div>
              <div className="form-group">
                <label>Contact Person</label>
                <input
                  type="text"
                  className="form-control"
                  value={oneTimeCustomer.contact_person}
                  onChange={(e) => setOneTimeCustomer({...oneTimeCustomer, contact_person: e.target.value})}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Contact Number *</label>
                <input
                  type="tel"
                  className="form-control"
                  value={oneTimeCustomer.phone_primary}
                  onChange={(e) => setOneTimeCustomer({...oneTimeCustomer, phone_primary: e.target.value})}
                  required
                />
              </div>
              <div className="form-group">
                <label>Address</label>
                <input
                  type="text"
                  className="form-control"
                  value={oneTimeCustomer.address}
                  onChange={(e) => setOneTimeCustomer({...oneTimeCustomer, address: e.target.value})}
                />
              </div>
            </div>
          </div>
        )}

        {/* Bill Details */}
        <div className="form-row">
          <div className="form-group">
            <label>Bill Date</label>
            <input
              type="date"
              className="form-control"
              value={billDate}
              onChange={(e) => setBillDate(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>Transaction Type</label>
            <select
              className="form-control"
              value={transactionType}
              onChange={(e) => setTransactionType(e.target.value)}
            >
              <option value="GIVEN">Cylinders Given</option>
              <option value="RECEIVED">Cylinders Received</option>
              <option value="SWAP">Swap (Given + Received)</option>
            </select>
          </div>
        </div>

        {/* Cylinders Given Section */}
        {(transactionType === 'GIVEN' || transactionType === 'SWAP') && (
          <div style={{marginTop: '2rem'}}>
            <h3>Cylinders Given to Customer</h3>
            {givenItems.map((item, index) => (
              <CylinderItem
                key={index}
                item={item}
                index={index}
                gasTypes={gasTypes}
                cylinderSizes={cylinderSizes}
                onUpdate={(field, value) => updateGivenItem(index, field, value)}
                onAddSerial={() => addSerialNumber(givenItems, setGivenItems, index)}
                onRemoveSerial={(serialIndex) => removeSerialNumber(givenItems, setGivenItems, index, serialIndex)}
                onRemove={() => setGivenItems(givenItems.filter((_, i) => i !== index))}
                showRate={true}
              />
            ))}
            <button type="button" className="btn btn-primary" onClick={addGivenItem}>
              + Add Cylinder Type
            </button>
          </div>
        )}

        {/* Cylinders Received Section */}
        {(transactionType === 'RECEIVED' || transactionType === 'SWAP') && (
          <div style={{marginTop: '2rem'}}>
            <h3>Cylinders Received from Customer</h3>
            {receivedItems.map((item, index) => (
              <CylinderItem
                key={index}
                item={item}
                index={index}
                gasTypes={gasTypes}
                cylinderSizes={cylinderSizes}
                onUpdate={(field, value) => updateReceivedItem(index, field, value)}
                onAddSerial={() => addSerialNumber(receivedItems, setReceivedItems, index)}
                onRemoveSerial={(serialIndex) => removeSerialNumber(receivedItems, setReceivedItems, index, serialIndex)}
                onRemove={() => setReceivedItems(receivedItems.filter((_, i) => i !== index))}
                showRate={false}
              />
            ))}
            <button type="button" className="btn btn-primary" onClick={addReceivedItem}>
              + Add Cylinder Type
            </button>
          </div>
        )}

        {/* Bill Summary */}
        <div style={{marginTop: '2rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px'}}>
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
              {isOverLimit && (
                <p style={{color: 'red', fontWeight: 'bold'}}>
                  ⚠️ WARNING: Customer will be OVER LIMIT after this transaction!
                </p>
              )}
            </>
          )}
        </div>

        {/* Remarks */}
        <div className="form-group">
          <label>Remarks / Notes</label>
          <textarea
            className="form-control"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows="3"
          />
        </div>

        {/* Actions */}
        <div className="btn-group">
          <button type="submit" className="btn btn-primary">
            Save Bill
          </button>
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// Cylinder Item Component
function CylinderItem({ item, index, gasTypes, cylinderSizes, onUpdate, onAddSerial, onRemoveSerial, onRemove, showRate }) {
  return (
    <div className="cart-item">
      <div className="form-row">
        <div className="form-group">
          <label>Gas Type</label>
          <select
            className="form-control"
            value={item.gas_type_id}
            onChange={(e) => onUpdate('gas_type_id', e.target.value)}
            required
          >
            <option value="">-- Select --</option>
            {gasTypes.map(type => (
              <option key={type.gas_type_id} value={type.gas_type_id}>
                {type.gas_type_name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Cylinder Size</label>
          <select
            className="form-control"
            value={item.cylinder_size_id}
            onChange={(e) => onUpdate('cylinder_size_id', e.target.value)}
            required
          >
            <option value="">-- Select --</option>
            {cylinderSizes.map(size => (
              <option key={size.size_id} value={size.size_id}>
                {size.size_label}
              </option>
            ))}
          </select>
        </div>

        {showRate && (
          <div className="form-group">
            <label>Rate per Cylinder</label>
            <input
              type="number"
              className="form-control"
              value={item.rate}
              onChange={(e) => onUpdate('rate', parseFloat(e.target.value))}
              min="0"
              step="0.01"
              required
            />
          </div>
        )}
      </div>

      <div className="form-group">
        <label>Serial Numbers (Quantity: {item.quantity})</label>
        <div style={{display: 'flex', gap: '0.5rem'}}>
          <input
            type="text"
            className="form-control"
            value={item.serialInput}
            onChange={(e) => onUpdate('serialInput', e.target.value)}
            placeholder="Enter serial number and press Add"
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onAddSerial();
              }
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={onAddSerial}
          >
            Add
          </button>
        </div>

        <div className="serial-tags">
          {item.serial_numbers.map((serial, i) => (
            <div key={i} className="serial-tag">
              {serial}
              <button type="button" onClick={() => onRemoveSerial(i)}>
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {showRate && (
        <div className="form-group">
          <strong>Amount: ₹{item.amount.toFixed(2)}</strong>
        </div>
      )}

      <button type="button" className="btn btn-danger" onClick={onRemove}>
        Remove Item
      </button>
    </div>
  );
}
