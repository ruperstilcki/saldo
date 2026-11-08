import type { SaldoDb } from '../db/db'
import type { RecurringRule } from '../db/types'
import { nextUpdatedAt } from './transactions'

export interface RuleDraft {
  id: string | null
  walletId: string
  amountMinor: number
  categoryId: string | null
  noteTemplate: string
  startPeriod: string
  isActive: boolean
}

/** Only saves the rule. The phone books the fees, after it receives the rule in a sync. */
export async function saveRule(db: SaldoDb, draft: RuleDraft): Promise<string> {
  const { id, ...fields } = draft
  return db.transaction('rw', db.recurring_rules, db.meta, async () => {
    const existing = id ? await db.recurring_rules.get(id) : undefined
    if (existing) {
      await db.recurring_rules.update(existing.id, { ...fields, updatedAt: nextUpdatedAt(existing.updatedAt), syncState: 'DIRTY' })
      return existing.id
    }
    const now = Date.now()
    const row: RecurringRule = {
      ...fields,
      id: crypto.randomUUID(),
      userId: (await db.getOwner()) ?? '',
      kind: 'EXPENSE',
      schedule: 'MONTHLY_LAST_DAY',
      timeOfDay: '23:59',
      monthNameLocale: 'sr-Latn',
      lastGeneratedPeriod: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      syncState: 'DIRTY',
    }
    await db.recurring_rules.add(row)
    return row.id
  })
}

async function change(db: SaldoDb, id: string, fields: (now: number) => Partial<RecurringRule>) {
  await db.transaction('rw', db.recurring_rules, async () => {
    const rule = await db.recurring_rules.get(id)
    if (!rule) return
    const now = nextUpdatedAt(rule.updatedAt)
    await db.recurring_rules.update(id, { ...fields(now), updatedAt: now, syncState: 'DIRTY' })
  })
}

export const setRuleActive = (db: SaldoDb, id: string, isActive: boolean) => change(db, id, () => ({ isActive }))

/** Fees already booked stay in the wallet. */
export const deleteRule = (db: SaldoDb, id: string) => change(db, id, (now) => ({ deletedAt: now }))
