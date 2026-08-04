import { C } from './constants.js'

export default function DrillDownModal({ items, onClose }) {
  if (!items) return null
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#fff', borderRadius: 12, width: 820, maxHeight: '75vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{items.length} item{items.length === 1 ? '' : 's'}</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 16, cursor: 'pointer', color: C.muted }}>✕</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#f8f8fc' }}>
              <tr>
                {['Content ID', 'Current Key', 'Content Title', 'Content Type', 'L2V', 'Duration (hrs)', 'MySQL Status', 'CB Status', 'Current Updated', 'Previous Key', 'Media Updated'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: '7px 12px', borderBottom: `1px solid ${C.border}` }}>{r.content_id}</td>
                  <td style={{ padding: '7px 12px', borderBottom: `1px solid ${C.border}`, fontFamily: C.mono }}>{r.current_key}</td>
                  <td style={{ padding: '7px 12px', borderBottom: `1px solid ${C.border}` }}>{r.content_title || '—'}</td>
                  <td style={{ padding: '7px 12px', borderBottom: `1px solid ${C.border}` }}>{r.content_type || '—'}</td>
                  <td style={{ padding: '7px 12px', borderBottom: `1px solid ${C.border}` }}>{r.is_l2v ? '✓' : '—'}</td>
                  <td style={{ padding: '7px 12px', borderBottom: `1px solid ${C.border}`, fontFamily: C.mono }}>{r.duration_hours != null ? Number(r.duration_hours).toFixed(2) : '—'}</td>
                  <td style={{ padding: '7px 12px', borderBottom: `1px solid ${C.border}`, color: C.muted }}>{r.mysql_status || '—'}</td>
                  <td style={{ padding: '7px 12px', borderBottom: `1px solid ${C.border}`, color: C.muted }}>{r.cb_status || '—'}</td>
                  <td style={{ padding: '7px 12px', borderBottom: `1px solid ${C.border}`, color: C.muted }}>{r.current_key_updated_date}</td>
                  <td style={{ padding: '7px 12px', borderBottom: `1px solid ${C.border}`, fontFamily: C.mono, color: C.muted }}>{r.previous_key || '—'}</td>
                  <td style={{ padding: '7px 12px', borderBottom: `1px solid ${C.border}`, color: C.muted }}>{r.media_updated_date || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
