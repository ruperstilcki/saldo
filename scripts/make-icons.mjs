// Draws the app icons into public/icons. Run once by hand: node scripts/make-icons.mjs
// The same icon as the Android app: android/app/src/main/res/drawable/ic_launcher_foreground.xml
// on the ic_launcher_background color. Like there, the drawing stays in the middle of a 108-unit
// square, because launchers cut the corners off.
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const WHITE = '#FFFFFF'
const BLUE = '#1E5BB8'
const SHAPES = [
  [WHITE, 'M32,38h40a6,6 0,0 1,6 6v24a6,6 0,0 1,-6 6h-40a6,6 0,0 1,-6 -6v-24a6,6 0,0 1,6 -6z'],
  [BLUE, 'M58,50h20v12h-20a6,6 0,0 1,0 -12z'],
  [WHITE, 'M64,56m-3,0a3,3 0,1 1,6 0a3,3 0,1 1,-6 0'],
  [WHITE, 'M36,30h30l4,8h-38z'],
]
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="100%" height="100%" style="display:block">
  <rect width="108" height="108" fill="${BLUE}"/>
  ${SHAPES.map(([fill, d]) => `<path fill="${fill}" d="${d}"/>`).join('\n  ')}
</svg>`

mkdirSync('public/icons', { recursive: true })
const browser = await chromium.launch()
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(`<body style="margin:0">${svg}</body>`)
  await page.screenshot({ path: `public/icons/icon-${size}.png` })
  await page.close()
}
await browser.close()
