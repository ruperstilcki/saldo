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
  await expect(page.getByText('Wallets')).toHaveCount(0)
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
  await page.getByRole('button', { name: /Made up note/ }).click()
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
  await page.getByRole('button', { name: /Made up note/ }).click()
  await page.getByLabel('Note', { exact: true }).fill('Offline edit')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('button', { name: 'Sync now' }).click()
  await expect(page.getByRole('status')).toContainText('1 unsent')
  await expect(page.getByRole('button', { name: /Offline edit/ })).toBeVisible()
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

  await page.getByRole('button', { name: 'Sign out' }).click()

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
  await page.getByRole('button', { name: /Made up note/ }).click()
  await page.getByLabel('Note', { exact: true }).fill('Kept while signed out')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
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
