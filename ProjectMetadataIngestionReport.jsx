import { useState, useEffect } from 'react'
import { C, CATEGORIES, CATEGORY_LABELS, CB_STATUSES, STATUS_LABELS, STATUS_COLORS, API_BASE, FETCH_HEADERS } from './constants.js'
import { buildCrossTab, buildContentTypeCrossTab, buildDateCrossTab, getAvailableDates } from './crossTab.js'
import Cell from './Cell.jsx'
import DrillDownModal from './DrillDownModal.jsx'
import MonthYearPicker from './MonthYearPicker.jsx'

export default function ProjectMetadataIngestionReport() {
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState('')
  const [months, setMonths] = useState('7')
  const [year, setYear] = useState(2026)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [drillDown, setDrillDown] = useState(null)
  const [dvbStatus, setDvbStatus] = useState(null)
  const [contentTypeFilter, setContentTypeFilter] = useState('all')
  const [l2vFilter, setL2vFilter] = useState('all')
  const [includeDvb, setIncludeDvb] = useState(true)
  const [includeArchivedPurged, setIncludeArchivedPurged] = useState(true)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    fetch(`${API_BASE}/projects`, { headers: FETCH_HEADERS }).then(r => r.json()).then(setProjects).catch(e => setError(e.message))
  }, [])

  const selectedProject = projects.find(p => p.id === projectId)

  const fetchData = async () => {
    if (!projectId || !months || !year) { setError('Select a project and enter months/year.'); return }
    setError(null); setLoading(true)
    try {
      const params = `project_id=${encodeURIComponent(projectId)}&months=${encodeURIComponent(months)}&year=${encodeURIComponent(year)}`
      const res = await fetch(`${API_BASE}/ingestion/classification-with-status?${params}`, { headers: FETCH_HEADERS })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to fetch classification')
      setRows(data.rows || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const fetchDvb = async () => {
    if (!projectId || !months || !year) return
    setDvbStatus('loading')
    try {
      const monthList = months.split(',').map(m => parseInt(m.trim())).filter(Boolean)
      const firstMonth = Math.min(...monthList)
      const lastMonth = Math.max(...monthList)
      const startDate = `${year}-${String(firstMonth).padStart(2, '0')}-01 00:00:00`
      const endMonth = lastMonth + 1
      const endDate = endMonth > 12 ? `${year + 1}-01-01 00:00:00` : `${year}-${String(endMonth).padStart(2, '0')}-01 00:00:00`
      const res = await fetch(`${API_BASE}/dvb/fetch?project_id=${projectId}&start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`, { headers: FETCH_HEADERS })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'DVB fetch failed')
      setDvbStatus(`✓ ${data.count} rows retrieved`)
    } catch (e) {
      setDvbStatus(`✗ ${e.message}`)
    }
  }

  // Dynamically derived from whatever content_type values are actually
  // present in the fetched rows -- same principle as the Content Report
  // tool: a brand-new content_type that's never been seen before just
  // shows up in this dropdown automatically, no code change needed here.
  const availableContentTypes = [...new Set(rows.map(r => r.content_type).filter(Boolean))].sort()

  const filteredRows = rows.filter(r => {
    if (contentTypeFilter !== 'all' && r.content_type !== contentTypeFilter) return false
    if (l2vFilter === 'l2v' && !r.is_l2v) return false
    if (l2vFilter === 'non_l2v' && r.is_l2v) return false
    // Same convention as the original Content Report tool: this flag
    // affects the live view AND the export together, not just one or the
    // other -- unchecking it hides archived/purged everywhere, not only
    // in the downloaded file.
    if (!includeArchivedPurged && (r.cb_status === 'archived' || r.cb_status === 'purged')) return false
    return true
  })

  const grid = buildCrossTab(filteredRows)
  const allStatusRows = includeArchivedPurged ? [...CB_STATUSES, 'unknown'] : [...CB_STATUSES.filter(s => s !== 'archived' && s !== 'purged'), 'unknown']

  const contentTypeGrid = buildContentTypeCrossTab(filteredRows, availableContentTypes)
  const allContentTypeRows = [...availableContentTypes, 'unknown']

  const availableDates = getAvailableDates(filteredRows)
  const dateGrid = buildDateCrossTab(filteredRows, availableDates)
  const allDateRows = [...availableDates, 'unknown']

  // Reflects the SAME filteredRows every other metric on this page uses --
  // consistent with how this app already treats include_archived_purged
  // (it affects the cross-tab AND export together, not just one), rather
  // than the original Content Report tool's convention of always showing
  // totals unfiltered regardless of that toggle.
  const totalContents = filteredRows.length
  const totalHours = filteredRows.reduce((sum, r) => sum + (Number(r.duration_hours) || 0), 0)

  const downloadExcel = async () => {
    if (!projectId || !months || !year) { setError('Select a project and enter months/year.'); return }
    setError(null); setExporting(true)
    try {
      const params = `project_id=${encodeURIComponent(projectId)}&months=${encodeURIComponent(months)}&year=${encodeURIComponent(year)}&include_dvb=${includeDvb}&include_archived_purged=${includeArchivedPurged}`
      const res = await fetch(`${API_BASE}/ingestion/export?${params}`, { headers: FETCH_HEADERS })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Export failed')
      }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') || ''
      const match = disposition.match(/filename=([^;]+)/)
      const filename = match ? match[1].trim() : 'export.xlsx'
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (e) {
      setError(e.message)
    } finally {
      setExporting(false)
    }
  }

  const inputStyle = { padding: '7px 10px', borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: 'inherit' }
  const btnStyle = { padding: '7px 16px', borderRadius: 6, border: 'none', background: C.pu, color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }

  return (
    <div style={{ fontFamily: '-apple-system, Segoe UI, Roboto, sans-serif', background: '#f8f8fc', minHeight: '100vh', color: C.text }}>
      <header style={{ padding: '16px 24px', background: '#fff', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 16, margin: 0, marginRight: 8 }}>{selectedProject ? selectedProject.name : 'Project'} Metadata Ingestion Report</h1>
        <select value={projectId} onChange={e => setProjectId(e.target.value)} style={inputStyle}>
          <option value="">Select project…</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <MonthYearPicker months={months} year={year} onMonthsChange={setMonths} onYearChange={setYear} />
        <button onClick={fetchData} disabled={loading} style={{ ...btnStyle, opacity: loading ? 0.6 : 1 }}>{loading ? 'Loading…' : 'Fetch'}</button>
        {selectedProject?.has_dvb && (
          <>
            <button onClick={fetchDvb} style={{ ...btnStyle, background: '#fff', color: C.muted, border: `1px solid ${C.border}` }}>Fetch DVB</button>
            {dvbStatus && <span style={{ fontSize: 12, color: dvbStatus.startsWith('✓') ? C.green : dvbStatus.startsWith('✗') ? C.red : C.muted }}>{dvbStatus}</span>}
          </>
        )}
        {rows.length > 0 && (
          <>
            <div style={{ width: 1, height: 20, background: C.border }} />
            <select value={contentTypeFilter} onChange={e => setContentTypeFilter(e.target.value)} style={inputStyle}>
              <option value="all">All content types</option>
              {availableContentTypes.map(ct => <option key={ct} value={ct}>{ct}</option>)}
            </select>
            <select value={l2vFilter} onChange={e => setL2vFilter(e.target.value)} style={inputStyle}>
              <option value="all">All (L2V + non-L2V)</option>
              <option value="l2v">L2V only</option>
              <option value="non_l2v">Non-L2V only</option>
            </select>
          </>
        )}
        <div style={{ width: 1, height: 20, background: C.border }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.muted, cursor: selectedProject?.has_dvb ? 'pointer' : 'not-allowed' }}>
          <input type="checkbox" checked={includeDvb} disabled={!selectedProject?.has_dvb} onChange={e => setIncludeDvb(e.target.checked)} />
          Include DVB
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.muted, cursor: 'pointer' }}>
          <input type="checkbox" checked={includeArchivedPurged} onChange={e => setIncludeArchivedPurged(e.target.checked)} />
          Include Archived/Purged
        </label>
        <button onClick={downloadExcel} disabled={exporting || rows.length === 0} style={{ ...btnStyle, background: '#fff', color: C.pu, border: `1.5px solid ${C.pu}`, opacity: exporting || rows.length === 0 ? 0.5 : 1 }}>
          {exporting ? 'Exporting…' : '⬇ Download Excel'}
        </button>
      </header>

      <main style={{ padding: 24 }}>
        {error && (
          <div style={{ color: C.red, background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
            {error}
          </div>
        )}

        {rows.length > 0 && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
            <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 20px', minWidth: 140 }}>
              <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Total Contents</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: C.text }}>{totalContents}</div>
            </div>
            <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 20px', minWidth: 140 }}>
              <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Total Hours</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: C.text }}>{totalHours.toFixed(2)}</div>
            </div>
          </div>
        )}

        {rows.length > 0 && (
          <table style={{ width: '100%', background: '#fff', borderCollapse: 'collapse', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: 24 }}>
            <thead>
              <tr>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: `1px solid ${C.border}`, background: '#f0f0f8' }}>
                  CB Status
                </th>
                {CATEGORIES.map(cat => (
                  <th key={cat} style={{ padding: '10px 12px', textAlign: 'center', fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: `1px solid ${C.border}`, background: '#f0f0f8' }}>
                    {CATEGORY_LABELS[cat]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allStatusRows.map(status => (
                <tr key={status}>
                  <td style={{ padding: '10px 12px', fontWeight: 700, fontSize: 13, color: STATUS_COLORS[status], borderBottom: `1px solid ${C.border}` }}>
                    {STATUS_LABELS[status]}
                  </td>
                  {CATEGORIES.map(cat => (
                    <Cell key={cat} items={grid[status][cat]} onClick={setDrillDown} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {rows.length > 0 && (
          <table style={{ width: '100%', background: '#fff', borderCollapse: 'collapse', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: 24 }}>
            <thead>
              <tr>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: `1px solid ${C.border}`, background: '#f0f0f8' }}>
                  Content Type
                </th>
                {CATEGORIES.map(cat => (
                  <th key={cat} style={{ padding: '10px 12px', textAlign: 'center', fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: `1px solid ${C.border}`, background: '#f0f0f8' }}>
                    {CATEGORY_LABELS[cat]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allContentTypeRows.map(ct => (
                <tr key={ct}>
                  <td style={{ padding: '10px 12px', fontWeight: 700, fontSize: 13, color: ct === 'unknown' ? C.muted : C.text, borderBottom: `1px solid ${C.border}` }}>
                    {ct === 'unknown' ? 'Unknown / No Content Type' : ct}
                  </td>
                  {CATEGORIES.map(cat => (
                    <Cell key={cat} items={contentTypeGrid[ct][cat]} onClick={setDrillDown} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {rows.length > 0 && (
          <table style={{ width: '100%', background: '#fff', borderCollapse: 'collapse', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <thead>
              <tr>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: `1px solid ${C.border}`, background: '#f0f0f8' }}>
                  Date
                </th>
                {CATEGORIES.map(cat => (
                  <th key={cat} style={{ padding: '10px 12px', textAlign: 'center', fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: `1px solid ${C.border}`, background: '#f0f0f8' }}>
                    {CATEGORY_LABELS[cat]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allDateRows.map(d => (
                <tr key={d}>
                  <td style={{ padding: '10px 12px', fontWeight: 700, fontSize: 13, fontFamily: d === 'unknown' ? 'inherit' : C.mono, color: d === 'unknown' ? C.muted : C.text, borderBottom: `1px solid ${C.border}` }}>
                    {d === 'unknown' ? 'Unknown / No Date' : d}
                  </td>
                  {CATEGORIES.map(cat => (
                    <Cell key={cat} items={dateGrid[d][cat]} onClick={setDrillDown} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {rows.length === 0 && !loading && !error && (
          <div style={{ textAlign: 'center', padding: 60, color: '#cbd5e1' }}>
            Select a project and click Fetch to see the classification breakdown.
          </div>
        )}
      </main>

      <DrillDownModal items={drillDown} onClose={() => setDrillDown(null)} />
    </div>
  )
}
