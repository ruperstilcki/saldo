// Draws the app icons into public/icons. Run once by hand: node scripts/make-icons.mjs
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

mkdirSync('public/icons', { recursive: true })
const browser = await chromium.launch()
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  // The S stays inside the middle of the icon, because launchers cut the corners off.
  await page.setContent(`<body style="margin:0;background:#1e5bb8;display:grid;place-items:center;height:100vh">
    <span style="font:700 ${Math.round(size * 0.52)}px system-ui,sans-serif;color:#fff;line-height:1">S</span></body>`)
  await page.screenshot({ path: `public/icons/icon-${size}.png` })
  await page.close()
}
await browser.close()
