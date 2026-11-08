import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  reporter: 'list',
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    // A made-up Supabase address: every request to it is answered by the test itself.
    command: 'npx vite build --mode e2e && node e2e/serve.mjs',
    env: { VITE_SUPABASE_URL: 'https://fake-project.supabase.co', VITE_SUPABASE_KEY: 'sb_publishable_fake' },
    url: 'http://localhost:4173',
    reuseExistingServer: false,
  },
})
