// Serves dist/ like Cloudflare Pages would: with dist/_headers and the SPA fallback. Tests only.
import { readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }
const headers = Object.fromEntries(
  readFileSync('dist/_headers', 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('  '))
    .map((line) => {
      const [name, ...value] = line.trim().split(': ')
      return [name, value.join(': ')]
    }),
)

createServer((req, res) => {
  const path = normalize(new URL(req.url, 'http://x').pathname)
  let file = join('dist', path)
  try {
    if (!statSync(file).isFile()) file = 'dist/index.html'
  } catch {
    file = 'dist/index.html'
  }
  res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
}).listen(4173)
