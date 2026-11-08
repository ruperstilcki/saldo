import { expect, test, type Page } from '@playwright/test'

const SUPABASE = 'https://fake-project.supabase.co'
const STORAGE_KEY = 'sb-fake-project-auth-token'
const UID = '11111111-1111-4111-8111-111111111111'
const DAY = 24 * 60 * 60 * 1000

const common = { user_id: UID, created_at: 1, deleted_at: null }
const wallet = {
  ...common, id: 'w1', name: 'Test wallet', wallet_type: 'BANK', currency_code: 'RSD', opening_balance_minor: 100000,
  image_hash: null, color: -14787912, sort_order: 0, is_archived: false, checker_transaction_id: null, note: null, legacy_id: null, updated_at: 10,
}
const tx = {
  ...common, id: 't1', wallet_id: 'w1', kind: 'EXPENSE', amount_minor: 145996, occurred_at: Date.UTC(2026, 9, 15), category_id: null,
  note: 'Made up note', original_amount_minor: null, original_currency: null, transfer_id: null, source: 'MANUAL',
  recurring_rule_id: null, period_key: null, legacy_id: null, updated_at: 11,
}
const category = {
  ...common, id: 'c1', name: 'Other', level: 'MAIN', parent_id: null, kind: 'BOTH', is_quick_pick: false,
  exclude_from_stats: false, match_keywords: null, color: null, sort_order: 0, updated_at: 12,
}

interface Server {
  upserts: { table: string; body: Record<string, unknown>[] }[]
  logouts: string[]
  offline: boolean
  uploads: { path: string; type: string | null }[]
  /** Rows that later rounds will receive, as if another device had sent them. */
  rows: Record<string, unknown[]>
}

/** Answers everything the app asks of Supabase, and records what it sends. */
async function fakeSupabase(page: Page, rows: Record<string, unknown[]> = { wallets: [wallet], transactions: [tx], categories: [category] }): Promise<Server> {
  const server: Server = { upserts: [], logouts: [], offline: false, uploads: [], rows }
  await page.route(`${SUPABASE}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (server.offline) return route.abort('internetdisconnected')
    if (url.pathname === '/auth/v1/logout') {
      server.logouts.push(url.searchParams.get('scope') ?? '')
      return route.fulfill({ status: 204, headers: cors })
    }
    if (url.pathname.startsWith('/storage/v1/object/')) {
      server.uploads.push({ path: url.pathname.replace('/storage/v1/object/', ''), type: request.headers()['content-type'] ?? null })
      return route.fulfill({ json: { Key: 'x', Id: 'x' }, headers: cors })
    }
    if (url.pathname === '/rest/v1/rpc/saldo_now_ms') return route.fulfill({ json: Date.now(), headers: cors })
    const table = url.pathname.replace('/rest/v1/', '')
    if (request.method() === 'POST') {
      server.upserts.push({ table, body: request.postDataJSON() })
      return route.fulfill({ status: 201, headers: cors })
    }
    const since = Number(url.searchParams.get('updated_at')?.replace('gt.', '') ?? 0)
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const result = (rows[table] ?? []).filter((r) => (r as { updated_at: number }).updated_at > since).slice(offset)
    return route.fulfill({ json: result, headers: cors })
  })
  return server
}

/** Opens the app as a signed-in user, without Google. */
async function signedIn(page: Page, lastOpenedAt = Date.now()) {
  await page.addInitScript(
    ({ key, uid, opened }) => {
      if (sessionStorage.getItem('seeded')) return
      sessionStorage.setItem('seeded', '1')
      localStorage.setItem(key, JSON.stringify({
        access_token: 'fake.fake.fake', refresh_token: 'fake', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: uid, email: 'test@example.com', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
      }))
      localStorage.setItem('saldo.lastOpenedAt', String(opened))
    },
    { key: STORAGE_KEY, uid: UID, opened: lastOpenedAt },
  )
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
}

async function walletAction(page: Page, name: string) {
  await page.getByRole('button', { name: 'More' }).click()
  await page.getByRole('button', { name, exact: true }).click()
}

const cspProblems = (page: Page) => {
  const problems: string[] = []
  page.on('console', (m) => {
    if (m.text().includes('Content Security Policy')) problems.push(m.text())
  })
  return problems
}

test('signed out: only the sign-in screen, and Google goes through PKCE', async ({ page }) => {
  const problems = cspProblems(page)
  let authorize: URL | null = null
  await page.route(`${SUPABASE}/auth/v1/authorize**`, (route) => {
    authorize = new URL(route.request().url())
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'ok' })
  })

  await page.goto('/any/deep/link')
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Wallets' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Sign in with Google' }).click()

  await expect.poll(() => authorize?.searchParams.get('provider')).toBe('google')
  expect(authorize!.searchParams.get('code_challenge')).toBeTruthy()
  expect(authorize!.searchParams.get('redirect_to')).toBe('http://localhost:4173/')
  expect(problems).toEqual([])
})

test('shows the balance from synced rows, to the para', async ({ page }) => {
  const problems = cspProblems(page)
  await fakeSupabase(page)
  await signedIn(page)
  await page.goto('/')

  // 1.000,00 opening − 1.459,96 expense
  await expect(page.getByRole('button', { name: /Test wallet/ })).toContainText('−459,96 RSD')
  expect(problems).toEqual([])
})

test('editing a note is pushed with the protocol fields, and survives', async ({ page }) => {
  const server = await fakeSupabase(page)
  await signedIn(page)
  await page.goto('/')

  await page.getByRole('button', { name: /Test wallet/ }).click()
  await page.locator('.tx', { hasText: /Made up note/ }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByLabel('Note', { exact: true }).fill('Edited on the web')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('button', { name: 'Sync now' }).click()

  await expect.poll(() => server.upserts.length).toBeGreaterThan(0)
  const sent = server.upserts[0]!
  expect(sent.table).toBe('transactions')
  expect(sent.body[0]).toMatchObject({ id: 't1', note: 'Edited on the web', deleted_at: null, created_at: 1, user_id: UID })
  expect(sent.body[0]).not.toHaveProperty('updated_at')
  await expect(page.getByRole('status')).not.toContainText('unsent')
})

test('offline: the change stays and goes out when the connection returns', async ({ page }) => {
  const server = await fakeSupabase(page)
  await signedIn(page)
  await page.goto('/')
  await page.getByRole('button', { name: /Test wallet/ }).click()

  server.offline = true
  await page.locator('.tx', { hasText: /Made up note/ }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByLabel('Note', { exact: true }).fill('Offline edit')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('button', { name: 'Sync now' }).click()
  await expect(page.getByRole('status')).toContainText('1 unsent')
  await expect(page.locator('.tx', { hasText: /Offline edit/ })).toBeVisible()
  expect(server.upserts).toEqual([])

  server.offline = false
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect.poll(() => server.upserts.length).toBeGreaterThan(0)
  await expect(page.getByRole('status')).not.toContainText('unsent')
})

test('Sign out ends only the web session and clears local data', async ({ page }) => {
  const server = await fakeSupabase(page)
  await signedIn(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: /Test wallet/ })).toBeVisible()

  await signOut(page)

  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
  expect(server.logouts).toEqual(['local'])
  const count = await page.evaluate(() => new Promise<number>((resolve) => {
    const open = indexedDB.open('saldo')
    open.onsuccess = () => {
      const request = open.result.transaction('wallets').objectStore('wallets').count()
      request.onsuccess = () => resolve(request.result)
    }
  }))
  expect(count).toBe(0)
})

test('a session opened 29 days ago continues, one opened 30 days ago ends', async ({ page, context }) => {
  await fakeSupabase(page)
  await signedIn(page, Date.now() - 29 * DAY)
  await page.goto('/')
  await expect(page.getByRole('button', { name: /Test wallet/ })).toBeVisible()
  const refreshed = await page.evaluate(() => Number(localStorage.getItem('saldo.lastOpenedAt')))
  expect(Date.now() - refreshed).toBeLessThan(DAY)

  const expired = await context.newPage()
  const server = await fakeSupabase(expired)
  await signedIn(expired, Date.now() - 30 * DAY)
  await expired.goto('/')
  await expect(expired.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
  expect(server.logouts).toEqual(['local'])
})

test('leaving without a connection: unsent changes stay hidden and return with the same account', async ({ page }) => {
  const server = await fakeSupabase(page)
  await signedIn(page)
  await page.goto('/')
  await page.getByRole('button', { name: /Test wallet/ }).click()
  server.offline = true
  await page.locator('.tx', { hasText: /Made up note/ }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByLabel('Note', { exact: true }).fill('Kept while signed out')
  await page.getByRole('button', { name: 'Save' }).click()
  await signOut(page)
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
  await expect(page.getByText('Kept while signed out')).toHaveCount(0)

  server.offline = false
  await page.evaluate(({ key, uid }) => {
    localStorage.setItem(key, JSON.stringify({
      access_token: 'fake.fake.fake', refresh_token: 'fake', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: uid, email: 'test@example.com', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
    }))
    localStorage.setItem('saldo.lastOpenedAt', String(Date.now()))
  }, { key: STORAGE_KEY, uid: UID })
  await page.reload()

  await expect.poll(() => server.upserts.flatMap((u) => u.body).map((row) => row.note)).toContain('Kept while signed out')
})

test('an account without categories is told to open the phone first', async ({ page }) => {
  await fakeSupabase(page, { wallets: [wallet] })
  await signedIn(page)
  await page.goto('/')
  await expect(page.getByText('Open Saldo on your phone once')).toBeVisible()
})

// ---------------------------------------------------------------- W2

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 30).getTime()
const color = { blue: -14787912 }
const makeTx = (id: string, occurred_at: number, amount_minor: number, kind = 'EXPENSE', extra: Record<string, unknown> = {}) => ({
  ...tx, id, occurred_at, amount_minor, kind, note: `Note ${id}`, updated_at: 20, ...extra,
})

const main = { ...category, id: 'main', name: 'Groceries', color: color.blue, updated_at: 12 }
const sub = { ...category, id: 'sub', name: 'Shop', level: 'SUB', parent_id: 'main', color: null, updated_at: 12 }
const second = { ...wallet, id: 'w2', name: 'Second wallet', currency_code: 'EUR', opening_balance_minor: 500, sort_order: 1, updated_at: 10 }
const third = { ...wallet, id: 'w3', name: 'Third wallet', opening_balance_minor: 700, sort_order: 2, updated_at: 10 }
const old = { ...wallet, id: 'w4', name: 'Old wallet', is_archived: true, sort_order: 3, updated_at: 10 }

const tableRows = {
  wallets: [wallet, second, third, old],
  categories: [main, sub],
  transactions: [
    makeTx('nov', at(2026, 11, 5), 1000, 'EXPENSE', { category_id: 'sub' }),
    makeTx('oct-out', at(2026, 10, 31), 34000),
    makeTx('oct-in', at(2026, 10, 4), 13000000, 'INCOME'),
    makeTx('dec', at(2025, 12, 31), 25000),
    makeTx('sms', at(2025, 12, 1), 500, 'EXPENSE', {
      note: 'Placeno kart.br. 111111_2222 / LIDL 124 BEOGRAD / Beograd RS / RSD 1.437,04 / Raspolozivo: RSD 1,00',
    }),
  ],
}

async function openWallet(page: Page, rows: Record<string, unknown[]> = tableRows, viewport = { width: 1400, height: 900 }) {
  await page.setViewportSize(viewport)
  const server = await fakeSupabase(page, rows)
  await signedIn(page)
  await page.goto('/')
  await page.getByRole('button', { name: /Test wallet/ }).click()
  await expect(page.getByRole('button', { name: /November 2026/ })).toBeVisible()
  return server
}

test('the table groups by year and month, with totals and end balances', async ({ page }) => {
  const problems = cspProblems(page)
  await openWallet(page)

  // Opening 1.000,00. Same figures as the phone's TableModel rules.
  const october = page.getByRole('button', { name: /October 2026/ })
  await expect(october).toContainText('−340,00')
  await expect(october).toContainText('+130.000,00')
  await expect(october).toContainText('130.405,00') // 1.000,00 − 255,00 + 130.000,00 − 340,00
  await expect(october).toContainText('2 items')
  const y2025 = page.getByRole('button', { name: /^2025/ })
  await expect(y2025).toContainText('745,00')
  await expect(page.locator('.tx', { hasText: /Note nov/ })).toContainText('05.11.2026')
  await expect(page.locator('.tx', { hasText: /Note nov/ })).toContainText('Shop · Groceries')
  expect(problems).toEqual([])
})

test('a pasted SMS shows the merchant, and the details show the whole note', async ({ page }) => {
  await openWallet(page)
  await page.locator('.tx', { hasText: /LIDL 124 BEOGRAD/ }).click()
  await expect(page.getByRole('dialog', { name: 'Transaction details' })).toContainText('Placeno kart.br. 111111_2222')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('months and years collapse and expand', async ({ page }) => {
  await openWallet(page)
  await page.getByRole('button', { name: /October 2026/ }).click()
  await expect(page.locator('.tx', { hasText: /Note oct-out/ })).toHaveCount(0)
  await expect(page.locator('.tx', { hasText: /Note nov/ })).toBeVisible()
  await page.getByRole('button', { name: /October 2026/ }).click()
  await expect(page.locator('.tx', { hasText: /Note oct-out/ })).toBeVisible()

  await page.getByRole('button', { name: /^2025/ }).click()
  await expect(page.getByRole('button', { name: /December 2025/ })).toHaveCount(0)
})

test('the month header stays on top while scrolling', async ({ page }) => {
  const many = Array.from({ length: 120 }, (_, i) => makeTx(`m${i}`, at(2026, 10, 15) - i, 100))
  await openWallet(page, { ...tableRows, transactions: [...many, tableRows.transactions[0]!] }, { width: 1400, height: 600 })
  const table = page.locator('.table')
  await table.evaluate((el) => { el.scrollTop = el.scrollHeight / 2 })
  const header = page.getByRole('button', { name: /October 2026/ })
  const [tableBox, headerBox] = [await table.boundingBox(), await header.boundingBox()]
  expect(Math.abs(headerBox!.y - tableBox!.y)).toBeLessThan(2)
})

test('the checker is unique, opens its collapsed month and lands in the middle', async ({ page }) => {
  // Rows on both sides, so the list can scroll far enough to center the row.
  const newer = Array.from({ length: 80 }, (_, i) => makeTx(`m${i}`, at(2026, 11, 3) - i, 100))
  const older = Array.from({ length: 80 }, (_, i) => makeTx(`o${i}`, at(2025, 11, 3) - i, 100))
  await openWallet(page, { ...tableRows, transactions: [...newer, ...older, ...tableRows.transactions] }, { width: 1400, height: 700 })
  await expect(page.getByRole('button', { name: 'Go to checker' })).toBeDisabled()

  const row = page.locator('.tx', { hasText: /Note oct-out/ })
  await row.click()
  await page.getByRole('button', { name: 'Set checker' }).click()
  await expect(row).toHaveClass(/checker/)

  await page.locator('.tx', { hasText: /Note nov/ }).click()
  await page.getByRole('button', { name: 'Set checker' }).click()
  await expect(page.locator('.tx.checker')).toHaveCount(1)
  await page.locator('.tx', { hasText: /Note oct-out/ }).click()
  await page.getByRole('button', { name: 'Set checker' }).click()

  await page.getByRole('button', { name: /October 2026/ }).click()
  await page.getByRole('button', { name: /^2026/ }).click()
  await page.getByRole('button', { name: 'Go to checker' }).click()
  await expect(row).toBeVisible()
  const [box, tableBox] = [await row.boundingBox(), await page.locator('.table').boundingBox()]
  const middle = tableBox!.y + tableBox!.height / 2
  expect(Math.abs(box!.y + box!.height / 2 - middle)).toBeLessThan(40)
})

test('setting the checker is sent to the server', async ({ page }) => {
  const server = await openWallet(page)
  await page.locator('.tx', { hasText: /Note nov/ }).click()
  await page.getByRole('button', { name: 'Set checker' }).click()
  await page.getByRole('button', { name: 'Sync now' }).click()
  await expect.poll(() => server.upserts.find((u) => u.table === 'wallets')?.body[0]?.checker_transaction_id).toBe('nov')
})

test('wallets: total per currency, this month and archived kept apart', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await fakeSupabase(page, { wallets: [wallet, second, third, old], categories: [main], transactions: [makeTx('now', Date.now(), 1500)] })
  await signedIn(page)
  await page.goto('/')
  const total = page.getByRole('region', { name: 'Total' })
  await expect(total).toContainText('992,00 RSD') // 1.000,00 + 7,00 opening, −15,00 expense
  await expect(total).toContainText('5,00 EUR')
  await expect(total).toContainText('This month spent: −15,00 RSD')
  await expect(page.getByRole('button', { name: /Old wallet/ })).toHaveCount(0)

  await page.getByRole('button', { name: /Archived wallets \(1\)/ }).click()
  await expect(page.getByRole('button', { name: /Old wallet/ })).toBeVisible()
})

const dragWallets = { wallets: [wallet, second, third], categories: [main], transactions: [] }
const walletNames = (page: Page) => page.locator('.wallet-name').allInnerTexts()
const INITIAL = ['Test wallet', 'Second wallet', 'Third wallet']

async function openWalletList(page: Page) {
  const server = await fakeSupabase(page, dragWallets)
  await signedIn(page)
  await page.goto('/')
  await expect.poll(() => walletNames(page)).toEqual(INITIAL)
  return server
}

const cardBox = async (page: Page, name: RegExp) => (await page.getByRole('button', { name }).boundingBox())!

test.describe('reordering with a mouse', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('dragging a card moves it, follows the pointer, and syncs the order', async ({ page }) => {
    const server = await openWalletList(page)
    const from = await cardBox(page, /Test wallet/)
    const to = await cardBox(page, /Third wallet/)
    const x = from.x + from.width / 2

    await page.mouse.move(x, from.y + 20)
    await page.mouse.down()
    await page.mouse.move(x, to.y + to.height - 5, { steps: 12 })

    // In the air: the card follows the pointer and the others made room.
    await expect(page.locator('.card-item.dragging')).toHaveCount(1)
    const held = await page.locator('.card-item.dragging').boundingBox()
    expect(Math.abs(held!.y + 20 - (to.y + to.height - 5))).toBeLessThan(10)
    await expect.poll(() => walletNames(page)).toEqual(['Second wallet', 'Third wallet', 'Test wallet'])

    await page.mouse.up()
    await expect(page.locator('.card-item.dragging')).toHaveCount(0)
    await expect(page).toHaveURL(/\/$/) // the drop did not open the wallet
    await expect.poll(() => walletNames(page)).toEqual(['Second wallet', 'Third wallet', 'Test wallet'])

    await expect(page.getByRole('status')).toContainText('3 unsent')
    await page.getByRole('button', { name: 'Sync now' }).click()
    await expect.poll(() => server.upserts.find((u) => u.table === 'wallets')?.body.map((r) => [r.id, r.sort_order]).sort()).toEqual([
      ['w1', 2], ['w2', 0], ['w3', 1],
    ])
    await expect(page.getByRole('status')).not.toContainText('unsent')
  })

  test('the order stays after a reload', async ({ page }) => {
    await openWalletList(page)
    const from = await cardBox(page, /Third wallet/)
    const to = await cardBox(page, /Test wallet/)
    const x = from.x + from.width / 2
    await page.mouse.move(x, from.y + 20)
    await page.mouse.down()
    await page.mouse.move(x, to.y + 2, { steps: 12 })
    await page.mouse.up()
    await expect.poll(() => walletNames(page)).toEqual(['Third wallet', 'Test wallet', 'Second wallet'])
    await expect(page.getByRole('status')).toContainText('unsent')
    await page.reload()
    await expect.poll(() => walletNames(page)).toEqual(['Third wallet', 'Test wallet', 'Second wallet'])
  })

  test('a plain click still opens the wallet', async ({ page }) => {
    await openWalletList(page)
    await page.getByRole('button', { name: /Second wallet/ }).click()
    await expect(page).toHaveURL(/\/wallet\/w2$/)
    await expect.poll(() => walletNames(page)).toEqual(INITIAL)
  })

  test('Escape puts the card back, and nothing goes out', async ({ page }) => {
    const server = await openWalletList(page)
    const from = await cardBox(page, /Test wallet/)
    const to = await cardBox(page, /Third wallet/)
    const x = from.x + from.width / 2
    await page.mouse.move(x, from.y + 20)
    await page.mouse.down()
    await page.mouse.move(x, to.y + to.height - 5, { steps: 12 })
    await page.keyboard.press('Escape')
    await expect(page.locator('.card-item.dragging')).toHaveCount(0)
    await expect.poll(() => walletNames(page)).toEqual(INITIAL)
    await page.mouse.up()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('status')).not.toContainText('unsent')
    expect(server.upserts).toEqual([])
  })

  test('a drop back on the same place changes nothing', async ({ page }) => {
    const server = await openWalletList(page)
    const from = await cardBox(page, /Second wallet/)
    const x = from.x + from.width / 2
    await page.mouse.move(x, from.y + 20)
    await page.mouse.down()
    await page.mouse.move(x, from.y + 30, { steps: 4 })
    await page.mouse.up()
    await expect(page).toHaveURL(/\/$/)
    await expect.poll(() => walletNames(page)).toEqual(INITIAL)
    await expect(page.getByRole('status')).not.toContainText('unsent')
    expect(server.upserts).toEqual([])
  })

  test('Alt with an arrow moves the focused card', async ({ page }) => {
    await openWalletList(page)
    await page.getByRole('button', { name: /Test wallet/ }).focus()
    await page.keyboard.press('Alt+ArrowDown')
    await expect.poll(() => walletNames(page)).toEqual(['Second wallet', 'Test wallet', 'Third wallet'])
    await page.keyboard.press('Alt+ArrowUp')
    await expect.poll(() => walletNames(page)).toEqual(INITIAL)
    await page.keyboard.press('Alt+ArrowUp')
    await expect.poll(() => walletNames(page)).toEqual(INITIAL)
  })

  test('there are no separate handles or arrows on a card', async ({ page }) => {
    await openWalletList(page)
    await expect(page.getByRole('button', { name: 'Reorder' })).toHaveCount(0)
  })
})

test.describe('reordering with a finger', () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true })

  const touch = async (page: Page) => {
    const cdp = await page.context().newCDPSession(page)
    const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y: y! }] })
    return send
  }

  test('holding a card lifts it, and moving the finger reorders', async ({ page }) => {
    await openWalletList(page)
    const send = await touch(page)
    const from = await cardBox(page, /Test wallet/)
    const to = await cardBox(page, /Third wallet/)
    const x = from.x + from.width / 2

    await send('touchStart', x, from.y + 20)
    await expect(page.locator('.card-item.dragging')).toHaveCount(1)
    for (let y = from.y + 30; y < to.y + to.height; y += 15) await send('touchMove', x, y)
    await expect.poll(() => walletNames(page)).toEqual(['Second wallet', 'Third wallet', 'Test wallet'])
    await send('touchEnd')

    await expect(page.locator('.card-item.dragging')).toHaveCount(0)
    await expect(page).toHaveURL(/\/$/)
    await expect.poll(() => walletNames(page)).toEqual(['Second wallet', 'Third wallet', 'Test wallet'])
  })

  test('a quick swipe does not pick up a card', async ({ page }) => {
    await openWalletList(page)
    const send = await touch(page)
    const from = await cardBox(page, /Test wallet/)
    const x = from.x + from.width / 2
    await send('touchStart', x, from.y + 20)
    for (let i = 1; i <= 8; i++) await send('touchMove', x, from.y + 20 + i * 25)
    await page.waitForTimeout(450)
    await expect(page.locator('.card-item.dragging')).toHaveCount(0)
    await send('touchEnd')
    await expect.poll(() => walletNames(page)).toEqual(INITIAL)
  })

  test('a tap opens the wallet', async ({ page }) => {
    await openWalletList(page)
    await page.getByRole('button', { name: /Second wallet/ }).tap()
    await expect(page).toHaveURL(/\/wallet\/w2$/)
  })
})

test('theme and month colors follow the settings', async ({ page }) => {
  await openWallet(page)
  const rowColor = () => page.locator('.tx', { hasText: /Note nov/ }).evaluate((el) => getComputedStyle(el).backgroundColor)
  const headerColor = () => page.getByRole('button', { name: /November 2026/ }).evaluate((el) => getComputedStyle(el).backgroundColor)
  const background = () => page.evaluate(() => getComputedStyle(document.querySelector('.pane')!).backgroundColor)

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel('Theme').selectOption('LIGHT')
  await expect.poll(rowColor).toBe('rgb(237, 237, 221)') // #EDEDDD
  await expect.poll(headerColor).toBe('rgb(207, 207, 168)') // #CFCFA8
  await expect.poll(background).toBe('rgb(251, 248, 255)')

  await page.getByLabel('Theme').selectOption('DARK')
  await expect.poll(background).toBe('rgb(17, 19, 24)')
  await page.getByLabel('Month colors').selectOption('OFF')
  await expect.poll(rowColor).toBe('rgba(0, 0, 0, 0)')

  await page.reload()
  await expect.poll(background).toBe('rgb(17, 19, 24)')
})

test('collapse except current comes from the settings', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await fakeSupabase(page, { ...tableRows, transactions: [makeTx('this', Date.now(), 100), makeTx('older', at(2020, 3, 3), 100)] })
  await signedIn(page)
  await page.addInitScript(() => localStorage.setItem('saldo.settings', JSON.stringify({ monthsDefault: 'COLLAPSE_EXCEPT_CURRENT' })))
  await page.goto('/')
  await page.getByRole('button', { name: /Test wallet/ }).click()
  await expect(page.locator('.tx', { hasText: /Note this/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /March 2020/ })).toBeVisible()
  await expect(page.locator('.tx', { hasText: /Note older/ })).toHaveCount(0)
})

test('a phone gets one column, without sideways scrolling, and Back returns to the list', async ({ page }) => {
  await openWallet(page, tableRows, { width: 360, height: 740 })
  await expect(page.getByRole('complementary', { name: 'Wallets' })).toHaveCount(0)
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(await overflow()).toBe(0)
  await page.getByRole('button', { name: 'Back to wallets' }).click()
  await expect(page.getByRole('complementary', { name: 'Wallets' })).toBeVisible()
  expect(await overflow()).toBe(0)
  await page.goBack()
  await expect(page.getByRole('button', { name: /November 2026/ })).toBeVisible()
})

test('on a phone the figures of a header stay under its title', async ({ page }) => {
  await openWallet(page, tableRows, { width: 360, height: 740 })
  for (const name of [/November 2026/, /October 2026/, /^2026/]) {
    const header = page.getByRole('button', { name })
    const title = await header.locator('.group-title').boundingBox()
    const figure = await header.locator('.group-figure').first().boundingBox()
    expect(figure!.y).toBeGreaterThanOrEqual(title!.y + title!.height - 1)
  }
})

// ---------------------------------------------------------------- W3

const formRows = {
  wallets: [wallet, second, third],
  categories: [
    { ...main, kind: 'EXPENSE' },
    { ...sub, kind: 'EXPENSE', is_quick_pick: true },
    { ...category, id: 'other', name: 'Mango', level: 'SUB', parent_id: null, kind: 'EXPENSE', updated_at: 12 },
    { ...category, id: 'salary', name: 'Salary', level: 'MAIN', kind: 'INCOME', updated_at: 12 },
  ],
  transactions: [makeTx('nov', at(2026, 11, 5), 1000), makeTx('oct', at(2026, 10, 3), 2000)],
}

const form = (page: Page, name: string) => page.getByRole('dialog', { name })
const saved = (server: Server, table = 'transactions') => server.upserts.filter((u) => u.table === table).flatMap((u) => u.body)
const sync = (page: Page) => page.getByRole('button', { name: 'Sync now' }).click()

async function openRow(page: Page, text: RegExp) {
  await page.locator('.tx', { hasText: text }).click()
  return page.getByRole('dialog', { name: 'Transaction details' })
}

test.describe('transaction form', () => {
  test('a new transaction appears in the table, changes the balance and goes out correctly', async ({ page }) => {
    const server = await openWallet(page, formRows)
    await page.getByRole('button', { name: 'New transaction' }).click()
    const dialog = form(page, 'New transaction')
    await expect(page.getByLabel('Amount')).toBeFocused()

    await page.getByLabel('Amount').fill('1.459,96')
    await page.getByLabel('Date').fill('07.11.2026')
    await page.getByLabel('Time').fill('14:22')
    await page.getByLabel('Note').fill('Lunch\nwith a second line')
    await dialog.getByRole('button', { name: 'Save' }).click()

    await expect(dialog).toHaveCount(0)
    await expect(page).toHaveURL(/\/wallet\/w1$/)
    const row = page.locator('.tx', { hasText: 'Lunch' })
    await expect(row).toContainText('07.11.2026')
    await expect(row).toContainText('14:22')
    await expect(row).toContainText('−1.459,96')
    await expect(page.locator('.pane-balance')).toContainText('−489,96 RSD') // 1.000,00 − 10,00 − 20,00 − 1.459,96

    await sync(page)
    await expect.poll(() => saved(server).length).toBe(1)
    const sent = saved(server)[0]!
    expect(sent).toMatchObject({
      wallet_id: 'w1', kind: 'EXPENSE', amount_minor: 145996, note: 'Lunch\nwith a second line', source: 'MANUAL',
      occurred_at: new Date(2026, 10, 7, 14, 22).getTime(), deleted_at: null, recurring_rule_id: null, period_key: null, user_id: UID,
    })
    expect(sent.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(sent.created_at).toBeGreaterThan(0)
    expect(sent).not.toHaveProperty('updated_at')
  })

  test('refuses bad input, with a clear message, and keeps what was typed', async ({ page }) => {
    await openWallet(page, formRows)
    await page.getByRole('button', { name: 'New transaction' }).click()
    const dialog = form(page, 'New transaction')
    const save = dialog.getByRole('button', { name: 'Save' })

    await save.click()
    await expect(dialog.getByRole('alert')).toHaveText('Enter an amount')
    await page.getByLabel('Amount').fill('2.1091')
    await save.click()
    await expect(dialog.getByRole('alert')).toHaveText('Max 2 decimals')
    await page.getByLabel('Amount').fill('0')
    await save.click()
    await expect(dialog.getByRole('alert')).toHaveText('Amount must not be zero')

    await page.getByLabel('Amount').fill('5')
    await page.getByLabel('Date').fill('31.02.2026')
    await page.getByLabel('Time').fill('25:00')
    await save.click()
    await expect(dialog.getByRole('alert').first()).toHaveText('Enter the date as dd.MM.yyyy')
    await expect(dialog.getByRole('alert').last()).toHaveText('Enter the time as HH:mm')
    await expect(page.getByLabel('Amount')).toHaveValue('5')
    await expect(dialog).toBeVisible()
  })

  test('accepts a comma and a dot, and Income makes it positive', async ({ page }) => {
    const server = await openWallet(page, formRows)
    await page.getByRole('button', { name: 'New transaction' }).click()
    await page.getByRole('radio', { name: 'Income' }).click()
    await page.getByLabel('Amount').fill('12.5')
    await page.keyboard.press('Enter')
    await expect(form(page, 'New transaction')).toHaveCount(0)
    await sync(page)
    await expect.poll(() => saved(server)[0]).toMatchObject({ kind: 'INCOME', amount_minor: 1250 })
  })

  test('an edit changes the row and keeps its id, date and time', async ({ page }) => {
    const server = await openWallet(page, formRows)
    await (await openRow(page, /Note oct/)).getByRole('button', { name: 'Edit', exact: true }).click()
    const dialog = form(page, 'Edit transaction')
    await expect(page.getByLabel('Amount')).toHaveValue('20,00')
    await expect(page.getByLabel('Date')).toHaveValue('03.10.2026')
    await expect(page.getByLabel('Time')).toHaveValue('12:30')
    await page.getByLabel('Amount').fill('33,50')
    await page.getByLabel('Note').fill('Changed note')
    await dialog.getByRole('button', { name: 'Save' }).click()

    await expect(page.locator('.tx', { hasText: 'Changed note' })).toContainText('−33,50')
    await sync(page)
    await expect.poll(() => saved(server)[0]).toMatchObject({ id: 'oct', amount_minor: 3350, note: 'Changed note', created_at: 1 })
  })

  test('a monthly fee stays a monthly fee after an edit, but its duplicate is a normal row', async ({ page }) => {
    const fee = makeTx('fee', at(2026, 10, 31), 500, 'EXPENSE', { source: 'RECURRING', recurring_rule_id: 'r1', period_key: '2026-10' })
    const server = await openWallet(page, { ...formRows, transactions: [...formRows.transactions, fee] })

    await (await openRow(page, /Note fee/)).getByRole('button', { name: 'Duplicate' }).click()
    const copy = form(page, 'Duplicate transaction')
    await expect(page.getByLabel('Amount')).toHaveValue('5,00')
    await expect(page.getByLabel('Note')).toHaveValue('Note fee')
    await expect(page.getByLabel('Date')).not.toHaveValue('31.10.2026')
    await copy.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.tx', { hasText: 'Note fee' })).toHaveCount(2)
    await sync(page)
    await expect.poll(() => saved(server).length).toBe(1)
    const sent = saved(server)[0]!
    expect(sent.id).not.toBe('fee')
    expect(sent).toMatchObject({ source: 'MANUAL', recurring_rule_id: null, period_key: null })

    await expect(page.getByRole('status')).not.toContainText('unsent')
    await (await openRow(page, /Note fee.*31\.10|31\.10.*Note fee/)).getByRole('button', { name: 'Edit', exact: true }).click()
    await page.getByLabel('Note').fill('Fee edited')
    await form(page, 'Edit transaction').getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.tx', { hasText: 'Fee edited' })).toBeVisible()
    await sync(page)
    await expect.poll(() => saved(server).at(-1)).toMatchObject({ id: 'fee', source: 'RECURRING', recurring_rule_id: 'r1', period_key: '2026-10' })
  })

  test('foreign currency needs a currency, and is shown in the details', async ({ page }) => {
    const server = await openWallet(page, formRows)
    await page.getByRole('button', { name: 'New transaction' }).click()
    const dialog = form(page, 'New transaction')
    await page.getByLabel('Amount').fill('71234')
    await page.getByLabel('Note').fill('Foreign one')
    await dialog.getByRole('button', { name: /Foreign currency/ }).click()
    await page.getByLabel('Original amount').fill('607')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Choose the currency')

    await dialog.getByRole('button', { name: 'Choose' }).click()
    await page.getByLabel('Search currencies').fill('eur')
    await page.getByRole('button', { name: /^EUR Euro/ }).click()
    await expect(page.getByRole('dialog', { name: 'Choose currency' })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Save' }).click()

    await expect(await openRow(page, /Foreign one/)).toContainText('Original: 607,00 EUR (Euro)')
    await page.keyboard.press('Escape')
    await sync(page)
    await expect.poll(() => saved(server)[0]).toMatchObject({ original_amount_minor: 60700, original_currency: 'EUR' })
  })

  test('leaving with changes asks first, through Close, Escape and Back', async ({ page }) => {
    await openWallet(page, formRows)
    await page.getByRole('button', { name: 'New transaction' }).click()
    const dialog = form(page, 'New transaction')

    // Nothing typed yet: no question.
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    await page.getByRole('button', { name: 'New transaction' }).click()
    await page.getByLabel('Amount').fill('5')
    const confirm = page.getByRole('dialog', { name: 'Discard changes?' })

    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByLabel('Amount')).toHaveValue('5')

    await page.getByLabel('Amount').press('Escape')
    await expect(confirm).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(confirm).toHaveCount(0)
    await expect(page.getByLabel('Amount')).toHaveValue('5')

    await page.goBack()
    await expect(confirm).toBeVisible()
    await expect(page).toHaveURL(/\/new$/)
    await expect(page.getByLabel('Amount')).toHaveValue('5')

    await confirm.getByRole('button', { name: 'Discard' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page).toHaveURL(/\/wallet\/w1$/)
    await expect(page.getByRole('status')).not.toContainText('unsent')
  })

  test('a sync while the form is open does not touch what is being typed', async ({ page }) => {
    await openWallet(page, formRows)
    await (await openRow(page, /Note oct/)).getByRole('button', { name: 'Edit', exact: true }).click()
    await page.getByLabel('Note').fill('Being typed')
    // A round started in the background, the way the connection coming back starts one.
    const nextRound = page.waitForRequest((request) => request.url().includes('saldo_now_ms'))
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await nextRound
    await expect(page.getByRole('status')).toContainText('Synced')
    await expect(page.getByLabel('Note')).toHaveValue('Being typed')
  })
})

test.describe('categories in the form', () => {
  test('search picks a sub-category, and the row shows it with its parent', async ({ page }) => {
    const server = await openWallet(page, formRows)
    await page.getByRole('button', { name: 'New transaction' }).click()
    const dialog = form(page, 'New transaction')
    await page.getByLabel('Amount').fill('5')
    await page.getByLabel('Note').fill('With category')

    await page.getByRole('combobox', { name: 'Category' }).fill('sho')
    await dialog.getByRole('button', { name: 'Shop · Groceries' }).click()
    await expect(dialog).toContainText('Selected: Shop › Groceries')
    await expect(page.getByRole('combobox', { name: 'Category' })).toHaveValue('')

    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.tx', { hasText: 'With category' })).toContainText('Shop · Groceries')
    await sync(page)
    await expect.poll(() => saved(server)[0]).toMatchObject({ category_id: 'sub' })
  })

  test('a category is optional, and Enter in the search picks instead of saving', async ({ page }) => {
    await openWallet(page, formRows)
    await page.getByRole('button', { name: 'New transaction' }).click()
    const dialog = form(page, 'New transaction')
    await expect(dialog).toContainText('No category')
    await page.getByLabel('Amount').fill('5')
    await page.getByRole('combobox', { name: 'Category' }).fill('man')
    await page.keyboard.press('Enter')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Selected: Mango (Unlinked)')
    await dialog.getByRole('button', { name: 'Clear' }).click()
    await expect(dialog).toContainText('No category')
  })

  test('Create makes an Unlinked category and sends it', async ({ page }) => {
    const server = await openWallet(page, formRows)
    await page.getByRole('button', { name: 'New transaction' }).click()
    const dialog = form(page, 'New transaction')
    await page.getByLabel('Amount').fill('5')
    await page.getByRole('combobox', { name: 'Category' }).fill('Shell')
    await dialog.getByRole('button', { name: '+ Create "Shell"' }).click()
    await expect(dialog).toContainText('Selected: Shell (Unlinked)')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await sync(page)
    await expect.poll(() => saved(server, 'categories')[0]).toMatchObject({ name: 'Shell', level: 'SUB', parent_id: null, kind: 'EXPENSE' })
    await expect.poll(() => saved(server)[0]?.category_id).toBe(saved(server, 'categories')[0]?.id)
  })

  test('an existing name offers no Create, and kinds follow the type', async ({ page }) => {
    await openWallet(page, formRows)
    await page.getByRole('button', { name: 'New transaction' }).click()
    const dialog = form(page, 'New transaction')
    await page.getByRole('combobox', { name: 'Category' }).fill('mango')
    await expect(dialog.getByRole('button', { name: /Create/ })).toHaveCount(0)

    await page.getByRole('combobox', { name: 'Category' }).fill('sal')
    await expect(dialog.getByRole('button', { name: 'Salary' })).toHaveCount(0)
    await page.getByRole('radio', { name: 'Income' }).click()
    await expect(dialog.getByRole('button', { name: 'Salary' })).toBeVisible()
  })

  test('a quick chip selects and deselects, and can stay out of the search', async ({ page }) => {
    await openWallet(page, formRows)
    await page.getByRole('button', { name: 'New transaction' }).click()
    const dialog = form(page, 'New transaction')
    const chips = dialog.getByRole('group', { name: 'Quick picks' })
    await chips.getByRole('button', { name: 'Shop' }).click()
    await expect(dialog).toContainText('Selected: Shop › Groceries')
    await chips.getByRole('button', { name: 'Shop' }).click()
    await expect(dialog).toContainText('No category')
    await page.getByRole('combobox', { name: 'Category' }).fill('shop')
    await expect(dialog.getByRole('button', { name: 'Shop · Groceries' })).toBeVisible()
    await page.keyboard.press('Escape') // clears the search, the form stays
    await expect(page.getByRole('combobox', { name: 'Category' })).toHaveValue('')
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('dialog', { name: 'Discard changes?' }).getByRole('button', { name: 'Discard' }).click()

    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByLabel('Show quick picks in autocomplete').uncheck()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'New transaction' }).click()
    await page.getByRole('combobox', { name: 'Category' }).fill('shop')
    await expect(form(page, 'New transaction').getByRole('button', { name: 'Shop · Groceries' })).toHaveCount(0)
  })

  test('an account without any categories cannot create one, so the phone can still seed', async ({ page }) => {
    await openWallet(page, { wallets: [wallet], transactions: [makeTx('nov', at(2026, 11, 5), 1000)] })
    await page.getByRole('button', { name: 'New transaction' }).click()
    await page.getByRole('combobox', { name: 'Category' }).fill('Anything')
    await expect(form(page, 'New transaction').getByRole('button', { name: /Create/ })).toHaveCount(0)
  })
})

test.describe('deleting and Undo', () => {
  test('delete is immediate, and Undo stays after a sync', async ({ page }) => {
    const server = await openWallet(page, formRows)
    const row = page.locator('.tx', { hasText: 'Note oct' })
    await (await openRow(page, /Note oct/)).getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(row).toHaveCount(0)
    await expect(page.locator('.pane-balance')).toContainText('990,00 RSD')

    // The deletion reaches the server before the user changes their mind.
    await sync(page)
    await expect.poll(() => saved(server).at(-1)?.deleted_at).toBeGreaterThan(0)
    await expect(page.getByRole('status')).not.toContainText('unsent')

    await page.getByRole('alert').getByRole('button', { name: 'Undo' }).click()
    await expect(row).toBeVisible()
    await expect(page.locator('.pane-balance')).toContainText('970,00 RSD')
    await expect(page.getByRole('alert')).toHaveCount(0)

    await sync(page)
    await expect.poll(() => saved(server).at(-1)).toMatchObject({ id: 'oct', deleted_at: null })
    await expect(page.getByRole('status')).not.toContainText('unsent')
    await sync(page)
    await expect(row).toBeVisible()
    await page.reload()
    await page.getByRole('button', { name: /Note oct|Test wallet/ }).first().waitFor()
    await expect(row).toBeVisible()
  })

  test('deleting the checker row removes the checker, and Undo returns it', async ({ page }) => {
    await openWallet(page, formRows)
    await (await openRow(page, /Note oct/)).getByRole('button', { name: 'Set checker' }).click()
    await expect(page.locator('.tx.checker')).toContainText('Note oct')
    await (await openRow(page, /Note oct/)).getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Go to checker' })).toBeDisabled()
    await page.getByRole('alert').getByRole('button', { name: 'Undo' }).click()
    await expect(page.locator('.tx.checker')).toContainText('Note oct')
    await expect(page.getByRole('button', { name: 'Go to checker' })).toBeEnabled()
  })

  test('Undo goes away on its own', async ({ page }) => {
    await openWallet(page, formRows)
    await (await openRow(page, /Note oct/)).getByRole('button', { name: 'Delete', exact: true }).click()
    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(alert).toHaveCount(0, { timeout: 10_000 })
    await expect(page.locator('.tx', { hasText: 'Note oct' })).toHaveCount(0)
  })
})

/** A real 300×200 picture, half red and half blue. */
const testPng = (page: Page) => page.evaluate(() => new Promise<number[]>((resolve) => {
  const canvas = document.createElement('canvas')
  canvas.width = 300
  canvas.height = 200
  const context = canvas.getContext('2d')!
  context.fillStyle = 'red'
  context.fillRect(0, 0, 150, 200)
  context.fillStyle = 'blue'
  context.fillRect(150, 0, 150, 200)
  canvas.toBlob(async (blob) => resolve([...new Uint8Array(await blob!.arrayBuffer())]), 'image/png')
}))

test.describe('wallet form', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  async function newWallet(page: Page, rows: Record<string, unknown[]> = formRows) {
    const server = await fakeSupabase(page, rows)
    await signedIn(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'New wallet' }).click()
    return server
  }

  test('creates a wallet and opens it', async ({ page }) => {
    const server = await newWallet(page)
    const dialog = form(page, 'New wallet')
    await expect(page.getByLabel('Name')).toBeFocused()

    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Name is required')

    await page.getByLabel('Name').fill('  Fresh wallet ')
    await page.getByLabel('Type').selectOption('CASH')
    await dialog.getByRole('button', { name: 'Change' }).click()
    await page.getByLabel('Search currencies').fill('franc')
    await page.getByRole('button', { name: /^CHF/ }).click()
    await page.getByLabel('Opening balance').fill('-5,50')
    await dialog.getByRole('radio', { name: 'Color #e53935' }).click()
    await dialog.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByRole('heading', { name: 'Fresh wallet' })).toBeVisible()
    await expect(page.locator('.pane-balance')).toContainText('−5,50 CHF')
    await expect(page.locator('.wallet-name').last()).toHaveText('Fresh wallet')
    await sync(page)
    await expect.poll(() => saved(server, 'wallets')[0]).toMatchObject({
      name: 'Fresh wallet', wallet_type: 'CASH', currency_code: 'CHF', opening_balance_minor: -550, color: -1754827, sort_order: 3, is_archived: false, deleted_at: null,
    })
  })

  test('the currency is locked once there are transactions', async ({ page }) => {
    await openWallet(page, formRows)
    await walletAction(page, 'Edit wallet')
    const dialog = form(page, 'Edit wallet')
    await expect(dialog).toContainText('Locked: the wallet already has transactions')
    await expect(dialog.getByRole('button', { name: 'Change' })).toHaveCount(0)
    await expect(page.getByLabel('Name')).toHaveValue('Test wallet')
    await expect(page.getByLabel('Opening balance')).toHaveValue('1000,00')
  })

  test('an edit changes the balance and keeps the order', async ({ page }) => {
    const server = await openWallet(page, formRows)
    await walletAction(page, 'Edit wallet')
    await page.getByLabel('Name').fill('Renamed')
    await page.getByLabel('Opening balance').fill('2000')
    await form(page, 'Edit wallet').getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('heading', { name: 'Renamed' })).toBeVisible()
    await expect(page.locator('.pane-balance')).toContainText('1.970,00 RSD')
    await sync(page)
    await expect.poll(() => saved(server, 'wallets')[0]).toMatchObject({ id: 'w1', name: 'Renamed', sort_order: 0, opening_balance_minor: 200000 })
  })

  test('an image becomes a 256×256 WebP named by its hash, and is sent before the wallet', async ({ page }) => {
    const server = await newWallet(page)
    const dialog = form(page, 'New wallet')
    await page.getByLabel('Name').fill('With image')
    const png = await testPng(page)
    await page.getByLabel('Wallet image file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(png) })
    await expect(dialog.locator('img.avatar')).toBeVisible()

    // Leaving the form must leave nothing: the image is not stored until Save.
    const stored = () => page.evaluate(() => new Promise<{ hash: string; size: [number, number]; type: string }[]>((resolve) => {
      const open = indexedDB.open('saldo')
      open.onsuccess = () => {
        const request = open.result.transaction('images').objectStore('images').getAll()
        request.onsuccess = async () => resolve(await Promise.all(request.result.map(async (row: { hash: string; blob: Blob }) => {
          const bitmap = await createImageBitmap(row.blob)
          return { hash: row.hash, size: [bitmap.width, bitmap.height] as [number, number], type: row.blob.type }
        })))
      }
    }))
    expect(await stored()).toEqual([])

    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('heading', { name: 'With image' })).toBeVisible()
    await expect(page.locator('.pane-header img.avatar')).toBeVisible()
    const [image] = await stored()
    expect(image!.size).toEqual([256, 256])
    expect(image!.type).toBe('image/webp')
    expect(image!.hash).toMatch(/^[0-9a-f]{64}$/)

    await sync(page)
    await expect.poll(() => server.uploads.length).toBe(1)
    expect(server.uploads[0]!.path).toBe(`wallet-images/${UID}/${image!.hash}.webp`)
    await expect.poll(() => saved(server, 'wallets')[0]).toMatchObject({ image_hash: image!.hash })
    expect(saved(server, 'images')[0]).toMatchObject({ hash: image!.hash, remote_path: `${UID}/${image!.hash}.webp`, deleted_at: null })
    const order = server.upserts.map((u) => u.table)
    expect(order.indexOf('images')).toBeLessThan(order.indexOf('wallets'))
  })

  test('abandoning a picked image stores nothing, and a bad file gives a message', async ({ page }) => {
    await newWallet(page)
    const dialog = form(page, 'New wallet')
    await page.getByLabel('Wallet image file').setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not a picture') })
    await expect(dialog.getByRole('alert')).toHaveText('This image could not be read.')

    const png = await testPng(page)
    await page.getByLabel('Wallet image file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(png) })
    await expect(dialog.locator('img.avatar')).toBeVisible()
    await dialog.getByRole('button', { name: 'Remove image' }).click()
    await expect(dialog.locator('img.avatar')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.getByRole('dialog', { name: 'Discard changes?' }).getByRole('button', { name: 'Discard' }).click()
    await expect(page.getByRole('status')).not.toContainText('unsent')
  })

  test('deleting a wallet asks first, then removes it with its transactions', async ({ page }) => {
    const server = await openWallet(page, formRows)
    await walletAction(page, 'Delete wallet')
    const confirm = page.getByRole('dialog', { name: 'Delete wallet?' })
    await expect(confirm).toContainText('Delete "Test wallet" and 2 transactions? This cannot be undone.')
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('heading', { name: 'Test wallet' })).toBeVisible()

    await walletAction(page, 'Delete wallet')
    await confirm.getByRole('button', { name: 'Delete' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('button', { name: /Test wallet/ })).toHaveCount(0)

    await sync(page)
    await expect.poll(() => saved(server, 'wallets')[0]?.deleted_at).toBeGreaterThan(0)
    await expect.poll(() => saved(server).map((r) => [r.id, typeof r.deleted_at]).sort()).toEqual([['nov', 'number'], ['oct', 'number']])
  })
})

test.describe('forms on a phone', () => {
  test.use({ viewport: { width: 360, height: 740 } })

  test('fill the screen without sideways scrolling', async ({ page }) => {
    await openWallet(page, formRows, { width: 360, height: 740 })
    await page.getByRole('button', { name: 'New transaction' }).click()
    const overflow = () => page.evaluate(() => {
      const panel = document.querySelector('.modal.wide')!
      return Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, panel.scrollWidth - panel.clientWidth)
    })
    await expect(page.getByLabel('Amount')).toBeVisible()
    expect(await overflow()).toBe(0)
    const box = await page.locator('.modal.wide').boundingBox()
    expect(box!.width).toBe(360)
    expect(box!.height).toBe(740)
    await page.keyboard.press('Escape')
    await walletAction(page, 'Edit wallet')
    await expect(page.getByLabel('Name')).toBeVisible()
    expect(await overflow()).toBe(0)
  })
})

// ---------------------------------------------------------------- W4

const thisYear = new Date().getFullYear()
const thisMonthAt = (day: number) => new Date(thisYear, new Date().getMonth(), day, 12, 0).getTime()
const monthsAgo = (n: number, day = 10) => new Date(thisYear, new Date().getMonth() - n, day, 12, 0).getTime()

const adjust = { ...category, id: 'adj', name: 'Balance adjustment', exclude_from_stats: true, updated_at: 12 }
const fuel = { ...category, id: 'fuel', name: 'Fuel', color: -1754827, kind: 'EXPENSE', updated_at: 12 }
const statsRows = {
  wallets: [wallet, second, third],
  categories: [{ ...main, kind: 'EXPENSE' }, { ...sub, kind: 'EXPENSE' }, fuel, adjust],
  transactions: [
    makeTx('shop', thisMonthAt(2), 300000, 'EXPENSE', { category_id: 'sub', note: 'Šumadija sir' }),
    makeTx('gas', monthsAgo(1), 500000, 'EXPENSE', { category_id: 'fuel' }),
    makeTx('none', monthsAgo(1), 100000, 'EXPENSE', { note: 'Plain 340' }),
    makeTx('pay', monthsAgo(1), 2000000, 'INCOME', { note: 'plata' }),
    makeTx('adj-row', monthsAgo(2), 9900000, 'INCOME', { category_id: 'adj', note: 'početno stanje' }),
    makeTx('eur', monthsAgo(1), 7700, 'EXPENSE', { wallet_id: 'w2', note: 'Euro row' }),
  ],
}

const pageWide = { width: 1400, height: 900 }
async function openApp(page: Page, rows: Record<string, unknown[]> = statsRows, path = '/', viewport = pageWide) {
  await page.setViewportSize(viewport)
  const server = await fakeSupabase(page, rows)
  await signedIn(page)
  await page.goto(path)
  await expect(page.getByRole('status')).toContainText('Synced')
  return server
}
const summary = (page: Page) => page.getByLabel('Summary')

test.describe('search', () => {
  test('in a wallet: text, diacritics and amount, with totals and no balances', async ({ page }) => {
    const problems = cspProblems(page)
    await openApp(page, statsRows, '/wallet/w1')
    await page.getByRole('button', { name: 'Search in wallet' }).click()
    await expect(summary(page)).toContainText('5 items')

    await page.getByLabel('Search', { exact: true }).fill('sumadija')
    await expect(page.locator('.tx')).toHaveCount(1)
    await expect(page.locator('.tx')).toContainText('Šumadija sir')
    await expect(summary(page)).toContainText('1 item')
    await expect(summary(page)).toContainText('Out −3.000,00')
    await expect(page.getByText('End balance')).toHaveCount(0)

    await page.getByLabel('Search', { exact: true }).fill('5.000')
    await expect(page.locator('.tx')).toContainText('Note gas')

    await page.getByLabel('Search', { exact: true }).fill('nothing like this')
    await expect(page.getByText('Nothing found.')).toBeVisible()
    await expect(summary(page)).toContainText('0 items')

    await page.getByRole('button', { name: 'Close search' }).click()
    await expect(page.getByText('End balance').first()).toBeVisible()
    await expect(page.locator('.tx')).toHaveCount(5)
    expect(problems).toEqual([])
  })

  test('filters by type, amount, custom period and category, and Clear resets them', async ({ page }) => {
    await openApp(page, statsRows, '/wallet/w1')
    await page.getByRole('button', { name: 'Search in wallet' }).click()

    await page.getByLabel('Type').selectOption('IN')
    await expect(summary(page)).toContainText('2 items')
    await page.getByRole('button', { name: 'Clear', exact: true }).click()
    await expect(summary(page)).toContainText('5 items')

    await page.getByLabel('Minimum amount').fill('1.000')
    await page.getByLabel('Maximum amount').fill('3000')
    await expect(page.locator('.tx')).toHaveCount(2)
    await page.getByRole('button', { name: 'Clear', exact: true }).click()
    await expect(page.getByLabel('Minimum amount')).toHaveValue('')

    await page.getByLabel('Period').selectOption('THIS_MONTH')
    await expect(page.locator('.tx')).toHaveCount(1)
    await page.getByLabel('Period').selectOption('CUSTOM')
    const day = new Date(thisMonthAt(2))
    const text = `${String(day.getDate()).padStart(2, '0')}.${String(day.getMonth() + 1).padStart(2, '0')}.${day.getFullYear()}`
    await page.getByLabel('From date').fill(text)
    await page.getByLabel('To date').fill(text)
    await expect(page.locator('.tx')).toHaveCount(1)
    await page.getByRole('button', { name: 'Clear', exact: true }).click()

    await page.getByRole('button', { name: 'Category' }).click()
    const dialog = page.getByRole('dialog', { name: 'Categories' })
    await dialog.getByLabel('Groceries').check()
    await expect(dialog.getByLabel('Shop')).toBeChecked() // a main includes its subs
    await expect(dialog.getByLabel('Shop')).toBeDisabled()
    await dialog.getByRole('button', { name: 'Apply' }).click()
    await expect(page.locator('.tx')).toContainText('Šumadija sir')
    await expect(page.locator('.tx')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Category (1)' })).toBeVisible()

    await page.getByRole('button', { name: 'Category (1)' }).click()
    await dialog.getByLabel('Groceries').uncheck()
    await dialog.getByLabel('Uncategorized').check()
    await dialog.getByRole('button', { name: 'Apply' }).click()
    await expect(summary(page)).toContainText('2 items')
  })

  test('opens a match in a month that was collapsed', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('saldo.settings', JSON.stringify({ monthsDefault: 'COLLAPSE_EXCEPT_CURRENT' })))
    await openApp(page, statsRows, '/wallet/w1')
    await expect(page.locator('.tx', { hasText: 'Plain 340' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Search in wallet' }).click()
    await page.getByLabel('Search', { exact: true }).fill('340')
    await expect(page.locator('.tx', { hasText: 'Plain 340' })).toBeVisible()
  })

  test('globally: one currency at a time, with the wallet shown', async ({ page }) => {
    await openApp(page, statsRows, '/')
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Search' }).click()
    await expect(summary(page)).toContainText('5 items')
    await expect(page.locator('.tx', { hasText: 'Note gas' })).toContainText('Test wallet')

    await page.getByRole('group', { name: 'Currency' }).getByRole('button', { name: 'EUR' }).click()
    await expect(summary(page)).toContainText('1 item')
    await expect(summary(page)).toContainText('Net −77,00 EUR')
    await expect(page.locator('.tx')).toContainText('Euro row')
  })

  test('a row opened from global search can be deleted, with Undo', async ({ page }) => {
    await openApp(page, statsRows, '/search')
    await page.locator('.tx', { hasText: 'Note gas' }).click()
    await page.getByRole('dialog', { name: 'Transaction details' }).getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(summary(page)).toContainText('4 items')
    await page.getByRole('alert').getByRole('button', { name: 'Undo' }).click()
    await expect(summary(page)).toContainText('5 items')
  })
})

test.describe('statistics', () => {
  test('totals, average, category order, and adjustments left out', async ({ page }) => {
    const problems = cspProblems(page)
    await openApp(page, statsRows, '/statistics')

    const spending = page.getByRole('region', { name: 'Monthly spending' })
    await expect(spending).toContainText('Average 750,00 RSD') // 9.000,00 over 12 months
    const byCategory = page.getByRole('region', { name: 'By category' })
    await expect(byCategory.locator('.category-total').nth(0)).toContainText('Fuel')
    await expect(byCategory.locator('.category-total').nth(0)).toContainText('5.000,00')
    await expect(byCategory.locator('.category-total').nth(0)).toContainText('56 %')
    await expect(byCategory.locator('.category-total').nth(1)).toContainText('Groceries')
    await expect(byCategory.locator('.category-total').nth(2)).toContainText('Uncategorized')
    await expect(byCategory).not.toContainText('Balance adjustment')
    await expect(page.getByRole('region', { name: 'Income vs expense' })).toContainText('In 20.000,00 · Out 9.000,00 · Net 11.000,00 RSD')
    await expect(page.getByRole('region', { name: 'Top expenses' }).locator('li').first()).toContainText('5.000,00')
    expect(problems).toEqual([])
  })

  test('a month narrows the breakdown, and a sub-category opens its transactions', async ({ page }) => {
    await openApp(page, statsRows, '/statistics')
    const spending = page.getByRole('region', { name: 'Monthly spending' })
    const byCategory = page.getByRole('region', { name: 'By category' })
    const now = new Date()
    const name = `${now.toLocaleString('en', { month: 'long' })} ${now.getFullYear()}`

    await spending.getByRole('button', { name: new RegExp(`^${name}`) }).click()
    await expect(byCategory).toContainText(`By category · ${name}`)
    await expect(byCategory.locator('.category-total')).toHaveCount(1)

    await byCategory.getByRole('button', { name: /Groceries/ }).first().click()
    await byCategory.getByRole('button', { name: 'Show transactions: Shop' }).click()
    await expect(page).toHaveURL(/\/search\?/)
    await expect(summary(page)).toContainText('1 item')
    await expect(page.locator('.tx')).toContainText('Šumadija sir')
    await expect(page.getByLabel('Period')).toHaveValue('CUSTOM')
  })

  test('Uncategorized opens the rows without a category', async ({ page }) => {
    await openApp(page, statsRows, '/statistics')
    await page.getByRole('button', { name: 'Show transactions: Uncategorized' }).click()
    await expect(page.locator('.tx', { hasText: 'Plain 340' })).toBeVisible()
    await expect(page.locator('.tx', { hasText: 'Šumadija sir' })).toHaveCount(0)
  })

  test('currencies never mix, and one wallet can be chosen', async ({ page }) => {
    await openApp(page, statsRows, '/statistics')
    await page.getByLabel('Currency').selectOption('EUR')
    await expect(page.getByRole('region', { name: 'By category' })).toContainText('Spent 77,00 EUR')

    await page.getByLabel('Wallet').selectOption('w3')
    await expect(page.getByLabel('Currency')).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'By category' })).toContainText('No expenses in this period.')
  })

  test('a wallet opens its own statistics, and periods change the range', async ({ page }) => {
    await openApp(page, statsRows, '/wallet/w1')
    await walletAction(page, 'Wallet statistics')
    await expect(page.getByLabel('Wallet')).toHaveValue('w1')
    await expect(page.locator('.column')).toHaveCount(24) // both charts, 12 months each
    await page.getByRole('button', { name: 'Last year' }).click()
    await expect(page.locator('button.column')).toHaveCount(12)
    await expect(page.getByRole('region', { name: 'By category' })).toContainText('By category · Last year')
  })

  test('has a table view, and bars have the right heights', async ({ page }) => {
    await openApp(page, statsRows, '/statistics')
    const spending = page.getByRole('region', { name: 'Monthly spending' })
    await spending.getByText('Show as table').click()
    await expect(spending.locator('tbody tr').first()).toContainText('3.000,00')

    const bars = spending.locator('.chart-bar')
    const heights = await bars.evaluateAll((list) => list.map((bar) => bar.getBoundingClientRect().height))
    const tallest = Math.max(...heights)
    expect(tallest).toBeGreaterThan(50)
    expect(heights.filter((h) => h === tallest)).toHaveLength(1)
    expect(heights.filter((h) => h === 0)).toHaveLength(10)

    // The axis labels sit level with their grid lines.
    const lines = await spending.locator('.grid-line').evaluateAll((list) => list.map((line) => line.getBoundingClientRect().top))
    const labels = await spending.locator('.plot-axis span').evaluateAll((list) => list.map((label) => {
      const box = label.getBoundingClientRect()
      return box.top + box.height / 2
    }))
    labels.forEach((middle, i) => expect(Math.abs(middle - lines[i]!)).toBeLessThan(2))
  })

  test('the tooltip shows on hover', async ({ page }) => {
    await openApp(page, statsRows, '/statistics')
    const column = page.getByRole('region', { name: 'Income vs expense' }).locator('.column').nth(10)
    await expect(column.locator('.tip')).toBeHidden()
    await column.hover()
    await expect(column.locator('.tip')).toBeVisible()
    await expect(column.locator('.tip')).toContainText('Net 14.000,00 RSD') // last month: in 20.000,00, out 6.000,00
  })
})

test.describe('categories', () => {
  const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Categories' })
  const row = (page: Page, name: string) => page.locator('.category-row', { hasText: name })

  test('tabs show the tree, the flat list and the unlinked', async ({ page }) => {
    const rows = { ...statsRows, categories: [...statsRows.categories, { ...sub, id: 'loose', name: 'Loose', parent_id: null, updated_at: 12 }] }
    await openApp(page, rows)
    await nav(page).click()
    await expect(row(page, 'Groceries')).toContainText('1 transaction')
    await expect(page.locator('.category-row.indented', { hasText: 'Shop' })).toBeVisible()

    await page.getByRole('tab', { name: 'Sub', exact: true }).click()
    await expect(row(page, 'Shop')).toContainText('Groceries')
    await page.getByRole('tab', { name: 'Unlinked (1)' }).click()
    await expect(page.locator('.category-row')).toHaveCount(1)
    await expect(row(page, 'Loose')).toBeVisible()
  })

  test('an edit changes everything it shows and goes out', async ({ page }) => {
    const server = await openApp(page, statsRows, '/categories')
    await row(page, 'Fuel').getByRole('button').click()
    const dialog = page.getByRole('dialog', { name: 'Edit category' })
    await dialog.getByLabel('Name').fill('Gorivo')
    await dialog.getByLabel('Level').selectOption('SUB')
    await dialog.getByLabel('Parent (main category)').selectOption('main')
    await dialog.getByLabel('Used for').selectOption('BOTH')
    await dialog.getByLabel('Quick pick').check()
    await dialog.getByLabel('Exclude from statistics').check()
    await dialog.getByRole('radio', { name: 'Color #1e88e5' }).click()
    await dialog.getByLabel('Match keywords').fill('OMV, NIS PETROL')
    await dialog.getByRole('button', { name: 'Save' }).click()

    await sync(page)
    await expect.poll(() => saved(server, 'categories')[0]).toMatchObject({
      id: 'fuel', name: 'Gorivo', level: 'SUB', parent_id: 'main', kind: 'BOTH', is_quick_pick: true, exclude_from_stats: true,
      color: -14776091, match_keywords: 'OMV|NIS PETROL',
    })
  })

  test('refuses a duplicate name, and a main with subs stays main', async ({ page }) => {
    await openApp(page, statsRows, '/categories')
    await row(page, 'Groceries').getByRole('button').click()
    const dialog = page.getByRole('dialog', { name: 'Edit category' })
    await expect(dialog.getByLabel('Level')).toBeDisabled()
    await dialog.getByLabel('Name').fill('FUEL')
    await expect(dialog.getByRole('alert')).toHaveText('Name already exists')
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  test('the quick checkbox works from the list', async ({ page }) => {
    const server = await openApp(page, statsRows, '/categories')
    await page.getByLabel('Quick pick: Fuel').check()
    await sync(page)
    await expect.poll(() => saved(server, 'categories')[0]).toMatchObject({ id: 'fuel', is_quick_pick: true })
  })

  test('creates a category', async ({ page }) => {
    const server = await openApp(page, statsRows, '/categories')
    await page.getByRole('button', { name: 'New category' }).click()
    const dialog = page.getByRole('dialog', { name: 'New category' })
    await expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled()
    await dialog.getByLabel('Name').fill('Pets')
    await dialog.getByLabel('Level').selectOption('MAIN')
    await dialog.getByRole('button', { name: 'Create' }).click()
    await expect(row(page, 'Pets')).toBeVisible()
    await sync(page)
    await expect.poll(() => saved(server, 'categories')[0]).toMatchObject({ name: 'Pets', level: 'MAIN', parent_id: null })
  })

  test('deleting a sub moves its transactions to the parent', async ({ page }) => {
    const server = await openApp(page, statsRows, '/categories')
    await row(page, 'Shop').getByRole('button').click()
    await page.getByRole('dialog', { name: 'Edit category' }).getByRole('button', { name: 'Delete' }).click()
    const confirm = page.getByRole('dialog', { name: 'Delete "Shop"?' })
    await expect(confirm).toContainText('Its transactions move to Groceries.')
    await confirm.getByRole('button', { name: 'Delete' }).click()
    await expect(row(page, 'Shop')).toHaveCount(0)
    await sync(page)
    await expect.poll(() => saved(server).find((r) => r.id === 'shop')).toMatchObject({ category_id: 'main' })
    await expect.poll(() => typeof saved(server, 'categories').find((r) => r.id === 'sub')?.deleted_at).toBe('number')
  })

  test('merging moves the transactions and deletes the duplicate', async ({ page }) => {
    const server = await openApp(page, statsRows, '/categories')
    await row(page, 'Fuel').getByRole('button').click()
    await page.getByRole('dialog', { name: 'Edit category' }).getByRole('button', { name: 'Merge into…' }).click()
    await page.getByRole('dialog', { name: 'Merge category' }).getByRole('button', { name: 'Groceries' }).click()
    await expect(row(page, 'Fuel')).toHaveCount(0)
    await expect(row(page, 'Groceries')).toContainText('2 transactions')
    await sync(page)
    await expect.poll(() => saved(server).find((r) => r.id === 'gas')).toMatchObject({ category_id: 'main' })
  })

  test('an account without categories is told to use the phone, and cannot create one', async ({ page }) => {
    await openApp(page, { wallets: [wallet] }, '/categories')
    await expect(page.getByText('Open Saldo on your phone once')).toBeVisible()
    await expect(page.getByRole('button', { name: 'New category' })).toHaveCount(0)
  })
})

test.describe('monthly fees', () => {
  const rule = {
    ...common, id: 'r1', wallet_id: 'w1', kind: 'EXPENSE', amount_minor: 34000, category_id: 'main', note_template: 'održavanje za {month} {year}',
    schedule: 'MONTHLY_LAST_DAY', time_of_day: '23:59', month_name_locale: 'sr-Latn', start_period: '2026-01', last_generated_period: '2026-10', is_active: true, updated_at: 13,
  }
  const feeRows = { ...statsRows, recurring_rules: [rule] }

  test('a list with the rendered note and what was booked', async ({ page }) => {
    await openApp(page, feeRows)
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Monthly fees' }).click()
    const card = page.locator('.fee-card')
    await expect(card).toContainText('−340,00 RSD')
    await expect(card).toContainText('Test wallet')
    await expect(card).toContainText('From January 2026 · last booked October 2026')
    await expect(page.getByText('Your phone books the fees')).toBeVisible()
  })

  test('an edit goes out without last_generated_period, and books nothing', async ({ page }) => {
    const server = await openApp(page, feeRows, '/fees')
    await page.locator('.fee-open').click()
    const dialog = page.getByRole('dialog', { name: 'Edit monthly fee' })
    await dialog.getByLabel('Amount taken every month').fill('400')
    await dialog.getByLabel('Note text').fill('fee {Month} / {mm}')
    await expect(dialog.getByLabel('Preview')).toContainText('fee ')
    await dialog.getByRole('button', { name: 'Next month' }).click()
    await expect(dialog).toContainText('February 2026')
    await dialog.getByRole('button', { name: 'Save' }).click()

    await sync(page)
    await expect.poll(() => saved(server, 'recurring_rules')[0]).toMatchObject({ id: 'r1', amount_minor: 40000, note_template: 'fee {Month} / {mm}', start_period: '2026-02' })
    expect(saved(server, 'recurring_rules')[0]).not.toHaveProperty('last_generated_period')
    expect(saved(server)).toEqual([])
  })

  test('a new fee has a preview and needs an amount', async ({ page }) => {
    const server = await openApp(page, feeRows, '/fees')
    await page.getByRole('button', { name: 'New monthly fee' }).click()
    const dialog = page.getByRole('dialog', { name: 'New monthly fee' })
    await expect(dialog.getByLabel('Preview')).toContainText('održavanje računa za mesec')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Enter an amount (max 2 decimals)')
    await dialog.getByLabel('Wallet').selectOption('w3')
    await dialog.getByLabel('Amount taken every month').fill('250')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.fee-card')).toHaveCount(2)
    await expect(page.locator('.fee-card').last()).toContainText('not booked yet')
    await sync(page)
    await expect.poll(() => saved(server, 'recurring_rules')[0]).toMatchObject({ wallet_id: 'w3', amount_minor: 25000, schedule: 'MONTHLY_LAST_DAY', is_active: true })
    expect(saved(server)).toEqual([])
  })

  test('switching off and deleting', async ({ page }) => {
    const server = await openApp(page, feeRows, '/fees')
    await page.locator('.fee-card').getByRole('checkbox').uncheck()
    await sync(page)
    await expect.poll(() => saved(server, 'recurring_rules')[0]).toMatchObject({ id: 'r1', is_active: false })

    await page.locator('.fee-open').click()
    await page.getByRole('button', { name: 'Delete rule' }).click()
    const confirm = page.getByRole('dialog', { name: 'Delete this monthly fee?' })
    await expect(confirm).toContainText('Fees already booked stay in the wallet.')
    await confirm.getByRole('button', { name: 'Delete' }).click()
    await expect(page.locator('.fee-card')).toHaveCount(0)
    await expect(page.getByText('No monthly fees yet.')).toBeVisible()
  })

  test('from a wallet, only its fees and no wallet choice', async ({ page }) => {
    await openApp(page, { ...statsRows, recurring_rules: [rule, { ...rule, id: 'r2', wallet_id: 'w3', note_template: 'other' }] }, '/wallet/w3')
    await walletAction(page, 'Wallet monthly fees')
    await expect(page.locator('.fee-card')).toHaveCount(1)
    await expect(page.locator('.fee-card')).toContainText('other')
    await page.getByRole('button', { name: 'New monthly fee' }).click()
    await expect(page.getByLabel('Wallet')).toHaveCount(0)
  })
})

test.describe('settings', () => {
  test('previews the month colors', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'Settings' }).click()
    const cells = page.locator('.month-preview > span')
    await expect(cells).toHaveCount(12)
    await page.getByLabel('Month colors').selectOption('OFF')
    await expect(cells.first().locator('span').last()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  })
})

test.describe('new pages on a phone', () => {
  for (const path of ['/statistics', '/search', '/categories', '/fees', '/wallet/w1']) {
    test(`${path} has no sideways scrolling`, async ({ page }) => {
      await openApp(page, statsRows, path, { width: 360, height: 740 })
      if (path === '/wallet/w1') await page.getByRole('button', { name: 'Search in wallet' }).click()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBe(0)
      const inner = await page.locator('.page, .pane').first().evaluate((el) => el.scrollWidth - el.clientWidth)
      expect(inner).toBeLessThanOrEqual(0)
    })
  }
})

test('screens for a visual check', async ({ page }) => {
  const dir = process.env.SCREENSHOT_DIR
  test.skip(!dir, 'only on request')
  await openWallet(page)
  await page.screenshot({ path: `${dir}/light-wide.png` })
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel('Theme').selectOption('DARK')
  await page.screenshot({ path: `${dir}/settings-dark.png` })
  await page.keyboard.press('Escape')
  await page.screenshot({ path: `${dir}/dark-wide.png` })
  await page.setViewportSize({ width: 390, height: 800 })
  await page.screenshot({ path: `${dir}/dark-phone.png` })
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel('Theme').selectOption('LIGHT')
  await page.keyboard.press('Escape')
  await page.screenshot({ path: `${dir}/light-phone.png` })
  await page.getByRole('button', { name: 'New transaction' }).click()
  await page.getByLabel('Amount').fill('1.459,96')
  await page.screenshot({ path: `${dir}/form-phone.png` })
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.getByRole('combobox', { name: 'Category' }).fill('sho')
  await page.getByRole('button', { name: /Foreign currency/ }).click()
  await page.screenshot({ path: `${dir}/form-wide.png` })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Discard' }).click()
  await walletAction(page, 'Edit wallet')
  await page.getByLabel('Name').waitFor()
  await page.screenshot({ path: `${dir}/wallet-form-wide.png` })
  await page.keyboard.press('Escape')
  const many = {
    wallets: [wallet, second, third],
    categories: statsRows.categories,
    transactions: Array.from({ length: 12 }, (_, i) => [
      makeTx(`o${i}`, monthsAgo(i), 150000 + ((i * 73) % 11) * 40000, 'EXPENSE', { category_id: i % 3 ? 'sub' : 'fuel' }),
      makeTx(`i${i}`, monthsAgo(i, 5), 700000 + ((i * 31) % 7) * 30000, 'INCOME'),
    ]).flat(),
  }
  const statsPage = await page.context().newPage()
  await fakeSupabase(statsPage, many)
  await signedIn(statsPage)
  await statsPage.setViewportSize({ width: 1400, height: 1000 })
  await statsPage.goto('/statistics')
  await expect(statsPage.getByRole('status')).toContainText('Synced')
  await statsPage.getByRole('region', { name: 'By category' }).getByRole('button', { name: /Groceries/ }).first().click()
  await statsPage.screenshot({ path: `${dir}/stats-light.png` })
  await statsPage.getByRole('button', { name: 'Settings' }).click()
  await statsPage.getByLabel('Theme').selectOption('DARK')
  await statsPage.keyboard.press('Escape')
  await statsPage.locator('.column').nth(3).hover()
  await statsPage.screenshot({ path: `${dir}/stats-dark.png` })
  await statsPage.setViewportSize({ width: 390, height: 800 })
  await statsPage.screenshot({ path: `${dir}/stats-phone.png` })
  await statsPage.goto('/search')
  await statsPage.setViewportSize({ width: 1400, height: 800 })
  await statsPage.getByLabel('Period').selectOption('THIS_YEAR')
  await statsPage.screenshot({ path: `${dir}/search-dark.png` })
  await statsPage.goto('/categories')
  await statsPage.locator('.category-row').first().waitFor()
  await statsPage.screenshot({ path: `${dir}/categories-dark.png` })
})
