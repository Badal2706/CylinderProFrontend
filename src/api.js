import * as XLSX from 'xlsx'

export const API_URL = '/api'

export async function apiFetch(url, options = {}) {
  const token = localStorage.getItem('authToken')
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(url, { ...options, headers })
  if (res.status === 401) {
    localStorage.removeItem('authToken')
    localStorage.removeItem('currentUser')
    window.dispatchEvent(new Event('auth-logout'))
  }
  return res
}

export function exportToExcel(rows, filename, sheetName) {
  if (!rows || rows.length === 0) { alert('No data to export'); return }
  try {
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, (sheetName || 'Data').substring(0, 31))
    XLSX.writeFile(wb, `${filename}.xlsx`)
  } catch (err) {
    console.error('Excel export error:', err)
    alert('Excel export failed: ' + err.message)
  }
}
