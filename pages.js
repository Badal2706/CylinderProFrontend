// Customer Ledger Component
function CustomerLedger({ onNavigate, onSelectCustomer }) {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchLedger();
  }, []);

  const fetchLedger = async () => {
    try {
      const response = await apiFetch(`${API_URL}/reports/ledger`);
      const data = await response.json();
      setCustomers(data);
      setLoading(false);
    } catch (error) {
      console.error('Error:', error);
      setLoading(false);
    }
  };

  const filteredCustomers = customers.filter(c =>
    c.company_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.phone_primary.includes(searchTerm)
  );

  const totalBillAmount = filteredCustomers.reduce((sum, c) => sum + c.bill_amount, 0);
  const totalCylindersOut = filteredCustomers.reduce((sum, c) => sum + c.cylinder_hold, 0);

  if (loading) {
    return <div className="loading">Loading ledger...</div>;
  }

  return (
    <div>
      <div className="card">
        <h2>Customer Ledger - All Customers</h2>
        
        <div className="search-bar">
          <input
            type="text"
            placeholder="Search by name or contact..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="form-control"
          />
        </div>

        <div style={{padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px', marginTop: '1rem'}}>
          <h3>Summary</h3>
          <p><strong>Total Bill Amount:</strong> ₹{(totalBillAmount || 0).toFixed(2)}</p>
          <p><strong>Total Cylinders Out:</strong> {totalCylindersOut || 0}</p>
        </div>

        <div className="table-container" style={{marginTop: '1rem'}}>
          <table>
            <thead>
              <tr>
                <th>Sr. No.</th>
                <th>Company Name</th>
                <th>Bill Amount</th>
                <th>Cylinder Hold</th>
                <th>Deposit</th>
                <th>Holding Limit</th>
                <th>Status</th>
                <th>Contact</th>
                <th>TIN No.</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map((customer, index) => (
                <tr
                  key={customer.customer_id}
                  className={
                    customer.status === 'OVER LIMIT' ? 'row-over-limit' :
                    customer.bill_amount < 0 ? 'row-credit' : ''
                  }
                >
                  <td>{index + 1}</td>
                  <td>
                    <span
                      className="clickable"
                      onClick={() => onSelectCustomer(customer.customer_id)}
                    >
                      {customer.company_name}
                    </span>
                  </td>
                  <td>₹{(customer.bill_amount || 0).toFixed(2)}</td>
                  <td>{customer.cylinder_hold || 0}</td>
                  <td>₹{(customer.security_deposit || 0).toFixed(2)}</td>
                  <td>{customer.holding_limit || 0}</td>
                  <td>
                    {customer.status === 'OVER LIMIT' && (
                      <span className="badge badge-danger">OVER LIMIT</span>
                    )}
                  </td>
                  <td>{customer.phone_primary || 'N/A'}</td>
                  <td>{customer.tin_number || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Customer Detail Component
function CustomerDetail({ customerId, onBack }) {
  const [customer, setCustomer] = useState(null);
  const [givenTransactions, setGivenTransactions] = useState([]);
  const [receivedTransactions, setReceivedTransactions] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPaymentForm, setShowPaymentForm] = useState(false);

  useEffect(() => {
    if (customerId) {
      fetchCustomerDetail();
    }
  }, [customerId]);

  const fetchCustomerDetail = async () => {
    try {
      console.log('Fetching customer detail for ID:', customerId);
      const [customerRes, givenRes, receivedRes, paymentsRes] = await Promise.all([
        apiFetch(`${API_URL}/customers/${customerId}`),
        apiFetch(`${API_URL}/customers/${customerId}/transactions/given`),
        apiFetch(`${API_URL}/customers/${customerId}/transactions/received`),
        apiFetch(`${API_URL}/customers/${customerId}/payments`)
      ]);

      const customerData = await customerRes.json();
      const givenData = await givenRes.json();
      const receivedData = await receivedRes.json();
      const paymentsData = await paymentsRes.json();

      console.log('Customer data:', customerData);
      console.log('Given transactions:', givenData);
      console.log('Received transactions:', receivedData);
      console.log('Payments:', paymentsData);

      setCustomer(customerData);
      setGivenTransactions(givenData);
      setReceivedTransactions(receivedData);
      setPayments(paymentsData);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching customer detail:', error);
      setLoading(false);
    }
  };

  const exportCustomerExcel = () => {
    const d2 = (d) => d ? new Date(d).toLocaleDateString('en-IN') : '';
    const rs = (n) => parseFloat((n || 0).toFixed(2));

    const infoRows = [
      { Field: 'Company Name',        Value: customer.company_name || '' },
      { Field: 'Contact Person',       Value: customer.contact_person || '' },
      { Field: 'Phone',                Value: customer.phone_primary || '' },
      { Field: 'Address',              Value: customer.address || '' },
      { Field: 'TIN Number',           Value: customer.tin_number || '' },
      { Field: 'Cylinders Held',       Value: customer.cylinders_held || 0 },
      { Field: 'Holding Limit',        Value: customer.holding_limit || 0 },
      { Field: 'Amount Due',           Value: rs(customer.current_bill_amount) },
      { Field: 'Total Billed',         Value: rs(customer.total_billed) },
      { Field: 'Total Received',       Value: rs(customer.total_received) },
      { Field: 'Security Deposit',     Value: rs(customer.security_deposit) },
    ];

    const givenRows = givenTransactions.length ? givenTransactions.map(t => ({
      'Date': d2(t.date), 'Bill No': t.bill_number || '', 'Gas Type': t.gas_type_name || '',
      'Size': t.size_label || '', 'Serial No': t.serial_number || '',
      'Qty': t.quantity || 0, 'Rate': rs(t.rate), 'Amount': rs(t.amount)
    })) : [{ 'Note': 'No cylinders given yet' }];

    const receivedRows = receivedTransactions.length ? receivedTransactions.map(t => ({
      'Date': d2(t.date), 'Bill No': t.bill_number || '', 'Gas Type': t.gas_type_name || '',
      'Size': t.size_label || '', 'Serial No': t.serial_number || '', 'Qty': t.quantity || 0
    })) : [{ 'Note': 'No cylinders received yet' }];

    const paymentRows = payments.length ? payments.map(p => ({
      'Receipt No': p.receipt_number || '', 'Date': d2(p.date),
      'Amount Received': rs(p.amount_received), 'Discount': rs(p.discount),
      'Net Amount': rs((p.amount_received || 0) - (p.discount || 0)),
      'Mode': p.payment_mode || '', 'Cheque No': p.cheque_number || '', 'Remarks': p.remarks || ''
    })) : [{ 'Note': 'No payments recorded yet' }];

    try {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(infoRows),     'Customer Info');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(givenRows),    'Cylinders Given');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(receivedRows), 'Cylinders Received');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(paymentRows),  'Payments');
      const fname = (customer.company_name || 'Customer').replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '_');
      XLSX.writeFile(wb, `${fname}_Data.xlsx`);
    } catch (err) {
      console.error('Excel export failed:', err);
      alert('Excel export failed: ' + err.message);
    }
  };

  const printCustomer = () => {
    const d2 = (d) => d ? new Date(d).toLocaleDateString('en-IN') : '';
    const rs = (n) => '₹' + (n || 0).toFixed(2);

    const section = (title, headers, rows) => {
      if (!rows.length) return `<h3 style="margin:16px 0 4px">${title}</h3><p style="color:#64748b;font-size:10px">No records</p>`;
      const th = headers.map(h => `<th>${h}</th>`).join('');
      const tb = rows.map(r => `<tr>${r.map(v => `<td>${v}</td>`).join('')}</tr>`).join('');
      return `<h3 style="margin:16px 0 6px;font-size:12px">${title}</h3>
        <table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`;
    };

    const infoTable = `<table style="width:auto;margin-bottom:8px">
      <tr><td><b>Company</b></td><td>${customer.company_name}</td><td style="padding-left:20px"><b>Phone</b></td><td>${customer.phone_primary || ''}</td></tr>
      <tr><td><b>Contact</b></td><td>${customer.contact_person || ''}</td><td style="padding-left:20px"><b>TIN</b></td><td>${customer.tin_number || ''}</td></tr>
      <tr><td><b>Amount Due</b></td><td>${rs(customer.current_bill_amount)}</td><td style="padding-left:20px"><b>Cylinders Held</b></td><td>${customer.cylinders_held || 0}</td></tr>
    </table>`;

    const givenSec = section('Cylinders Given',
      ['Date','Bill No','Gas Type','Size','Serial No','Qty','Rate','Amount'],
      givenTransactions.map(t => [d2(t.date), t.bill_number, t.gas_type_name, t.size_label, t.serial_number, t.quantity, rs(t.rate), rs(t.amount)])
    );
    const recvSec = section('Cylinders Received',
      ['Date','Bill No','Gas Type','Size','Serial No','Qty'],
      receivedTransactions.map(t => [d2(t.date), t.bill_number, t.gas_type_name, t.size_label, t.serial_number, t.quantity])
    );
    const pymtSec = section('Payment History',
      ['Receipt No','Date','Amount','Discount','Net','Mode','Cheque No','Remarks'],
      payments.map(p => [p.receipt_number, d2(p.date), rs(p.amount_received), rs(p.discount), rs((p.amount_received||0)-(p.discount||0)), p.payment_mode, p.cheque_number||'', p.remarks||''])
    );

    const html = `<!DOCTYPE html><html><head><title>${customer.company_name}</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:Arial,sans-serif;font-size:11px;padding:20px;color:#1e293b}
      h2{font-size:16px;margin-bottom:12px}
      table{border-collapse:collapse;width:100%;margin-bottom:4px}
      th{background:#1e293b;color:#fff;padding:5px 8px;text-align:left;font-size:10px}
      td{padding:4px 8px;border-bottom:1px solid #e2e8f0;font-size:10px}
      tr:nth-child(even) td{background:#f8fafc}
      @page{margin:12mm}
    </style></head><body>
    <h2>CylinderPro — Customer Report: ${customer.company_name}</h2>
    <p style="color:#64748b;font-size:10px;margin-bottom:12px">Generated: ${new Date().toLocaleString('en-IN')}</p>
    ${infoTable}${givenSec}${recvSec}${pymtSec}
    <script>window.onload=function(){window.print();window.onafterprint=function(){window.close()}}<\/script>
    </body></html>`;

    const w = window.open('', '_blank', 'width=1000,height=700,scrollbars=yes');
    if (w) { w.document.write(html); w.document.close(); }
    else { alert('Please allow pop-ups for Print / PDF.'); }
  };

  if (loading) {
    return <div className="loading">Loading customer details...</div>;
  }

  if (!customer) {
    return <div className="alert alert-danger">Customer not found</div>;
  }

  return (
    <div>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem'}}>
        <button className="btn btn-secondary" onClick={onBack}>← Back to List</button>
        <div className="btn-group" style={{margin:0}}>
          <button className="btn btn-secondary" onClick={printCustomer}>Print / PDF</button>
          <button className="btn btn-secondary" onClick={exportCustomerExcel}>Export Excel</button>
        </div>
      </div>

      {/* Customer Info */}
      <div className="card">
        <h2>Customer Information</h2>
        <div className="form-row">
          <div>
            <p><strong>Company Name:</strong> {customer.company_name}</p>
            <p><strong>Contact Person:</strong> {customer.contact_person}</p>
            <p><strong>Phone:</strong> {customer.phone_primary}</p>
            {customer.phone_alternate && <p><strong>Alt Phone:</strong> {customer.phone_alternate}</p>}
          </div>
          <div>
            <p><strong>Address:</strong> {customer.address}</p>
            <p><strong>TIN Number:</strong> {customer.tin_number || 'N/A'}</p>
            <p><strong>Security Deposit:</strong> ₹{customer.security_deposit?.toFixed(2)}</p>
          </div>
        </div>
      </div>

      {/* Cylinder Summary */}
      <div className="card">
        <h2>Cylinder Summary</h2>
        <div className="stats-grid">
          <div className="stat-card blue">
            <h3>Currently Held</h3>
            <div className="value">{customer.cylinders_held}</div>
          </div>
          <div className="stat-card green">
            <h3>Total Given (All Time)</h3>
            <div className="value">{customer.total_given}</div>
          </div>
          <div className="stat-card orange">
            <h3>Total Received (All Time)</h3>
            <div className="value">{customer.total_received_qty}</div>
          </div>
          <div className="stat-card purple">
            <h3>Holding Limit</h3>
            <div className="value">{customer.holding_limit}</div>
          </div>
        </div>

        {customer.status === 'OVER LIMIT' && (
          <div className="alert alert-danger">
            ⚠️ Customer is currently OVER LIMIT by {customer.cylinders_held - customer.holding_limit} cylinders
          </div>
        )}

        {customer.cylinder_breakdown && customer.cylinder_breakdown.length > 0 && (
          <div>
            <h3>Breakdown by Type</h3>
            <table>
              <thead>
                <tr>
                  <th>Gas Type</th>
                  <th>Size</th>
                  <th>Total Given</th>
                  <th>Total Received</th>
                  <th>Currently Held</th>
                </tr>
              </thead>
              <tbody>
                {customer.cylinder_breakdown.map((item, index) => (
                  <tr key={index}>
                    <td>{item.gas_type_name}</td>
                    <td>{item.size_label}</td>
                    <td>{item.total_given}</td>
                    <td>{item.total_received}</td>
                    <td><strong>{item.currently_held}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Financial Summary */}
      <div className="card">
        <h2>Financial Summary</h2>
        <div className="form-row">
          <div>
            <p><strong>Amount Due:</strong> ₹{customer.current_bill_amount?.toFixed(2)}</p>
            <p><strong>Total Billed:</strong> ₹{customer.total_billed?.toFixed(2)}</p>
            <p><strong>Total Received:</strong> ₹{customer.total_received?.toFixed(2)}</p>
          </div>
          <div>
            <p><strong>Total Discount:</strong> ₹{customer.total_discount?.toFixed(2)}</p>
            <p><strong>Security Deposit:</strong> ₹{customer.security_deposit?.toFixed(2)}</p>
          </div>
        </div>

        <button
          className="btn btn-primary"
          onClick={() => setShowPaymentForm(!showPaymentForm)}
        >
          {showPaymentForm ? 'Cancel' : 'Record Payment'}
        </button>

        {showPaymentForm && (
          <PaymentForm
            customerId={customerId}
            onSuccess={() => {
              setShowPaymentForm(false);
              fetchCustomerDetail();
            }}
            onCancel={() => setShowPaymentForm(false)}
          />
        )}
      </div>

      {/* Transaction History - Given */}
      <div className="card">
        <h2>Cylinders Given History</h2>
        <div className="table-container">
          {givenTransactions.length === 0 ? (
            <p>No cylinders given yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Bill No.</th>
                  <th>Gas Type</th>
                  <th>Size</th>
                  <th>Serial Number</th>
                  <th>Quantity</th>
                  <th>Rate</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {givenTransactions.map(txn => (
                  <tr key={txn.line_item_id}>
                    <td>{new Date(txn.date).toLocaleDateString()}</td>
                    <td>{txn.bill_number}</td>
                    <td>{txn.gas_type_name}</td>
                    <td>{txn.size_label}</td>
                    <td>{txn.serial_number}</td>
                    <td>{txn.quantity}</td>
                    <td>₹{(txn.rate || 0).toFixed(2)}</td>
                    <td>₹{(txn.amount || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Transaction History - Received */}
      <div className="card">
        <h2>Cylinders Received History</h2>
        <div className="table-container">
          {receivedTransactions.length === 0 ? (
            <p>No cylinders received yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Bill No.</th>
                  <th>Gas Type</th>
                  <th>Size</th>
                  <th>Serial Number</th>
                  <th>Quantity</th>
                </tr>
              </thead>
              <tbody>
                {receivedTransactions.map(txn => (
                  <tr key={txn.line_item_id}>
                    <td>{new Date(txn.date).toLocaleDateString()}</td>
                    <td>{txn.bill_number}</td>
                    <td>{txn.gas_type_name}</td>
                    <td>{txn.size_label}</td>
                    <td>{txn.serial_number}</td>
                    <td>{txn.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Payment History */}
      <div className="card">
        <h2>Payment History</h2>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Receipt No.</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Discount</th>
                <th>Mode</th>
                <th>Cheque No.</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(payment => (
                <tr key={payment.receipt_id}>
                  <td>{payment.receipt_number}</td>
                  <td>{new Date(payment.date).toLocaleDateString()}</td>
                  <td>₹{payment.amount_received.toFixed(2)}</td>
                  <td>₹{payment.discount.toFixed(2)}</td>
                  <td>{payment.payment_mode}</td>
                  <td>{payment.cheque_number || '-'}</td>
                  <td>{payment.remarks || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Payment Form Component
function PaymentForm({ customerId, onSuccess, onCancel }) {
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    amount_received: '',
    discount: 0,
    payment_mode: 'CASH',
    cheque_number: '',
    remarks: ''
  });

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      const response = await apiFetch(`${API_URL}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          ...formData,
          customer_id: customerId
        })
      });

      if (response.ok) {
        alert('Payment recorded successfully!');
        onSuccess();
      } else {
        alert('Error recording payment');
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error recording payment');
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{marginTop: '1rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px'}}>
      <div className="form-row">
        <div className="form-group">
          <label>Date *</label>
          <input
            type="date"
            className="form-control"
            value={formData.date}
            onChange={(e) => setFormData({...formData, date: e.target.value})}
            required
          />
        </div>

        <div className="form-group">
          <label>Amount Received *</label>
          <input
            type="number"
            className="form-control"
            value={formData.amount_received}
            onChange={(e) => setFormData({...formData, amount_received: e.target.value})}
            min="0"
            step="0.01"
            required
          />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Payment Mode *</label>
          <select
            className="form-control"
            value={formData.payment_mode}
            onChange={(e) => setFormData({...formData, payment_mode: e.target.value})}
            required
          >
            <option value="CASH">Cash</option>
            <option value="CHEQUE">Cheque</option>
            <option value="ONLINE">Online Transfer</option>
          </select>
        </div>

        {formData.payment_mode === 'CHEQUE' && (
          <div className="form-group">
            <label>Cheque Number *</label>
            <input
              type="text"
              className="form-control"
              value={formData.cheque_number}
              onChange={(e) => setFormData({...formData, cheque_number: e.target.value})}
              required
            />
          </div>
        )}

        <div className="form-group">
          <label>Discount</label>
          <input
            type="number"
            className="form-control"
            value={formData.discount}
            onChange={(e) => setFormData({...formData, discount: e.target.value})}
            min="0"
            step="0.01"
          />
        </div>
      </div>

      <div className="form-group">
        <label>Remarks</label>
        <textarea
          className="form-control"
          value={formData.remarks}
          onChange={(e) => setFormData({...formData, remarks: e.target.value})}
          rows="2"
        />
      </div>

      <div className="btn-group">
        <button type="submit" className="btn btn-primary">
          Save Payment
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// Convert raw API data → clean flat rows per report type
function getReportRows(reportType, data) {
  const d2 = (d) => d ? new Date(d).toLocaleDateString('en-IN') : '';
  const rs = (n) => parseFloat((n || 0).toFixed(2));

  switch (reportType) {
    case 'ledger':
      return data.map((c, i) => ({
        'Sr': i + 1,
        'Company Name': c.company_name || '',
        'Phone': c.phone_primary || '',
        'TIN No': c.tin_number || '',
        'Security Deposit': rs(c.security_deposit),
        'Holding Limit': c.holding_limit || 0,
        'Cylinders Held': c.cylinder_hold || 0,
        'Payment Due': rs(c.bill_amount),
        'Cylinder Status': c.status || 'OK'
      }));
    case 'over-limit':
      return data.map((c, i) => ({
        'Sr': i + 1,
        'Company Name': c.company_name || '',
        'Phone': c.phone_primary || '',
        'Cylinders Held': c.cylinders_held || 0,
        'Holding Limit': c.holding_limit || 0,
        'Over By': (c.cylinders_held || 0) - (c.holding_limit || 0)
      }));
    case 'daily':
      return data.map((b, i) => ({
        'Sr': i + 1,
        'Bill No': b.bill_number || '',
        'Date': d2(b.bill_date),
        'Customer': b.company_name || '',
        'Phone': b.phone_primary || '',
        'Type': b.transaction_type || '',
        'Given Qty': b.total_given_qty || 0,
        'Received Qty': b.total_received_qty || 0,
        'Bill Amount': rs(b.total_bill_amount),
        'Remarks': b.remarks || ''
      }));
    case 'cylinder-stock':
      return data.map((s, i) => ({
        'Sr': i + 1,
        'Gas Type': s.gas_type_name || '',
        'Size': s.size_label || '',
        'Total Given': s.total_given || 0,
        'Total Received': s.total_received || 0,
        'Currently Out': s.currently_out || 0
      }));
    case 'outstanding':
      return data.map((o, i) => ({
        'Sr': i + 1,
        'Company Name': o.company_name || '',
        'Contact Person': o.contact_person || '',
        'Phone': o.phone_primary || '',
        'Total Billed': rs(o.total_billed),
        'Total Paid': rs(o.total_paid),
        'Outstanding': rs(o.outstanding_amount)
      }));
    case 'deposits':
      return data.map((d, i) => ({
        'Sr': i + 1,
        'Company Name': d.company_name || '',
        'Contact Person': d.contact_person || '',
        'Phone': d.phone_primary || '',
        'Security Deposit': rs(d.security_deposit)
      }));
    default:
      return data;
  }
}

// Open a clean popup window with just the table, then trigger browser print → Save as PDF
function printReportPopup(title, rows) {
  if (!rows || rows.length === 0) { alert('No data to print'); return; }
  const headers = Object.keys(rows[0]);
  const th = headers.map(h => `<th>${h}</th>`).join('');
  const tb = rows.map(r =>
    `<tr>${headers.map(h => `<td>${r[h] !== null && r[h] !== undefined ? r[h] : ''}</td>`).join('')}</tr>`
  ).join('');

  const html = `<!DOCTYPE html><html><head><title>${title}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,Helvetica,sans-serif;font-size:11px;padding:20px;color:#1e293b}
    h2{font-size:16px;font-weight:700;margin-bottom:4px}
    .sub{font-size:10px;color:#64748b;margin-bottom:16px}
    table{border-collapse:collapse;width:100%}
    th{background:#1e293b;color:#fff;padding:7px 10px;text-align:left;font-size:10px;font-weight:600}
    td{padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:10px}
    tr:nth-child(even) td{background:#f8fafc}
    @page{margin:15mm}
  </style></head><body>
  <h2>CylinderPro — ${title}</h2>
  <div class="sub">Generated: ${new Date().toLocaleString('en-IN')}</div>
  <table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>
  <script>window.onload=function(){window.print();window.onafterprint=function(){window.close()}}<\/script>
  </body></html>`;

  const w = window.open('', '_blank', 'width=1000,height=700,scrollbars=yes');
  if (w) { w.document.write(html); w.document.close(); }
  else { alert('Please allow pop-ups for this site to use Print / PDF.'); }
}

// Reports Component
function Reports() {
  const [reportType, setReportType] = useState('ledger');
  const [reportData, setReportData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  const fetchReport = async (type, date) => {
    setLoading(true);
    try {
      let url = `${API_URL}/reports/${type}`;
      if (type === 'daily') url += `?date=${date || selectedDate}`;
      const response = await apiFetch(url);
      const data = await response.json();
      setReportData(data);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching report:', error);
      setLoading(false);
    }
  };

  useEffect(() => { fetchReport(reportType); }, [reportType]);

  const reportLabel = {
    'ledger': 'All Customer Ledger',
    'over-limit': 'Over Limit Customers',
    'daily': 'Daily Transaction Report',
    'cylinder-stock': 'Cylinder Stock Summary',
    'outstanding': 'Outstanding Dues',
    'deposits': 'Deposit Summary'
  };

  const handleExportExcel = () => {
    if (!reportData.length) { alert('No data to export'); return; }
    const rows = getReportRows(reportType, reportData);
    try {
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, reportLabel[reportType] || 'Report');
      XLSX.writeFile(wb, `${reportType}_report_${selectedDate}.xlsx`);
    } catch (err) {
      console.error('XLSX error:', err);
      alert('Excel export failed: ' + err.message);
    }
  };

  const handlePrint = () => {
    if (!reportData.length) { alert('No data to print'); return; }
    const rows = getReportRows(reportType, reportData);
    printReportPopup(reportLabel[reportType] || 'Report', rows);
  };

  return (
    <div className="card">
      <h2>Reports</h2>

      <div className="form-row">
        <div className="form-group">
          <label>Report Type</label>
          <select
            className="form-control"
            value={reportType}
            onChange={(e) => setReportType(e.target.value)}
          >
            <option value="ledger">All Customer Ledger</option>
            <option value="over-limit">Over Limit Customers</option>
            <option value="daily">Daily Transaction Report</option>
            <option value="cylinder-stock">Cylinder Stock Summary</option>
            <option value="outstanding">Outstanding Dues Report</option>
            <option value="deposits">Deposit Summary</option>
          </select>
        </div>

        {reportType === 'daily' && (
          <div className="form-group">
            <label>Date</label>
            <input
              type="date"
              className="form-control"
              value={selectedDate}
              onChange={(e) => { setSelectedDate(e.target.value); fetchReport('daily', e.target.value); }}
            />
          </div>
        )}
      </div>

      <div className="btn-group">
        <button className="btn btn-primary" onClick={() => fetchReport(reportType)}>
          Refresh
        </button>
        <button className="btn btn-secondary" onClick={handlePrint} disabled={!reportData.length}>
          Print / PDF
        </button>
        <button className="btn btn-secondary" onClick={handleExportExcel} disabled={!reportData.length}>
          Export Excel
        </button>
      </div>

      {loading ? (
        <div className="loading">Loading report...</div>
      ) : (
        <div className="table-container" style={{marginTop: '1rem'}}>
          {reportData.length === 0 ? (
            <p>No data available for this report.</p>
          ) : (
            <ReportTable reportType={reportType} data={reportData} />
          )}
        </div>
      )}
    </div>
  );
}

// Report Table Component
function ReportTable({ reportType, data }) {
  console.log('ReportTable rendering:', reportType, 'with data:', data);
  
  switch (reportType) {
    case 'cylinder-stock':
      return (
        <table>
          <thead>
            <tr>
              <th>Gas Type</th>
              <th>Size</th>
              <th>Total Given</th>
              <th>Total Received</th>
              <th>Currently Out</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item, index) => (
              <tr key={index}>
                <td>{item.gas_type_name || 'N/A'}</td>
                <td>{item.size_label || 'N/A'}</td>
                <td>{item.total_given || 0}</td>
                <td>{item.total_received || 0}</td>
                <td><strong>{item.currently_out || 0}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      );

    case 'over-limit':
      return (
        <table>
          <thead>
            <tr>
              <th>Customer Name</th>
              <th>Contact</th>
              <th>Cylinders Held</th>
              <th>Holding Limit</th>
              <th>Over By</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item, index) => (
              <tr key={item.customer_id || index} className="row-over-limit">
                <td>{item.company_name || 'N/A'}</td>
                <td>{item.phone_primary || 'N/A'}</td>
                <td>{item.cylinders_held || 0}</td>
                <td>{item.holding_limit || 0}</td>
                <td><strong>{(item.cylinders_held || 0) - (item.holding_limit || 0)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      );

    case 'outstanding':
      return (
        <table>
          <thead>
            <tr>
              <th>Customer Name</th>
              <th>Contact</th>
              <th>Outstanding Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item, index) => (
              <tr key={item.customer_id || index}>
                <td>{item.company_name || 'N/A'}</td>
                <td>{item.phone_primary || 'N/A'}</td>
                <td>₹{(item.outstanding_amount || 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );

    case 'deposits':
      return (
        <table>
          <thead>
            <tr>
              <th>Customer Name</th>
              <th>Contact Person</th>
              <th>Contact</th>
              <th>Security Deposit</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item, index) => (
              <tr key={item.customer_id || index}>
                <td>{item.company_name || 'N/A'}</td>
                <td>{item.contact_person || 'N/A'}</td>
                <td>{item.phone_primary || 'N/A'}</td>
                <td>₹{(item.security_deposit || 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );

    default:
      return (
        <div>
          <div style={{padding: '0.75rem 1rem', backgroundColor: '#f8f9fa', borderRadius: '4px', marginBottom: '1rem', display: 'flex', gap: '2rem'}}>
            <span><strong>Total Customers:</strong> {data.length}</span>
            <span><strong>Total Payment Due:</strong> ₹{data.reduce((s, i) => s + (i.bill_amount > 0 ? i.bill_amount : 0), 0).toFixed(2)}</span>
            <span><strong>Cylinders Out:</strong> {data.reduce((s, i) => s + (i.cylinder_hold || 0), 0)}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Sr. No.</th>
                <th>Customer Name</th>
                <th>Phone</th>
                <th>Payment Due</th>
                <th>Cylinder Hold</th>
                <th>Holding Limit</th>
                <th>Payment Status</th>
                <th>Cylinder Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((item, index) => (
                <tr
                  key={item.customer_id || index}
                  className={item.status === 'OVER LIMIT' ? 'row-over-limit' : item.bill_amount < 0 ? 'row-credit' : ''}
                >
                  <td>{index + 1}</td>
                  <td>{item.company_name || 'N/A'}</td>
                  <td>{item.phone_primary || '-'}</td>
                  <td><strong>₹{(item.bill_amount || 0).toFixed(2)}</strong></td>
                  <td>{item.cylinder_hold || 0}</td>
                  <td>{item.holding_limit || 0}</td>
                  <td>
                    {item.bill_amount > 0
                      ? <span className="badge badge-warning">Due</span>
                      : item.bill_amount < 0
                        ? <span className="badge badge-success">Credit</span>
                        : <span className="badge badge-success">Clear</span>
                    }
                  </td>
                  <td>
                    {item.status === 'OVER LIMIT'
                      ? <span className="badge badge-danger">OVER LIMIT</span>
                      : <span className="badge badge-success">OK</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}


// Payments Component
function Payments({ onNavigate }) {
  const [payments, setPayments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchPayments();
    fetchCustomers();
  }, []);

  const fetchPayments = async () => {
    try {
      const response = await apiFetch(`${API_URL}/payments`);
      const data = await response.json();
      setPayments(data);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching payments:', error);
      setLoading(false);
    }
  };

  const fetchCustomers = async () => {
    try {
      const response = await apiFetch(`${API_URL}/customers`);
      const data = await response.json();
      setCustomers(data);
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
  };

  const filteredPayments = payments.filter(p =>
    p.company_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.receipt_number.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return <div className="loading">Loading payments...</div>;
  }

  return (
    <div>
      <div className="card">
        <h2>Payment Management</h2>
        
        <div className="btn-group">
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : '💰 Record New Payment'}
          </button>
          {payments.length > 0 && (
            <button className="btn btn-secondary" onClick={() => exportToExcel(
              payments.map(p => ({
                'Receipt No.': p.receipt_number,
                'Date': new Date(p.date).toLocaleDateString(),
                'Customer': p.company_name,
                'Bill No.': p.bill_number || '',
                'Amount Received': p.amount_received || 0,
                'Discount': p.discount || 0,
                'Net Amount': (p.amount_received || 0) - (p.discount || 0),
                'Payment Mode': p.payment_mode,
                'Cheque No.': p.cheque_number || '',
                'Remarks': p.remarks || ''
              })), 'Payments_History', 'Payments'
            )}>Export Excel</button>
          )}
        </div>

        {showForm && (
          <PaymentFormStandalone
            customers={customers}
            onSuccess={() => {
              setShowForm(false);
              fetchPayments();
            }}
            onCancel={() => setShowForm(false)}
          />
        )}
      </div>

      <div className="card">
        <h3>Payment History</h3>
        
        <div className="search-bar">
          <input
            type="text"
            placeholder="Search by customer name or receipt number..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="form-control"
          />
        </div>

        <div className="table-container" style={{marginTop: '1rem'}}>
          {filteredPayments.length === 0 ? (
            <p>No payments recorded yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Receipt No.</th>
                  <th>Date</th>
                  <th>Customer Name</th>
                  <th>Bill No.</th>
                  <th>Amount Received</th>
                  <th>Discount</th>
                  <th>Net Amount</th>
                  <th>Payment Mode</th>
                  <th>Cheque No.</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayments.map(payment => (
                  <tr key={payment._id}>
                    <td><strong>{payment.receipt_number}</strong></td>
                    <td>{new Date(payment.date).toLocaleDateString()}</td>
                    <td>{payment.company_name}</td>
                    <td>{payment.bill_number || '-'}</td>
                    <td>₹{(payment.amount_received || 0).toFixed(2)}</td>
                    <td>₹{(payment.discount || 0).toFixed(2)}</td>
                    <td><strong>₹{((payment.amount_received || 0) - (payment.discount || 0)).toFixed(2)}</strong></td>
                    <td>{payment.payment_mode}</td>
                    <td>{payment.cheque_number || '-'}</td>
                    <td>{payment.remarks || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{marginTop: '1rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px'}}>
          <h4>Summary</h4>
          <p><strong>Total Payments:</strong> {filteredPayments.length}</p>
          <p><strong>Total Amount Received:</strong> ₹{filteredPayments.reduce((sum, p) => sum + (p.amount_received || 0), 0).toFixed(2)}</p>
          <p><strong>Total Discount Given:</strong> ₹{filteredPayments.reduce((sum, p) => sum + (p.discount || 0), 0).toFixed(2)}</p>
          <p><strong>Net Amount:</strong> ₹{filteredPayments.reduce((sum, p) => sum + (p.amount_received || 0) - (p.discount || 0), 0).toFixed(2)}</p>
        </div>
      </div>
    </div>
  );
}

// Standalone Payment Form Component (with customer selection)
function PaymentFormStandalone({ customers, onSuccess, onCancel }) {
  const [formData, setFormData] = useState({
    customer_id: '',
    date: new Date().toISOString().split('T')[0],
    amount_received: '',
    discount: 0,
    payment_mode: 'CASH',
    cheque_number: '',
    remarks: ''
  });

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.customer_id) {
      alert('Please select a customer');
      return;
    }

    if (formData.payment_mode === 'CHEQUE' && !formData.cheque_number) {
      alert('Please enter cheque number');
      return;
    }

    try {
      const response = await apiFetch(`${API_URL}/payments`, {
        method: 'POST',
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        const result = await response.json();
        alert(`Payment recorded successfully! Receipt No: ${result.receipt_number}`);
        onSuccess();
      } else {
        const error = await response.json();
        alert(`Error recording payment: ${error.error}`);
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error recording payment');
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{marginTop: '1rem', padding: '1.5rem', backgroundColor: '#f8f9fa', borderRadius: '4px'}}>
      <h3>Record New Payment</h3>
      
      <div className="form-group">
        <label>Select Customer *</label>
        <select
          className="form-control"
          value={formData.customer_id}
          onChange={(e) => setFormData({...formData, customer_id: e.target.value})}
          required
        >
          <option value="">-- Select Customer --</option>
          {customers.map(customer => (
            <option key={customer._id} value={customer._id}>
              {customer.company_name} - {customer.phone_primary}
            </option>
          ))}
        </select>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Date *</label>
          <input
            type="date"
            className="form-control"
            value={formData.date}
            onChange={(e) => setFormData({...formData, date: e.target.value})}
            required
          />
        </div>

        <div className="form-group">
          <label>Amount Received *</label>
          <input
            type="number"
            className="form-control"
            value={formData.amount_received}
            onChange={(e) => setFormData({...formData, amount_received: e.target.value})}
            min="0"
            step="0.01"
            required
          />
        </div>

        <div className="form-group">
          <label>Discount</label>
          <input
            type="number"
            className="form-control"
            value={formData.discount}
            onChange={(e) => setFormData({...formData, discount: e.target.value})}
            min="0"
            step="0.01"
          />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Payment Mode *</label>
          <select
            className="form-control"
            value={formData.payment_mode}
            onChange={(e) => setFormData({...formData, payment_mode: e.target.value})}
            required
          >
            <option value="CASH">Cash</option>
            <option value="CHEQUE">Cheque</option>
            <option value="ONLINE">Online Transfer</option>
          </select>
        </div>

        {formData.payment_mode === 'CHEQUE' && (
          <div className="form-group">
            <label>Cheque Number *</label>
            <input
              type="text"
              className="form-control"
              value={formData.cheque_number}
              onChange={(e) => setFormData({...formData, cheque_number: e.target.value})}
              required
            />
          </div>
        )}
      </div>

      <div className="form-group">
        <label>Remarks</label>
        <textarea
          className="form-control"
          value={formData.remarks}
          onChange={(e) => setFormData({...formData, remarks: e.target.value})}
          rows="3"
          placeholder="Optional notes about this payment..."
        />
      </div>

      {formData.amount_received > 0 && (
        <div style={{padding: '1rem', backgroundColor: '#e7f3ff', borderRadius: '4px', marginBottom: '1rem'}}>
          <p style={{margin: 0}}><strong>Net Amount: ₹{((parseFloat(formData.amount_received) || 0) - (parseFloat(formData.discount) || 0)).toFixed(2)}</strong></p>
        </div>
      )}

      <div className="btn-group">
        <button type="submit" className="btn btn-primary">
          💾 Save Payment
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
