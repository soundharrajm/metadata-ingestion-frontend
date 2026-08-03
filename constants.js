// Styling convention matches the rest of this codebase's React components
// (inline styles, this specific color palette) rather than introducing a
// new one.
export const C = {
  border: 'rgba(0,0,0,0.08)',
  pu: '#7c6af7',
  green: '#16a34a',
  red: '#dc2626',
  amber: '#d97706',
  blue: '#2563eb',
  mono: "'JetBrains Mono', monospace",
  text: '#1a1a2e',
  muted: '#64748b',
}

export const CATEGORIES = ['newly_ingested', 'source_update', 'image_update', 'subtitle_update', 'metadata_update']
export const CATEGORY_LABELS = {
  newly_ingested: 'Newly Ingested',
  source_update: 'Source Update',
  image_update: 'Image Update',
  subtitle_update: 'Subtitle Update',
  metadata_update: 'Metadata Update',
}
export const CB_STATUSES = ['published', 'draft', 'archived', 'purged']
export const STATUS_LABELS = { published: 'Published', draft: 'Draft', archived: 'Archived', purged: 'Purged', unknown: 'Unknown / No CB Match' }
export const STATUS_COLORS = { published: C.green, draft: C.blue, archived: C.amber, purged: C.red, unknown: C.muted }

export const API_BASE = window.location.hostname === 'localhost' && window.location.port !== '8000'
  ? 'http://localhost:8000'
  : ''
