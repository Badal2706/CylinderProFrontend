import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { apiFetch, API_URL } from '../api'

function getReportRows(reportType, data) {
  const d2 = (d) => d ? new Date(d).toLocaleDateString('en-IN') : ''
  const rs = (n) => parseFloat((n || 0).toFixed(2))

  switch (reportType) {
    case 'ledger':
      return data.map((c, i) => ({
        'Sr': i + 1, 'Company Name': c.company_name || '', 'Phone': c.phone_primary || '',
        'TIN No': c.tin_number || '', 'Security Deposit': rs(c.security_deposit),
        'Holding Limit': c.holding_limit || 0, 'Cylinders Held': c.cylinder_hold || 0,
        'Payment Due': rs(c.bill_amount), 'Cylinder Status': c.status || 'OK'
      }))
    case 'over-limit':
      return data.map((c, i) => ({
        'Sr': i + 1, 'Company Name': c.company_name || '', 'Phone': c.phone_primary || '',
        'Cylinders Held': c.cylinders_held || 0, 'Holding Limit': c.holding_limit || 0,
        'Over By': (c.cylinders_held || 0) - (c.holding_limit || 0)
      }))
    case 'daily':
      return data.map((b, i) => ({
        'Sr': i + 1, 'Bill No': b.bill_number || '', 'Date': d2(b.bill_date),
        'Customer': b.company_name || '', 'Phone': b.phone_primary || '',
        'Type': b.transaction_type || '', 'Given Qty': b.total_given_qty || 0,
        'Received Qty': b.total_received_qty || 0, 'Bill Amount': rs(b.total_bill_amount),
        'Remarks': b.remarks || ''
      }))
    case 'cylinder-stock':
      return data.map((s, i) => ({
        'Sr': i + 1, 'Gas Type': s.gas_type_name || '', 'Size': s.size_label || '',
        'Total Given': s.total_given || 0, 'Total Received': s.total_received || 0,
        'Currently Out': s.currently_out || 0
      }))
    case 'outstanding':
      return data.map((o, i) => ({
        'Sr': i + 1, 'Company Name': o.company_name || '',
        'Contact Person': o.contact_person || '', 'Phone': o.phone_primary || '',
        'Total Billed': rs(o.total_billed), 'Total Paid': rs(o.total_paid),
        'Outstanding': rs(o.outstanding_amount)
      }))
    case 'deposits':
      return data.map((d, i) => ({
        'Sr': i + 1, 'Company Name': d.company_name || '',
        'Contact Person': d.contact_person || '', 'Phone': d.phone_primary || '',
        'Security Deposit': rs(d.security_deposit)
      }))
    default:
      return data
  }
}

function printReportPopup(title, rows) {
  if (!rows || rows.length === 0) { alert('No data to print'); return }
  const headers = Object.keys(rows[0])
  const th = headers.map(h => `<th>${h}</th>`).join('')
  const tb = rows.map(r =>
    `<tr>${headers.map(h => `<td>${r[h] !== null && r[h] !== undefined ? r[h] : ''}</td>`).join('')}</tr>`
  ).join('')

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
  </body></html>`

  const w = window.open('', '_blank', 'width=1000,height=700,scrollbars=yes')
  if (w) { w.document.write(html); w.document.close() }
  else { alert('Please allow pop-ups for this site to use Print / PDF.') }
}

function ReportTable({ reportType, data }) {
  switch (reportType) {
    case 'cylinder-stock':
      return (
        <table>
          <thead><tr><th>Gas Type</th><th>Size</th><th>Total Given</th><th>Total Received</th><th>Currently Out</th></tr></thead>
          <tbody>
            {data.map((item, i) => (
              <tr key={i}>
                <td>{item.gas_type_name || 'N/A'}</td><td>{item.size_label || 'N/A'}</td>
                <td>{item.total_given || 0}</td><td>{item.total_received || 0}</td>
                <td><strong>{item.currently_out || 0}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    case 'over-limit':
      return (
        <table>
          <thead><tr><th>Customer Name</th><th>Contact</th><th>Cylinders Held</th><th>Holding Limit</th><th>Over By</th></tr></thead>
          <tbody>
            {data.map((item, i) => (
              <tr key={item.customer_id || i} className="row-over-limit">
                <td>{item.company_name || 'N/A'}</td><td>{item.phone_primary || 'N/A'}</td>
                <td>{item.cylinders_held || 0}</td><td>{item.holding_limit || 0}</td>
                <td><strong>{(item.cylinders_held || 0) - (item.holding_limit || 0)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    case 'outstanding':
      return (
        <table>
          <thead><tr><th>Customer Name</th><th>Contact</th><th>Outstanding Amount</th></tr></thead>
          <tbody>
            {data.map((item, i) => (
              <tr key={item.customer_id || i}>
                <td>{item.company_name || 'N/A'}</td><td>{item.phone_primary || 'N/A'}</td>
                <td>₹{(item.outstanding_amount || 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    case 'deposits':
      return (
        <table>
          <thead><tr><th>Customer Name</th><th>Contact Person</th><th>Contact</th><th>Security Deposit</th></tr></thead>
          <tbody>
            {data.map((item, i) => (
              <tr key={item.customer_id || i}>
                <td>{item.company_name || 'N/A'}</td><td>{item.contact_person || 'N/A'}</td>
                <td>{item.phone_primary || 'N/A'}</td>
                <td>₹{(item.security_deposit || 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    default:
      return (
        <div>
          <div style={{ padding: '0.75rem 1rem', backgroundColor: '#f8f9fa', borderRadius: '4px', marginBottom: '1rem', display: 'flex', gap: '2rem' }}>
            <span><strong>Total Customers:</strong> {data.length}</span>
            <span><strong>Total Payment Due:</strong> ₹{data.reduce((s, i) => s + (i.bill_amount > 0 ? i.bill_amount : 0), 0).toFixed(2)}</span>
            <span><strong>Cylinders Out:</strong> {data.reduce((s, i) => s + (i.cylinder_hold || 0), 0)}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Sr. No.</th><th>Customer Name</th><th>Phone</th><th>Payment Due</th>
                <th>Cylinder Hold</th><th>Holding Limit</th><th>Payment Status</th><th>Cylinder Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((item, i) => (
                <tr key={item.customer_id || i}
                  className={item.status === 'OVER LIMIT' ? 'row-over-limit' : item.bill_amount < 0 ? 'row-credit' : ''}>
                  <td>{i + 1}</td><td>{item.company_name || 'N/A'}</td>
                  <td>{item.phone_primary || '-'}</td>
                  <td><strong>₹{(item.bill_amount || 0).toFixed(2)}</strong></td>
                  <td>{item.cylinder_hold || 0}</td><td>{item.holding_limit || 0}</td>
                  <td>
                    {item.bill_amount > 0 ? <span className="badge badge-warning">Due</span>
                      : item.bill_amount < 0 ? <span className="badge badge-success">Credit</span>
                      : <span className="badge badge-success">Clear</span>}
                  </td>
                  <td>
                    {item.status === 'OVER LIMIT'
                      ? <span className="badge badge-danger">OVER LIMIT</span>
                      : <span className="badge badge-success">OK</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

export default function Reports() {
  const [reportType, setReportType] = useState('ledger')
  const [reportData, setReportData] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])

  const reportLabel = {
    'ledger': 'All Customer Ledger',
    'over-limit': 'Over Limit Customers',
    'daily': 'Daily Transaction Report',
    'cylinder-stock': 'Cylinder Stock Summary',
    'outstanding': 'Outstanding Dues',
    'deposits': 'Deposit Summary'
  }

  const fetchReport = async (type, date) => {
    setLoading(true)
    try {
      let url = `${API_URL}/reports/${type}`
      if (type === 'daily') url += `?date=${date || selectedDate}`
      const res = await apiFetch(url)
      setReportData(await res.json())
      setLoading(false)
    } catch (err) { console.error('Error fetching report:', err); setLoading(false) }
  }

  useEffect(() => { fetchReport(reportType) }, [reportType])

  const handleExportExcel = () => {
    if (!reportData.length) { alert('No data to export'); return }
    const rows = getReportRows(reportType, reportData)
    try {
      const ws = XLSX.utils.json_to_sheet(rows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, reportLabel[reportType] || 'Report')
      XLSX.writeFile(wb, `${reportType}_report_${selectedDate}.xlsx`)
    } catch (err) { console.error('XLSX error:', err); alert('Excel export failed: ' + err.message) }
  }

  const handlePrint = () => {
    if (!reportData.length) { alert('No data to print'); return }
    printReportPopup(reportLabel[reportType] || 'Report', getReportRows(reportType, reportData))
  }

  return (
    <div className="card">
      <h2>Reports</h2>

      <div className="form-row">
        <div className="form-group">
          <label>Report Type</label>
          <select className="form-control" value={reportType} onChange={(e) => setReportType(e.target.value)}>
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
            <input type="date" className="form-control" value={selectedDate}
              onChange={(e) => { setSelectedDate(e.target.value); fetchReport('daily', e.target.value) }} />
          </div>
        )}
      </div>

      <div className="btn-group">
        <button className="btn btn-primary" onClick={() => fetchReport(reportType)}>Refresh</button>
        <button className="btn btn-secondary" onClick={handlePrint} disabled={!reportData.length}>Print / PDF</button>
        <button className="btn btn-secondary" onClick={handleExportExcel} disabled={!reportData.length}>Export Excel</button>
      </div>

      {loading ? (
        <div className="loading">Loading report...</div>
      ) : (
        <div className="table-container" style={{ marginTop: '1rem' }}>
          {reportData.length === 0
            ? <p>No data available for this report.</p>
            : <ReportTable reportType={reportType} data={reportData} />}
        </div>
      )}
    </div>
  )
}
