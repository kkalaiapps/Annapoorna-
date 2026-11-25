// All business dates are Singapore dates (Asia/Singapore, UTC+8, no DST).
const TZ = 'Asia/Singapore'

export function todaySG(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

const parse = (d: string) => new Date(d + 'T00:00:00Z')
const fmt = (d: Date) => d.toISOString().slice(0, 10)
export const addDays = (d: string, n: number) => fmt(new Date(parse(d).getTime() + n * 86400000))

export type Period = 'day' | 'week' | 'month'

/** Inclusive range containing `anchor`. Weeks run Monday to Sunday. */
export function rangeFor(period: Period, anchor: string): { start: string; end: string } {
  if (period === 'day') return { start: anchor, end: anchor }
  if (period === 'week') {
    const dow = (parse(anchor).getUTCDay() + 6) % 7
    const start = addDays(anchor, -dow)
    return { start, end: addDays(start, 6) }
  }
  const d = parse(anchor)
  const start = fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)))
  const end = fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)))
  return { start, end }
}

export function shift(period: Period, anchor: string, dir: 1 | -1): string {
  if (period === 'day') return addDays(anchor, dir)
  if (period === 'week') return addDays(anchor, 7 * dir)
  const d = parse(anchor)
  return fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, 1)))
}

export function daysBetween(start: string, end: string): string[] {
  const out: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d)
  return out
}

export function prettyDate(d: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return parse(d).toLocaleDateString('en-SG', { ...opts, timeZone: 'UTC' })
}

export function rangeLabel(period: Period, anchor: string) {
  const { start, end } = rangeFor(period, anchor)
  if (period === 'day') return prettyDate(start, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  if (period === 'month') return prettyDate(start, { month: 'long', year: 'numeric' })
  return `${prettyDate(start, { day: 'numeric', month: 'short' })} – ${prettyDate(end)}`
}
