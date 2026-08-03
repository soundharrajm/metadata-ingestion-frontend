import { useState, useRef, useEffect } from 'react'
import { C } from './constants.js'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// The underlying `months` value stays the same comma-separated string
// format the backend already expects (e.g. "7" or "7,8") -- this
// component just gives it a proper multi-select UI instead of requiring
// the user to type that format by hand. A native <select multiple>
// requires ctrl-click to pick more than one, which is easy to miss --
// this is a checkbox dropdown instead, closing on an explicit "Done" or
// a click outside, matching the same open/close convention as the
// Assign Environment context menu elsewhere in this codebase's style.
export default function MonthYearPicker({ months, year, onMonthsChange, onYearChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  const selectedMonths = months.split(',').map(m => parseInt(m.trim())).filter(Boolean)

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const toggleMonth = (monthNum) => {
    const next = selectedMonths.includes(monthNum)
      ? selectedMonths.filter(m => m !== monthNum)
      : [...selectedMonths, monthNum]
    onMonthsChange(next.sort((a, b) => a - b).join(','))
  }

  const label = selectedMonths.length === 0
    ? 'Select months…'
    : selectedMonths.map(m => MONTH_NAMES[m - 1]).join(', ')

  const currentYear = new Date().getFullYear()
  const yearOptions = []
  for (let y = currentYear - 4; y <= currentYear + 1; y++) yearOptions.push(y)

  const inputStyle = { padding: '7px 10px', borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: 'inherit' }

  return (
    <>
      <div ref={ref} style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen(v => !v)}
          style={{ ...inputStyle, background: '#fff', cursor: 'pointer', minWidth: 150, textAlign: 'left', color: selectedMonths.length ? C.text : '#94a3b8' }}
        >
          {label} ▾
        </button>
        {open && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 100,
            background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 8, width: 160,
          }}>
            {MONTH_NAMES.map((name, i) => {
              const monthNum = i + 1
              const checked = selectedMonths.includes(monthNum)
              return (
                <label key={monthNum} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 5, cursor: 'pointer', fontSize: 13 }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f8f8fc'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <input type="checkbox" checked={checked} onChange={() => toggleMonth(monthNum)} />
                  {name}
                </label>
              )
            })}
          </div>
        )}
      </div>

      <select value={year} onChange={e => onYearChange(parseInt(e.target.value))} style={{ ...inputStyle, width: 90 }}>
        {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </>
  )
}
