import React, { useState, useEffect } from 'react'
import { C, CATEGORIES, CATEGORY_LABELS, CB_STATUSES, STATUS_LABELS, STATUS_COLORS, API_BASE, FETCH_HEADERS } from './constants.js'
import { buildCombinedCrossTab, buildDateStatusCrossTab, getAvailableDates } from './crossTab.js'
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
  const [dvbRows, setDvbRows] = useState([])
  const [contentTypeFilter, setContentTypeFilter] = useState('all')
  const [l2vFilter, setL2vFilter] = useState('all')
  const [includeDvb, setIncludeDvb] = useState(true)
  const [includeArchivedPurged, setIncludeArchivedPurged] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [activeTab, setActiveTab] = useState('main')
  const [expandedGroups, setExpandedGroups] = useState(new Set())
  const [contentListSearch, setContentListSearch] = useState('')

  const toggleGroup = (key) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Clicking the heading resets back to the initial "pick a project"
  // state -- this is a single-page app with no separate route to
  // navigate to, so this is the equivalent of a site logo/title taking
  // you "home". Deliberately keeps months/year as-is: someone switching
  // projects most likely wants the same reporting period, not to
  // re-enter it every time.
  const goHome = () => {
    setProjectId('')
    setRows([])
    setDvbRows([])
    setError(null)
    setDrillDown(null)
    setDvbStatus(null)
    setActiveTab('main')
    setExpandedGroups(new Set())
    setContentTypeFilter('all')
    setL2vFilter('all')
  }

  useEffect(() => {
    fetch(`${API_BASE}/projects`, { headers: FETCH_HEADERS })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setProjects(data)
        } else {
          // Most likely an error object (e.g. {error: "..."}) or some
          // other unexpected shape -- storing it as-is would silently
          // break every later projects.find() call with an opaque
          // "X.find is not a function" instead of a real error message.
          setError(data?.error || 'Failed to load projects: unexpected response from server.')
        }
      })
      .catch(e => setError(e.message))
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
      // If "Include DVB" is checked and this project actually has DVB,
      // kick off a DVB fetch automatically as part of the same Fetch
      // click -- previously the checkbox only affected the Excel export,
      // silently doing nothing for the live view unless "Fetch DVB" was
      // ALSO clicked separately.
      //
      // Deliberately NOT awaited here: a real Harmonic fetch on a large
      // install can take several minutes (confirmed: ~5 min for ~10,000
      // assets), and awaiting it here would keep the main "Loading..."
      // state -- and therefore the main tables -- stuck the whole time,
      // even though the MySQL/Couchbase data was ready almost
      // immediately. DVB tracks its own separate loading state
      // (dvbStatus) and runs independently in the background instead.
      if (includeDvb && selectedProject?.has_dvb) {
        fetchDvb()
      }
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
      const params = `project_id=${encodeURIComponent(projectId)}&months=${encodeURIComponent(months)}&year=${encodeURIComponent(year)}`
      const res = await fetch(`${API_BASE}/dvb/fetch?${params}`, { headers: FETCH_HEADERS })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'DVB fetch failed')
      setDvbRows(data.rows || [])
      setDvbStatus(`✓ ${data.count} rows retrieved`)
    } catch (e) {
      setDvbRows([])
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


  const combinedGrid = buildCombinedCrossTab(filteredRows, availableContentTypes)
  const allContentTypeRows = [...availableContentTypes, 'unknown']
  const subStatusRows = includeArchivedPurged ? CB_STATUSES : CB_STATUSES.filter(s => s !== 'archived' && s !== 'purged')

  const availableDates = getAvailableDates(filteredRows)
  const dateGrid = buildDateStatusCrossTab(filteredRows, availableDates)
  const allDateRows = [...availableDates, 'unknown']

  // Reflects the SAME filteredRows every other metric on this page uses --
  // consistent with how this app already treats include_archived_purged
  // (it affects the cross-tab AND export together, not just one), rather
  // than the original Content Report tool's convention of always showing
  // totals unfiltered regardless of that toggle.
  const totalContents = filteredRows.length
  const totalHours = filteredRows.reduce((sum, r) => sum + (Number(r.duration_hours) || 0), 0)

  // DVB's own totals, kept separate from the MySQL-based ones above --
  // these two datasets aren't the same rows, so summing them together
  // would double-count or conflate two different things.
  const dvbTotalContent = dvbRows.length
  const dvbTotalHours = dvbRows.reduce((sum, r) => sum + (Number(r.duration_hours) || 0), 0)

  // Sums duration_hours across ALL 5 category cells for one status group
  // (e.g. combinedGrid.movie.published or dateGrid['2026-08-01'].published)
  // -- each grid cell only holds rows for one specific category, so this
  // flattens across all of them to get that status row's total duration.
  const sumDuration = (statusGroup) => CATEGORIES.reduce(
    (sum, cat) => sum + statusGroup[cat].reduce((s, r) => s + (Number(r.duration_hours) || 0), 0),
    0
  )

  // Total item count across all categories for one status group (e.g.
  // combinedGrid.movie.published) -- used for the new Total Count column,
  // the count-based equivalent of sumDuration.
  const sumCount = (statusGroup) => CATEGORIES.reduce((sum, cat) => sum + statusGroup[cat].length, 0)

  // Totals across ALL statuses for one group (e.g. combinedGrid.movie or
  // dateGrid['2026-08-01']) -- used for the collapsed group-header row,
  // which shows the combined Published+Draft+Archived+Purged+Unknown
  // totals per category instead of the per-status breakdown underneath.
  const sumGroupTotals = (group) => {
    const perCategory = {}
    CATEGORIES.forEach(cat => {
      perCategory[cat] = Object.values(group).reduce((sum, statusGroup) => sum + statusGroup[cat].length, 0)
    })
    const duration = Object.values(group).reduce((sum, statusGroup) => sum + sumDuration(statusGroup), 0)
    const totalCount = Object.values(perCategory).reduce((sum, c) => sum + c, 0)
    return { perCategory, duration, totalCount }
  }

  const downloadExcel = async () => {
    if (!projectId || !months || !year) { setError('Select a project and enter months/year.'); return }
    if (rows.length === 0) { setError('Fetch data first, then download.'); return }
    setError(null); setExporting(true)
    try {
      const monthList = months.split(',').map(m => parseInt(m.trim())).filter(Boolean)
      const res = await fetch(`${API_BASE}/ingestion/export`, {
        method: 'POST',
        headers: { ...FETCH_HEADERS, 'Content-Type': 'application/json' },
        // Sends the data ALREADY sitting in this component's state --
        // rows/dvbRows were fetched moments ago by the main Fetch/Fetch
        // DVB buttons. Confirmed in practice: the old GET-based export
        // re-ran the full MySQL + 45 Couchbase batches + a ~5-minute
        // Harmonic fetch from scratch on every single export click, for
        // data the user already had on screen. Sending it directly here
        // eliminates that entirely -- this is pure Excel generation now,
        // no backend re-query at all.
        body: JSON.stringify({
          project_name: selectedProject?.name || projectId,
          months: monthList,
          year: parseInt(year),
          rows,
          dvb_rows: dvbRows,
          include_dvb: includeDvb,
          include_archived_purged: includeArchivedPurged,
        }),
      })
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
        <h1
          onClick={goHome}
          title="Click to switch project"
          style={{ fontSize: 16, margin: 0, marginRight: 8, cursor: 'pointer' }}
          onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
          onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
        >
          {selectedProject ? selectedProject.name : 'Project'} Metadata Ingestion Report
        </h1>
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
            {dvbRows.length > 0 && (
              <span style={{ fontSize: 12, color: C.muted }}>
                DVB Total: <strong style={{ color: C.text }}>{dvbTotalContent}</strong> contents, <strong style={{ color: C.text }}>{dvbTotalHours.toFixed(2)}</strong> hrs
              </span>
            )}
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

      {rows.length > 0 && (
        <div style={{ display: 'flex', gap: 4, padding: '12px 24px 0', background: '#fff', borderBottom: `1px solid ${C.border}` }}>
          {[{ id: 'main', label: 'Main' }, { id: 'dateWise', label: 'Date Wise' }, { id: 'contentList', label: 'Content List' }].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 600,
                color: activeTab === tab.id ? C.pu : C.muted,
                borderBottom: activeTab === tab.id ? `2px solid ${C.pu}` : '2px solid transparent',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <main style={{ padding: 24 }}>
        {error && (
          <div style={{ color: C.red, background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
            {error}
          </div>
        )}

        {activeTab === 'main' && rows.length > 0 && (
          <div style={{ display: 'flex', gap: 12, marginBottom: dvbRows.length > 0 ? 12 : 20 }}>
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

        {activeTab === 'main' && dvbRows.length > 0 && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
            <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 20px', minWidth: 140 }}>
              <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>DVB Total Content</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: C.text }}>{dvbTotalContent}</div>
            </div>
            <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 20px', minWidth: 140 }}>
              <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>DVB Total Hours</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: C.text }}>{dvbTotalHours.toFixed(2)}</div>
            </div>
          </div>
        )}

        {activeTab === 'main' && rows.length > 0 && (
          <table style={{ width: '100%', background: '#fff', borderCollapse: 'collapse', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: 24 }}>
            <thead>
              <tr>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: `1px solid ${C.border}`, background: '#f0f0f8' }}>
                  Content Type / CB Status
                </th>
                {CATEGORIES.map(cat => (
                  <th key={cat} style={{ padding: '10px 12px', textAlign: 'center', fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: `1px solid ${C.border}`, background: '#f0f0f8' }}>
                    {CATEGORY_LABELS[cat]}
                  </th>
                ))}
                <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: `1px solid ${C.border}`, background: '#f0f0f8' }}>
                  Total Count
                </th>
                <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: `1px solid ${C.border}`, background: '#f0f0f8' }}>
                  Duration (hrs)
                </th>
              </tr>
            </thead>
            <tbody>
              {allContentTypeRows.map(ct => {
                const groupKey = `ct-${ct}`
                const isExpanded = expandedGroups.has(groupKey)
                const totals = sumGroupTotals(combinedGrid[ct])
                return (
                  <React.Fragment key={ct}>
                    <tr key={`${ct}-header`} style={{ background: '#f8f8fc', cursor: 'pointer' }} onClick={() => toggleGroup(groupKey)}>
                      <td style={{ padding: '8px 12px', fontWeight: 700, fontSize: 13, color: ct === 'unknown' ? C.muted : C.text, borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ display: 'inline-block', width: 14, color: C.muted }}>{isExpanded ? '▾' : '▸'}</span>
                        {ct === 'unknown' ? 'Unknown / No Content Type' : ct}
                      </td>
                      {!isExpanded && CATEGORIES.map(cat => (
                        <td key={cat} style={{ padding: '8px 12px', textAlign: 'center', fontSize: 13, fontWeight: 700, color: totals.perCategory[cat] > 0 ? C.text : '#cbd5e1', borderBottom: `1px solid ${C.border}` }}>
                          {totals.perCategory[cat] > 0 ? totals.perCategory[cat] : '—'}
                        </td>
                      ))}
                      {!isExpanded && (
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: 13, fontWeight: 700, color: C.text, borderBottom: `1px solid ${C.border}` }}>
                          {totals.totalCount}
                        </td>
                      )}
                      {!isExpanded && (
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: 13, fontWeight: 700, color: C.text, borderBottom: `1px solid ${C.border}` }}>
                          {totals.duration.toFixed(2)}
                        </td>
                      )}
                      {isExpanded && <td colSpan={2 + CATEGORIES.length} style={{ borderBottom: `1px solid ${C.border}` }} />}
                    </tr>
                    {isExpanded && subStatusRows.map(status => (
                      <tr key={`${ct}-${status}`}>
                        <td style={{ padding: '8px 12px 8px 28px', fontWeight: 600, fontSize: 12, color: STATUS_COLORS[status], borderBottom: `1px solid ${C.border}` }}>
                          {STATUS_LABELS[status]}
                        </td>
                        {CATEGORIES.map(cat => (
                          <Cell key={cat} items={combinedGrid[ct][status][cat]} onClick={setDrillDown} />
                        ))}
                        <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 13, fontWeight: 600, color: C.text, borderBottom: `1px solid ${C.border}` }}>
                          {sumCount(combinedGrid[ct][status])}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 13, fontWeight: 600, color: C.text, borderBottom: `1px solid ${C.border}` }}>
                          {sumDuration(combinedGrid[ct][status]).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        )}

        {activeTab === 'dateWise' && rows.length > 0 && (
          <table style={{ width: '100%', background: '#fff', borderCollapse: 'collapse', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <thead>
              <tr>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: `1px solid ${C.border}`, background: '#f0f0f8' }}>
                  Date / CB Status
                </th>
                {CATEGORIES.map(cat => (
                  <th key={cat} style={{ padding: '10px 12px', textAlign: 'center', fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: `1px solid ${C.border}`, background: '#f0f0f8' }}>
                    {CATEGORY_LABELS[cat]}
                  </th>
                ))}
                <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: `1px solid ${C.border}`, background: '#f0f0f8' }}>
                  Total Count
                </th>
                <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: `1px solid ${C.border}`, background: '#f0f0f8' }}>
                  Duration (hrs)
                </th>
              </tr>
            </thead>
            <tbody>
              {allDateRows.map(d => {
                const groupKey = `date-${d}`
                const isExpanded = expandedGroups.has(groupKey)
                const totals = sumGroupTotals(dateGrid[d])
                return (
                  <React.Fragment key={d}>
                    <tr style={{ background: '#f8f8fc', cursor: 'pointer' }} onClick={() => toggleGroup(groupKey)}>
                      <td style={{ padding: '8px 12px', fontWeight: 700, fontSize: 13, fontFamily: d === 'unknown' ? 'inherit' : C.mono, color: d === 'unknown' ? C.muted : C.text, borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ display: 'inline-block', width: 14, color: C.muted, fontFamily: 'inherit' }}>{isExpanded ? '▾' : '▸'}</span>
                        {d === 'unknown' ? 'Unknown / No Date' : d}
                      </td>
                      {!isExpanded && CATEGORIES.map(cat => (
                        <td key={cat} style={{ padding: '8px 12px', textAlign: 'center', fontSize: 13, fontWeight: 700, color: totals.perCategory[cat] > 0 ? C.text : '#cbd5e1', borderBottom: `1px solid ${C.border}` }}>
                          {totals.perCategory[cat] > 0 ? totals.perCategory[cat] : '—'}
                        </td>
                      ))}
                      {!isExpanded && (
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: 13, fontWeight: 700, color: C.text, borderBottom: `1px solid ${C.border}` }}>
                          {totals.totalCount}
                        </td>
                      )}
                      {!isExpanded && (
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: 13, fontWeight: 700, color: C.text, borderBottom: `1px solid ${C.border}` }}>
                          {totals.duration.toFixed(2)}
                        </td>
                      )}
                      {isExpanded && <td colSpan={2 + CATEGORIES.length} style={{ borderBottom: `1px solid ${C.border}` }} />}
                    </tr>
                    {isExpanded && subStatusRows.map(status => (
                      <tr key={`${d}-${status}`}>
                        <td style={{ padding: '8px 12px 8px 28px', fontWeight: 600, fontSize: 12, color: STATUS_COLORS[status], borderBottom: `1px solid ${C.border}` }}>
                          {STATUS_LABELS[status]}
                        </td>
                        {CATEGORIES.map(cat => (
                          <Cell key={cat} items={dateGrid[d][status][cat]} onClick={setDrillDown} />
                        ))}
                        <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 13, fontWeight: 600, color: C.text, borderBottom: `1px solid ${C.border}` }}>
                          {sumCount(dateGrid[d][status])}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 13, fontWeight: 600, color: C.text, borderBottom: `1px solid ${C.border}` }}>
                          {sumDuration(dateGrid[d][status]).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        )}

        {activeTab === 'contentList' && rows.length > 0 && (() => {
          const contentColumns = [
            ['content_id', 'Content ID'], ['current_key', 'Current Key'],
            ['content_title', 'Content Title'], ['content_type', 'Content Type'],
            ['is_l2v', 'L2V'], ['duration_hours', 'Duration (hrs)'],
            ['ingestion_category', 'Ingestion Category'],
            ['mysql_status', 'MySQL Status'], ['cb_status', 'CB Status'],
            ['restoration_status', 'Restoration Status'], ['external_id', 'External ID'],
            ['current_key_updated_date', 'Current Updated'],
            ['previous_key', 'Previous Key'], ['previous_key_updated_date', 'Previous Updated'],
            ['media_updated_date', 'Video/Audio/Caption/Image Created Date'],
          ]
          const searchLower = contentListSearch.trim().toLowerCase()
          const searchedRows = searchLower
            ? filteredRows.filter(r =>
                ['content_id', 'current_key', 'content_title', 'external_id', 'ingestion_category', 'cb_status']
                  .some(field => String(r[field] ?? '').toLowerCase().includes(searchLower))
              )
            : filteredRows

          return (
            <div>
              <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  value={contentListSearch}
                  onChange={e => setContentListSearch(e.target.value)}
                  placeholder="Filter by Content ID, Key, Title, External ID, Category, CB Status…"
                  style={{ padding: '7px 10px', borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: 'inherit', width: 380 }}
                />
                <span style={{ fontSize: 12, color: C.muted }}>{searchedRows.length} of {filteredRows.length} rows</span>
              </div>
              <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      {contentColumns.map(([key, label]) => (
                        <th key={key} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: `1px solid ${C.border}`, background: '#f0f0f8', whiteSpace: 'nowrap' }}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {searchedRows.map((r, i) => (
                      <tr key={i}>
                        {contentColumns.map(([key]) => (
                          <td key={key} style={{ padding: '7px 12px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap', color: r[key] == null ? '#cbd5e1' : C.text }}>
                            {key === 'is_l2v' ? (r[key] ? '✓' : '—')
                              : key === 'duration_hours' ? (r[key] != null ? Number(r[key]).toFixed(2) : '—')
                              : (r[key] ?? '—')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })()}

        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 200px)', textAlign: 'center' }}>
            <div style={{ width: 360, height: 7, marginBottom: 20, background: C.border, borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
              <div style={{
                position: 'absolute', top: 0, left: 0, height: '100%', width: '40%',
                background: 'linear-gradient(90deg, #7c6af7, #2563eb, #16a34a, #d97706, #dc2626, #7c6af7)',
                backgroundSize: '300% 100%',
                borderRadius: 6,
                animation: 'pmir-line-slide 1.2s ease-in-out infinite, pmir-hue-shift 2s linear infinite',
              }} />
            </div>
            <div style={{
              fontSize: 22, fontWeight: 700,
              background: 'linear-gradient(90deg, #7c6af7, #2563eb, #16a34a, #d97706, #dc2626, #7c6af7)',
              backgroundSize: '300% 100%',
              WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
              animation: 'pmir-hue-shift 2s linear infinite',
            }}>
              Loading classification data…
            </div>
            <style>{`
              @keyframes pmir-line-slide { 0% { left: -40% } 50% { left: 60% } 100% { left: 100% } }
              @keyframes pmir-hue-shift { 0% { background-position: 0% 50% } 100% { background-position: 300% 50% } }
            `}</style>
          </div>
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
