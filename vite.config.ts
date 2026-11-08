/// <reference types="vitest/config" />
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
        '',
      ].join('\n')
      writeFileSync(resolve(import.meta.dirname, 'dist/_headers'), headers)
    },
  }
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
