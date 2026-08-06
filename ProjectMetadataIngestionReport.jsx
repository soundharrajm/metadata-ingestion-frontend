import React, { useState, useEffect, useRef } from 'react'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker'
import { TextField, Select as MuiSelect, MenuItem, FormControl } from '@mui/material'
import dayjs from 'dayjs'
import { C, CATEGORIES, CATEGORY_LABELS, CB_STATUSES, STATUS_LABELS, STATUS_COLORS, API_BASE, FETCH_HEADERS, resolveApiBase } from './constants.js'
import { buildCombinedCrossTab, buildDateStatusCrossTab, getAvailableDates } from './crossTab.js'
import Cell from './Cell.jsx'
import DrillDownModal from './DrillDownModal.jsx'

// Light highlight colors for the Content List tab's row-highlighting
// feature -- deliberately soft/pastel, same idea as Excel's own cell fill
// colors, so highlighted text stays readable rather than the background
// overpowering it.
const HIGHLIGHT_COLORS = [
  { name: 'Yellow', hex: '#fff9c4' },
  { name: 'Green', hex: '#c8e6c9' },
  { name: 'Blue', hex: '#bbdefb' },
  { name: 'Pink', hex: '#f8bbd0' },
  { name: 'Orange', hex: '#ffe0b2' },
  { name: 'Purple', hex: '#e1bee7' },
]

export default function ProjectMetadataIngestionReport() {
  const [projects, setProjects] = useState([])
  const [apiBase, setApiBase] = useState(API_BASE)
  const [projectId, setProjectId] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [refreshInterval, setRefreshInterval] = useState('off')
  const refreshTimerRef = useRef(null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [queueStatus, setQueueStatus] = useState(null)
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
  const [contentListFilters, setContentListFilters] = useState([{ id: 0, col: 'content_id', val: '' }])
  const [rowHighlights, setRowHighlights] = useState({})
  const [colorPickerOpenFor, setColorPickerOpenFor] = useState(null)
  const [selectedExportColumns, setSelectedExportColumns] = useState([])
  const [showExportColumnPicker, setShowExportColumnPicker] = useState(false)

  const toggleGroup = (key) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Resolves fromDate/toDate to their actual values -- if either is left
  // empty, defaults to the 1st of the current month at 00:00 through
  // right now. Returns MySQL-format datetime strings ('YYYY-MM-DD
  // HH:MM:SS'), which is what the backend's from_date/to_date params
  // expect.
  const resolveDateRange = () => {
    const now = new Date()
    const pad = n => String(n).padStart(2, '0')
    const toMysqlFormat = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0)
    const resolvedFrom = fromDate ? toMysqlFormat(new Date(fromDate)) : toMysqlFormat(defaultFrom)
    const resolvedTo = toDate ? toMysqlFormat(new Date(toDate)) : toMysqlFormat(now)
    return { resolvedFrom, resolvedTo }
  }

  // DVB fetch (Harmonic) and the Excel export's Date Wise sectioning both
  // still specifically need a months[]/year internally -- Harmonic's own
  // API has no date-range filtering at all, only client-side month/year
  // filtering (confirmed in this codebase's history), and the Excel
  // sectioning logic splits by calendar month. Rather than rewrite both
  // of those to understand arbitrary date ranges, this derives the
  // equivalent "every month touched by this range" list from whatever
  // from/to was actually resolved -- e.g. Aug 20 - Sep 5 becomes [8, 9].
  const deriveMonthsFromRange = (fromStr, toStr) => {
    const from = new Date(fromStr)
    const to = new Date(toStr)
    const months = new Set()
    let cursor = new Date(from.getFullYear(), from.getMonth(), 1)
    const end = new Date(to.getFullYear(), to.getMonth(), 1)
    while (cursor <= end) {
      months.add(cursor.getMonth() + 1)
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    }
    return { months: [...months], year: from.getFullYear() }
  }

  // Clicking the heading resets back to the initial "pick a project"
  // state -- this is a single-page app with no separate route to
  // navigate to, so this is the equivalent of a site logo/title taking
  // you "home". Deliberately keeps fromDate/toDate as-is: someone switching
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
    resolveApiBase().then(resolved => {
      setApiBase(resolved)
      fetch(`${resolved}/projects`, { headers: FETCH_HEADERS })
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
    })
  }, [])

  const selectedProject = projects.find(p => p.id === projectId)

  // Polls /queue-status while a fetch is in flight -- the fetch request
  // itself gives zero visibility into whether it's actively running
  // against MySQL or still waiting for a free concurrency slot, since no
  // response comes back until the whole thing (queue wait included) is
  // done. This surfaces that live, separately.
  useEffect(() => {
    if (!loading) {
      setQueueStatus(null)
      return
    }
    let cancelled = false
    const poll = () => {
      fetch(`${apiBase}/queue-status`, { headers: FETCH_HEADERS })
        .then(r => r.json())
        .then(data => { if (!cancelled) setQueueStatus(data) })
        .catch(() => {})
    }
    poll()
    const timer = setInterval(poll, 1000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [loading])

  const fetchData = async () => {
    if (!projectId) { setError('Select a project.'); return }
    setError(null); setLoading(true)
    try {
      const { resolvedFrom, resolvedTo } = resolveDateRange()
      const params = `project_id=${encodeURIComponent(projectId)}&from_date=${encodeURIComponent(resolvedFrom)}&to_date=${encodeURIComponent(resolvedTo)}`
      const res = await fetch(`${apiBase}/ingestion/classification-with-status?${params}`, { headers: FETCH_HEADERS })
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

  // Auto-refresh: once an interval is picked (anything but 'off'), calls
  // fetchData() on that cadence, updating rows/dvbRows in place -- same
  // fetchData() the manual Fetch button uses, so both paths always stay
  // consistent with each other. Cleared and restarted whenever the
  // interval selection or project changes, and always cleared on
  // unmount, so there's never more than one timer running or a stray
  // timer left firing after leaving the page.
  useEffect(() => {
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
    if (refreshInterval === 'off' || !projectId) return
    const ms = { '30s': 30_000, '1m': 60_000, '5m': 300_000, '15m': 900_000 }[refreshInterval]
    if (!ms) return
    refreshTimerRef.current = setInterval(() => {
      fetchData()
    }, ms)
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshInterval, projectId])

  const fetchDvb = async () => {
    if (!projectId) return
    setDvbStatus('loading')
    try {
      const { resolvedFrom, resolvedTo } = resolveDateRange()
      // Harmonic's API has no date-range filtering at all -- only
      // month/year, applied client-side -- so this derives the months[]
      // this range actually touches, rather than passing the range
      // through directly (which the backend route doesn't accept here).
      const { months: derivedMonths, year: derivedYear } = deriveMonthsFromRange(resolvedFrom, resolvedTo)
      const params = `project_id=${encodeURIComponent(projectId)}&months=${encodeURIComponent(derivedMonths.join(','))}&year=${encodeURIComponent(derivedYear)}`
      const res = await fetch(`${apiBase}/dvb/fetch?${params}`, { headers: FETCH_HEADERS })
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

  // Static (not dependent on any state), so this lives at component
  // level -- both the Content List tab's own rendering AND
  // downloadExcel() (defined elsewhere in this component, needing the
  // same list for the user's column-selection export) share this one
  // definition rather than two copies that could drift out of sync.
  const contentColumns = [
    ['content_id', 'Content ID'], ['current_key', 'Current Key'],
    ['content_title', 'Content Title'], ['content_type', 'Content Type'],
    ['is_l2v', 'L2V'], ['duration_hours', 'Duration (hrs)'],
    ['ingestion_category', 'Ingestion Category'],
    ['mysql_status', 'MySQL Status'], ['cb_status', 'CB Status'],
    ['restoration_status', 'Restoration Status'], ['restoration_file_type', 'Restoration File Type'],
    ['external_id', 'External ID'],
    ['source_file_name', 'File Name'],
    ['video_created_time', 'Video Created Time'], ['encode_manifest_updated_time', 'Encode Manifest Updated Time'],
    ['video_to_encode_diff', 'Video-to-Encode Diff (hh:mm:ss)'],
    ['current_key_updated_date', 'Current Updated'],
    ['previous_key', 'Previous Key'], ['previous_key_updated_date', 'Previous Updated'],
    ['media_updated_date', 'Video/Audio/Caption/Image Created Date'],
    ['media_updated_file_type', 'Media File Type'],
  ]

  // Every active filter (one with a non-empty value) must match for a
  // row to pass -- AND-combined, not just the last one applied. A filter
  // with an empty value is ignored entirely rather than matching
  // everything or nothing. Computed at component level (not just inside
  // the Content List tab's own render) for the same reason as
  // contentColumns above -- downloadExcel() needs the exact same
  // currently-filtered rows the user is actually looking at.
  const activeContentListFilters = contentListFilters.filter(f => f.val.trim() !== '')
  const searchedRows = activeContentListFilters.length === 0
    ? filteredRows
    : filteredRows.filter(r =>
        activeContentListFilters.every(f => String(r[f.col] ?? '').toLowerCase().includes(f.val.trim().toLowerCase()))
      )


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
    if (!projectId) { setError('Select a project.'); return }
    if (rows.length === 0) { setError('Fetch data first, then download.'); return }
    setError(null); setExporting(true)
    try {
      // build_ingestion_excel's Date Wise sheet sections by calendar
      // month, so it still needs months[]/year specifically -- derived
      // from the same resolved from/to range the data was actually
      // fetched with, so the sections line up with what's really in the
      // data rather than an arbitrary/stale month selection.
      const { resolvedFrom, resolvedTo } = resolveDateRange()
      const { months: monthList, year } = deriveMonthsFromRange(resolvedFrom, resolvedTo)
      const res = await fetch(`${apiBase}/ingestion/export`, {
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
          year,
          rows,
          dvb_rows: dvbRows,
          include_dvb: includeDvb,
          include_archived_purged: includeArchivedPurged,
          // Only included when the user actually picked columns on the
          // Content List tab -- an empty selection means "skip this
          // sheet entirely" (handled on the backend), not "export
          // nothing" or "export everything" by default. Uses
          // searchedRows so the export reflects the user's own current
          // filters on that tab, not the full unfiltered rows list.
          ...(selectedExportColumns.length > 0 ? {
            content_list_columns: contentColumns.filter(([key]) => selectedExportColumns.includes(key)),
            content_list_rows: searchedRows,
          } : {}),
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
    <LocalizationProvider dateAdapter={AdapterDayjs}>
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
        <DateTimePicker
          label="From"
          value={fromDate ? dayjs(fromDate) : null}
          onChange={(newVal) => setFromDate(newVal && newVal.isValid() ? newVal.format('YYYY-MM-DDTHH:mm') : '')}
          slotProps={{
            textField: {
              size: 'small',
              title: 'Leave empty to default to the 1st of this month, 00:00',
              sx: { width: 200, '& .MuiInputBase-input': { fontSize: 13, padding: '8px 10px' } },
            },
          }}
        />
        <DateTimePicker
          label="To"
          value={toDate ? dayjs(toDate) : null}
          onChange={(newVal) => setToDate(newVal && newVal.isValid() ? newVal.format('YYYY-MM-DDTHH:mm') : '')}
          slotProps={{
            textField: {
              size: 'small',
              title: 'Leave empty to default to right now',
              sx: { width: 200, '& .MuiInputBase-input': { fontSize: 13, padding: '8px 10px' } },
            },
          }}
        />
        {(() => {
          // Live preview of exactly what will actually be used when Fetch
          // is clicked -- covers the gap left by datetime-local having no
          // OK/Apply button of its own: this shows immediately whether a
          // pick "took" and what the default resolves to when left empty,
          // without needing to click Fetch first to find out.
          const { resolvedFrom, resolvedTo } = resolveDateRange()
          return (
            <span style={{ fontSize: 11, color: C.muted, fontStyle: 'italic' }}>
              Will fetch: {resolvedFrom} → {resolvedTo}
            </span>
          )
        })()}
        <button onClick={fetchData} disabled={loading} style={{ ...btnStyle, opacity: loading ? 0.6 : 1 }}>{loading ? 'Loading…' : 'Fetch'}</button>
        <FormControl size="small">
          <MuiSelect
            value={refreshInterval}
            onChange={e => setRefreshInterval(e.target.value)}
            title="Auto-refresh: re-fetches on this cadence once a project is selected, using whatever From/To is currently set"
            sx={{ fontSize: 12, height: 34 }}
          >
            <MenuItem value="off" sx={{ fontSize: 12 }}>No auto-refresh</MenuItem>
            <MenuItem value="30s" sx={{ fontSize: 12 }}>Refresh every 30s</MenuItem>
            <MenuItem value="1m" sx={{ fontSize: 12 }}>Refresh every 1m</MenuItem>
            <MenuItem value="5m" sx={{ fontSize: 12 }}>Refresh every 5m</MenuItem>
            <MenuItem value="15m" sx={{ fontSize: 12 }}>Refresh every 15m</MenuItem>
          </MuiSelect>
        </FormControl>
        {refreshInterval !== 'off' && (
          <span style={{ fontSize: 11, color: C.pu, fontWeight: 600 }}>● auto-refreshing</span>
        )}
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
          const addFilter = () => {
            setContentListFilters(prev => [...prev, { id: Date.now(), col: 'content_id', val: '' }])
          }
          const removeFilter = (id) => {
            setContentListFilters(prev => prev.filter(f => f.id !== id))
          }
          const updateFilter = (id, patch) => {
            setContentListFilters(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f))
          }

          return (
            <div>
              <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                {contentListFilters.map(f => (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <select
                      value={f.col}
                      onChange={e => updateFilter(f.id, { col: e.target.value })}
                      style={{ padding: '7px 10px', borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: 'inherit' }}
                    >
                      {contentColumns.map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                    <input
                      value={f.val}
                      onChange={e => updateFilter(f.id, { val: e.target.value })}
                      placeholder={`Filter value for ${contentColumns.find(([k]) => k === f.col)?.[1] || ''}…`}
                      style={{ padding: '7px 10px', borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: 'inherit', width: 300 }}
                    />
                    {contentListFilters.length > 1 && (
                      <button
                        onClick={() => removeFilter(f.id)}
                        title="Remove this filter"
                        style={{ border: 'none', background: 'none', color: C.muted, fontSize: 16, cursor: 'pointer', padding: '0 4px' }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>
                  <button
                    onClick={addFilter}
                    style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${C.border}`, background: '#fff', color: C.pu, fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
                  >
                    + Add Filter
                  </button>
                  <span style={{ fontSize: 12, color: C.muted }}>{searchedRows.length} of {filteredRows.length} rows</span>
                  <button
                    onClick={() => setShowExportColumnPicker(v => !v)}
                    title="Choose which columns to include if you export this Content List view to Excel"
                    style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${C.border}`, background: selectedExportColumns.length > 0 ? '#f0ecff' : '#fff', color: C.pu, fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
                  >
                    {selectedExportColumns.length > 0 ? `${selectedExportColumns.length} column${selectedExportColumns.length === 1 ? '' : 's'} selected for export` : 'Select columns for export…'}
                  </button>
                  {showExportColumnPicker && (
                    <div style={{
                      position: 'absolute', top: '110%', left: 0, zIndex: 50,
                      background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8,
                      padding: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', width: 320, maxHeight: 320, overflowY: 'auto',
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: C.text }}>
                        Columns to include in an exported "Content List" sheet
                      </div>
                      <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>
                        Leave none checked to skip adding this sheet entirely.
                      </div>
                      {contentColumns.map(([key, label]) => (
                        <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', fontSize: 12, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={selectedExportColumns.includes(key)}
                            onChange={e => {
                              setSelectedExportColumns(prev =>
                                e.target.checked ? [...prev, key] : prev.filter(k => k !== key)
                              )
                            }}
                          />
                          {label}
                        </label>
                      ))}
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                        <button
                          onClick={() => setSelectedExportColumns(contentColumns.map(([key]) => key))}
                          style={{ fontSize: 11, color: C.pu, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        >
                          Select all
                        </button>
                        <button
                          onClick={() => setSelectedExportColumns([])}
                          style={{ fontSize: 11, color: C.muted, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        >
                          Clear
                        </button>
                        <button
                          onClick={() => setShowExportColumnPicker(false)}
                          style={{ fontSize: 11, color: C.text, background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginLeft: 'auto' }}
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '10px 8px', borderBottom: `1px solid ${C.border}`, background: '#f0f0f8', width: 32 }} />
                      {contentColumns.map(([key, label]) => (
                        <th key={key} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: `1px solid ${C.border}`, background: '#f0f0f8', whiteSpace: 'nowrap' }}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {searchedRows.map((r, i) => {
                      const rowKey = r.current_key || i
                      const highlightColor = rowHighlights[rowKey]
                      return (
                        <tr key={rowKey} style={{ background: highlightColor || 'transparent' }}>
                          <td style={{ padding: '7px 8px', borderBottom: `1px solid ${C.border}`, position: 'relative', textAlign: 'center' }}>
                            <button
                              onClick={() => setColorPickerOpenFor(colorPickerOpenFor === rowKey ? null : rowKey)}
                              title="Highlight this row"
                              style={{
                                width: 16, height: 16, borderRadius: '50%', cursor: 'pointer', padding: 0,
                                border: `1.5px solid ${highlightColor ? '#00000033' : C.border}`,
                                background: highlightColor || '#fff',
                              }}
                            />
                            {colorPickerOpenFor === rowKey && (
                              <div style={{
                                position: 'absolute', top: '110%', left: 0, zIndex: 50,
                                background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8,
                                padding: 6, display: 'flex', gap: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                              }}>
                                {HIGHLIGHT_COLORS.map(c => (
                                  <button
                                    key={c.hex}
                                    title={c.name}
                                    onClick={() => {
                                      setRowHighlights(prev => ({ ...prev, [rowKey]: c.hex }))
                                      setColorPickerOpenFor(null)
                                    }}
                                    style={{ width: 18, height: 18, borderRadius: '50%', border: '1px solid #00000022', background: c.hex, cursor: 'pointer', padding: 0 }}
                                  />
                                ))}
                                <button
                                  title="Clear highlight"
                                  onClick={() => {
                                    setRowHighlights(prev => { const next = { ...prev }; delete next[rowKey]; return next })
                                    setColorPickerOpenFor(null)
                                  }}
                                  style={{ width: 18, height: 18, borderRadius: '50%', border: `1px solid ${C.border}`, background: '#fff', cursor: 'pointer', padding: 0, fontSize: 10, color: C.muted, lineHeight: 1 }}
                                >
                                  ✕
                                </button>
                              </div>
                            )}
                          </td>
                          {contentColumns.map(([key]) => (
                            <td key={key} style={{ padding: '7px 12px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap', color: r[key] == null ? '#cbd5e1' : C.text }}>
                              {key === 'is_l2v' ? (r[key] ? '✓' : '—')
                                : key === 'duration_hours' ? (r[key] != null ? Number(r[key]).toFixed(2) : '—')
                                : (r[key] ?? '—')}
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })()}

        {/* First load: no rows on screen yet, so a full-page block is safe --
            nothing shifts because there's nothing else to shift. */}
        {loading && rows.length === 0 && (
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
            {queueStatus && (
              <div style={{ fontSize: 12, color: queueStatus.waiting > 0 ? C.pu : C.muted, marginTop: 6, fontWeight: queueStatus.waiting > 0 ? 600 : 400 }}>
                {queueStatus.waiting > 0
                  ? `System is busy: ${queueStatus.active} of ${queueStatus.max_concurrent} query slots in use, ${queueStatus.waiting} request${queueStatus.waiting === 1 ? '' : 's'} waiting for a slot (may include yours)`
                  : `Query slots: ${queueStatus.active} of ${queueStatus.max_concurrent} in use — no queue right now`}
              </div>
            )}
            <style>{`
              @keyframes pmir-line-slide { 0% { left: -40% } 50% { left: 60% } 100% { left: 100% } }
              @keyframes pmir-hue-shift { 0% { background-position: 0% 50% } 100% { background-position: 300% 50% } }
            `}</style>
          </div>
        )}

        {/* Refetch (e.g. changing an input field and hitting Fetch again):
            the old table is still on screen -- every table section is
            gated on rows.length > 0, not on !loading. Rendering the
            full-page block here too used to add ~100vh of extra document
            height below the existing table, so the page scrolled down
            while loading and then visibly "snapped" back up the instant
            loading finished and that block unmounted. Fixed positioning
            adds zero document height, so nothing shifts and no scroll jump. */}
        {loading && rows.length > 0 && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
            padding: '10px 16px', background: 'rgba(255,255,255,0.96)',
            borderBottom: `1px solid ${C.border}`, boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{ width: 160, height: 5, background: C.border, borderRadius: 6, overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
              <div style={{
                position: 'absolute', top: 0, left: 0, height: '100%', width: '40%',
                background: 'linear-gradient(90deg, #7c6af7, #2563eb, #16a34a, #d97706, #dc2626, #7c6af7)',
                backgroundSize: '300% 100%',
                borderRadius: 6,
                animation: 'pmir-line-slide 1.2s ease-in-out infinite, pmir-hue-shift 2s linear infinite',
              }} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Refreshing…</span>
            {queueStatus && (
              <span style={{ fontSize: 12, color: queueStatus.waiting > 0 ? C.pu : C.muted, fontWeight: queueStatus.waiting > 0 ? 600 : 400 }}>
                {queueStatus.waiting > 0
                  ? `Busy: ${queueStatus.active}/${queueStatus.max_concurrent} slots, ${queueStatus.waiting} waiting`
                  : `Query slots: ${queueStatus.active}/${queueStatus.max_concurrent} in use — no queue`}
              </span>
            )}
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
    </LocalizationProvider>
  )
}
