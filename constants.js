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

export const CATEGORIES = ['newly_ingested', 'video_update', 'audio_update', 'image_update', 'subtitle_update', 'metadata_update']
export const CATEGORY_LABELS = {
  newly_ingested: 'Newly Ingested',
  video_update: 'Video Update',
  audio_update: 'Audio Update',
  image_update: 'Image Update',
  subtitle_update: 'Subtitle Update',
  metadata_update: 'Metadata Update',
}
export const CB_STATUSES = ['published', 'draft', 'archived', 'purged']
export const STATUS_LABELS = { published: 'Published', draft: 'Draft', archived: 'Archived', purged: 'Purged' }
export const STATUS_COLORS = { published: C.green, draft: C.blue, archived: C.amber, purged: C.red }

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

// Resolves which backend base URL to actually use, checking reachability
// at RUNTIME rather than trusting the build-time API_BASE blindly. Tries
// API_BASE first (a deployed/tunneled backend meant to be reachable by
// anyone); if that doesn't respond within a short timeout, falls back to
// http://localhost:8000 -- covering the case where a specific user runs
// their OWN backend locally instead of relying on a shared one. Caches
// the result in-memory for the rest of the session once resolved, so
// every subsequent fetch call doesn't re-run this health check --
// only re-checks if explicitly asked to (see forceRecheck below).
//
// This does NOT solve reachability by itself -- if API_BASE is
// unreachable AND the user has nothing running on their own localhost
// either, this correctly falls through to reporting that (via the
// caller's own error handling), rather than silently defaulting to a
// URL that doesn't work.
let _resolvedApiBase = null

export async function resolveApiBase(forceRecheck = false) {
  if (_resolvedApiBase && !forceRecheck) return _resolvedApiBase

  const tryReach = async (base, timeoutMs = 2500) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(`${base}/health`, { headers: FETCH_HEADERS, signal: controller.signal })
      return res.ok
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  if (await tryReach(API_BASE)) {
    _resolvedApiBase = API_BASE
    return _resolvedApiBase
  }

  // Only worth trying a separate localhost fallback if API_BASE isn't
  // ALREADY localhost:8000 -- otherwise this would just repeat the exact
  // same failed check a second time for no reason.
  const localFallback = 'http://localhost:8000'
  if (API_BASE !== localFallback && await tryReach(localFallback)) {
    _resolvedApiBase = localFallback
    return _resolvedApiBase
  }

  // Both failed -- fall through to API_BASE anyway (rather than null),
  // so the caller's own fetch still runs and produces a real, specific
  // network error the user can see, instead of this function silently
  // returning nothing and masking what actually went wrong.
  _resolvedApiBase = API_BASE
  return _resolvedApiBase
}
