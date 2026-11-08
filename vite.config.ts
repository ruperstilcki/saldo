/// <reference types="vitest/config" />
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/** Writes dist/_headers: the Content-Security-Policy needs the Supabase origin from the env. */
function securityHeaders(supabaseUrl: string | undefined): Plugin {
  return {
    name: 'saldo-security-headers',
    apply: 'build',
    closeBundle() {
      if (!supabaseUrl) throw new Error('VITE_SUPABASE_URL is required for a build')
      const origin = new URL(supabaseUrl).origin
      const csp = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' blob: data:",
        `connect-src 'self' ${origin}`,
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; ')
      const headers = [
        '/*',
        `  Content-Security-Policy: ${csp}`,
        '  X-Content-Type-Options: nosniff',
        '  Referrer-Policy: no-referrer',
        '/sw.js',
        '  Cache-Control: no-cache',
        '/',
        '  Cache-Control: no-cache',
        '',
      ].join('\n')
      writeFileSync(resolve(import.meta.dirname, 'dist/_headers'), headers)
      writeServiceWorker()
    },
  }
}

/** Lists every file of the build in dist/sw.js. Its content hash makes each build a new version. */
function writeServiceWorker() {
  const dist = resolve(import.meta.dirname, 'dist')
  const skip = new Set(['_headers', '_redirects', 'sw.js'])
  const files = readdirSync(dist, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !skip.has(entry.name))
    .map((entry) => relative(dist, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .sort()
  const hash = createHash('sha256')
  for (const file of files) hash.update(file).update(readFileSync(join(dist, file)))
  // Cloudflare Pages redirects /index.html to /, and a redirected page cannot be served offline.
  const urls = files.map((file) => (file === 'index.html' ? '/' : `/${file}`))
  const worker = readFileSync(resolve(import.meta.dirname, 'scripts/sw-template.js'), 'utf8')
    .replace('__VERSION__', hash.digest('hex').slice(0, 16))
    .replace('__FILES__', JSON.stringify(urls))
  writeFileSync(join(dist, 'sw.js'), worker)
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, import.meta.dirname), ...process.env }
  return {
    plugins: [react(), securityHeaders(env.VITE_SUPABASE_URL)],
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
      setupFiles: ['src/test/setup.ts'],
    },
  }
})
