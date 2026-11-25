import type { Entry, LineStatus } from '../types'
import { daysBetween } from './dates'
import { keyOf } from './money'

export interface ItemAgg { name: string; qty: number; unit: string | null; amount: number; count: number }
export interface DayAgg { date: string; sales: number; purchases: number; cashout: number }

function addItem(m: Map<string, ItemAgg>, name: string, qty: number | null, unit: string | null, amount: number | null) {
  const k = keyOf(name) + '|' + (unit ?? '').toLowerCase()
  const a = m.get(k) ?? { name, qty: 0, unit, amount: 0, count: 0 }
  a.qty += qty ?? 0
  a.amount += amount ?? 0
  a.count++
  m.set(k, a)
}

/** Everything the dashboard shows, computed from entries in the selected range. */
export function aggregate(entries: Entry[], start: string, end: string) {
  const days = new Map<string, DayAgg>(daysBetween(start, end).map((d) => [d, { date: d, sales: 0, purchases: 0, cashout: 0 }]))
  const sold = new Map<string, ItemAgg>()
  const bought = new Map<string, ItemAgg>()
  const wasted = new Map<string, ItemAgg>()
  const vendors = new Map<string, { name: string; amount: number; bills: number }>()
  const payModes = new Map<string, number>()
  const issues: { entryId: string; date: string; vendor: string; item: string; status: LineStatus; note: string | null }[] = []
  const t = { sales: 0, purchases: 0, cashout: 0, wastage: 0, wastageLines: 0, bills: 0, unverified: 0 }

  for (const e of entries) {
    if (e.status === 'rejected' || e.status === 'processing') continue
    if (e.status !== 'verified') t.unverified++
    const day = days.get(e.date)
    const total = e.total ?? (e.lines ?? []).reduce((s, l) => s + (l.amount ?? 0), 0)
    if (e.type === 'sales') {
      t.sales += total
      if (day) day.sales += total
      for (const l of e.lines ?? []) addItem(sold, l.itemName, l.quantity, l.unit, l.amount)
      for (const p of e.paymentBreakdown ?? []) payModes.set(p.method, (payModes.get(p.method) ?? 0) + p.amount)
    } else if (e.type === 'vendor_bill') {
      t.purchases += total
      t.bills++
      if (day) day.purchases += total
      const vn = e.vendorName || 'Unknown vendor'
      const v = vendors.get(keyOf(vn)) ?? { name: vn, amount: 0, bills: 0 }
      v.amount += total
      v.bills++
      vendors.set(keyOf(vn), v)
      for (const l of e.lines ?? []) {
        if (l.status !== 'ok') issues.push({ entryId: e.id, date: e.date, vendor: vn, item: l.itemName, status: l.status, note: l.note })
        if (l.status !== 'not_delivered') addItem(bought, l.itemName, l.quantity, l.unit, l.amount)
      }
    } else if (e.type === 'cashout') {
      t.cashout += total
      if (day) day.cashout += total
    } else if (e.type === 'wastage') {
      t.wastage += total
      for (const l of e.lines ?? []) {
        t.wastageLines++
        addItem(wasted, l.itemName, l.quantity, l.unit, l.amount)
      }
    }
  }
  const byAmount = (m: Map<string, ItemAgg>) => [...m.values()].sort((a, b) => b.amount - a.amount || b.qty - a.qty)
  const byQty = (m: Map<string, ItemAgg>) => [...m.values()].sort((a, b) => b.qty - a.qty)
  return {
    totals: t,
    days: [...days.values()],
    sold: byQty(sold),
    bought: byAmount(bought),
    wasted: byQty(wasted),
    vendors: [...vendors.values()].sort((a, b) => b.amount - a.amount),
    payModes: [...payModes.entries()].sort((a, b) => b[1] - a[1]),
    issues,
  }
}
