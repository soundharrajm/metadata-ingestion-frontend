import { CATEGORIES, CB_STATUSES } from './constants.js'

// Groups the row-level list into a grid keyed by whatever getRowKey()
// returns x ingestion_category -- each cell holds the actual matching
// rows (not just a count), so a cell can be clicked to drill down to the
// real content_id/content_key list behind that number, rather than the
// count being a dead end. Shared by both the CB-status cross-tab and the
// content-type cross-tab below, so they can't drift out of sync with
// each other's grouping logic.
function buildCrossTabGeneric(rows, getRowKey, rowKeys) {
  const grid = {}
  rowKeys.forEach(k => { grid[k] = {}; CATEGORIES.forEach(c => { grid[k][c] = [] }) })
  rows.forEach(row => {
    const key = getRowKey(row)
    if (grid[key] && grid[key][row.ingestion_category] !== undefined) {
      grid[key][row.ingestion_category].push(row)
    }
  })
  return grid
}

export function buildCrossTab(rows) {
  return buildCrossTabGeneric(
    rows,
    r => CB_STATUSES.includes(r.cb_status) ? r.cb_status : 'unknown',
    [...CB_STATUSES, 'unknown']
  )
}

// Same idea, but rows grouped by content_type instead of cb_status.
// contentTypes is passed in rather than hardcoded, since it's dynamically
// derived from whatever's actually present in the fetched data (same
// auto-detect principle as the content-type filter dropdown) -- a
// content_type that's never been seen before just gets its own row here
// automatically, no code change needed.
export function buildContentTypeCrossTab(rows, contentTypes) {
  return buildCrossTabGeneric(
    rows,
    r => r.content_type || 'unknown',
    [...contentTypes, 'unknown']
  )
}

// Extracts just the date portion (YYYY-MM-DD) from current_key_updated_date
// -- that field comes back from the backend as a full timestamp string
// (e.g. "2026-07-06 11:00:00"), so a plain string split on the space is
// enough here without needing a real date-parsing library.
function dateOnly(timestamp) {
  if (!timestamp) return null
  return String(timestamp).split(' ')[0]
}

// Returns the sorted list of distinct dates actually present in rows --
// same auto-detect principle as content types: whatever dates exist in
// the fetched data become the rows, nothing hardcoded or assumed about
// which days fall within the selected month.
export function getAvailableDates(rows) {
  return [...new Set(rows.map(r => dateOnly(r.current_key_updated_date)).filter(Boolean))].sort()
}

// Same idea again, but rows grouped by date instead of cb_status/content_type.
export function buildDateCrossTab(rows, dates) {
  return buildCrossTabGeneric(
    rows,
    r => dateOnly(r.current_key_updated_date) || 'unknown',
    [...dates, 'unknown']
  )
}
