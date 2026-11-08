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
}

/** Answers everything the app asks of Supabase, and records what it sends. */
async function fakeSupabase(page: Page, rows: Record<string, unknown[]> = { wallets: [wallet], transactions: [tx], categories: [category] }): Promise<Server> {
  const server: Server = { upserts: [], logouts: [], offline: false }
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
  await page.getByRole('button', { name: 'Edit note' }).click()
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
  await page.getByRole('button', { name: 'Edit note' }).click()
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
  await page.getByRole('button', { name: 'Edit note' }).click()
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
  await page.getByRole('button', { name: 'Back to wallets' }).click()
  await page.screenshot({ path: `${dir}/light-phone-list.png` })
})
