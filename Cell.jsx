import { C } from './constants.js'

export default function Cell({ items, onClick }) {
  const count = items.length
  return (
    <td
      onClick={() => count > 0 && onClick(items)}
      style={{
        padding: '10px 12px', textAlign: 'center', fontSize: 13, fontWeight: 700,
        cursor: count > 0 ? 'pointer' : 'default',
        color: count > 0 ? C.text : '#cbd5e1',
        background: count > 0 ? 'rgba(124,106,247,0.04)' : 'transparent',
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      {count > 0 ? count : '—'}
    </td>
  )
}
