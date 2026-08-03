import { CATEGORIES, CB_STATUSES } from './constants.js'

// Groups the row-level list into a status x category grid -- each cell
// holds the actual matching rows (not just a count), so a cell can be
// clicked to drill down to the real content_id/content_key list behind
// that number, rather than the count being a dead end.
export function buildCrossTab(rows) {
  const grid = {}
  const allStatuses = [...CB_STATUSES, 'unknown']
  allStatuses.forEach(s => { grid[s] = {}; CATEGORIES.forEach(c => { grid[s][c] = [] }) })
  rows.forEach(row => {
    const status = CB_STATUSES.includes(row.cb_status) ? row.cb_status : 'unknown'
    if (grid[status] && grid[status][row.ingestion_category] !== undefined) {
      grid[status][row.ingestion_category].push(row)
    }
  })
  return grid
}
