const f = new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' })
export const sgd = (n: number | null | undefined) => (n == null || isNaN(n) ? '–' : f.format(n))
export const num = (n: number | null | undefined) => (n == null ? '–' : Number.isInteger(n) ? String(n) : n.toFixed(2))
export const keyOf = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'unknown'
