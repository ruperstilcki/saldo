// Generated at build time from scripts/sw-template.js. Keeps only the app itself for offline use:
// no financial data passes through here, and requests to Supabase are left alone.
const CACHE = 'saldo-__VERSION__'
const FILES = __FILES__

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Past the HTTP cache: a new version must not store old files.
      .then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('saldo-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return

  // Every address of the app is the same page. A new version arrives on the next opening.
  const lookup = request.mode === 'navigate' ? '/' : request
  event.respondWith(caches.match(lookup).then((cached) => cached ?? fetch(request)))
})
