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

export const CATEGORIES = ['newly_ingested', 'source_update', 'video_update', 'audio_update', 'image_update', 'subtitle_update', 'metadata_update']
export const CATEGORY_LABELS = {
  newly_ingested: 'Newly Ingested',
  source_update: 'Source Update',
  video_update: 'Video Update',
  audio_update: 'Audio Update',
  image_update: 'Image Update',
  subtitle_update: 'Subtitle Update',
  metadata_update: 'Metadata Update',
}
export const CB_STATUSES = ['published', 'draft', 'archived', 'purged']
export const STATUS_LABELS = { published: 'Published', draft: 'Draft', archived: 'Archived', purged: 'Purged', unknown: 'Unknown / No CB Match' }
export const STATUS_COLORS = { published: C.green, draft: C.blue, archived: C.amber, purged: C.red, unknown: C.muted }

// Backend URL, resolved in priority order:
//   1. VITE_API_URL, if set (e.g. in .env.local) -- the explicit override,
//      needed whenever the frontend and backend are on different hosts,
//      which is exactly the case when either one (or both) is exposed
//      through a separate ngrok tunnel with its own domain.
//   2. Falls back to localhost:8000 for local dev with no .env file at
//      all -- the previous hostname-sniffing approach broke the moment
//      the frontend was accessed via anything other than literally
//      "localhost" (an ngrok URL, a LAN IP, etc.), since window.location
//      has no way of knowing where a SEPARATE backend tunnel lives.
export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// ngrok's free tier shows an interstitial "this site is served by ngrok"
// warning page to ALL browser requests, before they ever reach the
// actual backend -- that page has none of the backend's own CORS
// headers, since Flask never even sees the request. This header tells
// ngrok to skip that page entirely and forward straight through. Has no
// effect (and is harmless) if the backend isn't behind ngrok at all.
export const FETCH_HEADERS = { 'ngrok-skip-browser-warning': 'true' }
