import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { db } from '../firebase'
import type { Entry } from '../types'
import { LINE_STATUS_LABEL } from '../types'
import { prettyDate, rangeFor, rangeLabel, shift, todaySG, type Period } from '../lib/dates'
import { num, sgd } from '../lib/money'
import { aggregate, type ItemAgg } from '../lib/aggregate'

// Validated categorical palette (dataviz reference): slot 1 blue, slot 2 orange.
const C_SALES = '#257de0'
const C_PURCH = '#f47230'

function Bars({ title, rows, value, fmt, max = 10 }: { title: string; rows: ItemAgg[] | { name: string; amount: number }[]; value: (r: any) => number; fmt: (r: any) => string; max?: number }) {
  const [all, setAll] = useState(false)
  const list = all ? rows : rows.slice(0, max)
  const top = Math.max(...rows.map(value), 1)
  return (
    <div className="card">
      <b>{title}</b>
      {rows.length === 0 ? (
        <p className="muted small">No data for this period.</p>
      ) : (
        <div className="hbars">
          {list.map((r: any, i) => (
            <div key={i} className="hbar" title={fmt(r)}>
              <span className="lbl">{r.name}</span>
              <span className="track"><span className="fill" style={{ width: `${(value(r) / top) * 100}%` }} /></span>
              <span className="val">{fmt(r)}</span>
            </div>
          ))}
        </div>
      )}
      {rows.length > max && <button className="link" onClick={() => setAll(!all)}>{all ? 'Show top ' + max : `Show all ${rows.length}`}</button>}
    </div>
  )
}

export default function Dashboard() {
  const [period, setPeriod] = useState<Period>('week')
  const [anchor, setAnchor] = useState(todaySG())
  const [verifiedOnly, setVerifiedOnly] = useState(false)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const { start, end } = rangeFor(period, anchor)

  useEffect(() => {
    setEntries(null)
    const q = query(collection(db, 'entries'), where('date', '>=', start), where('date', '<=', end), orderBy('date'))
    return onSnapshot(q, (s) => setEntries(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Entry)))
  }, [start, end])

  const a = useMemo(
    () => aggregate((entries ?? []).filter((e) => !verifiedOnly || e.status === 'verified'), start, end),
    [entries, verifiedOnly, start, end],
  )
  const qtyFmt = (r: ItemAgg) => `${num(+r.qty.toFixed(2))}${r.unit ? ' ' + r.unit : ''}${r.amount ? ' · ' + sgd(r.amount) : ''}`

  return (
    <div className="stack">
      <h2>Dashboard</h2>
      <div className="seg">
        {(['day', 'week', 'month'] as Period[]).map((p) => <button key={p} className={period === p ? 'on' : ''} onClick={() => setPeriod(p)}>{p === 'day' ? 'Daily' : p === 'week' ? 'Weekly' : 'Monthly'}</button>)}
      </div>
      <div className="row">
        <button className="icon" onClick={() => setAnchor(shift(period, anchor, -1))}>◀</button>
        <b className="grow center-text">{rangeLabel(period, anchor)}</b>
        <button className="icon" disabled={end >= todaySG()} onClick={() => setAnchor(shift(period, anchor, 1))}>▶</button>
      </div>
      <label className="row small"><input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} />&nbsp;Verified entries only</label>

      {entries === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="stat-row four">
            <div className="stat"><small>Sales</small><b>{sgd(a.totals.sales)}</b></div>
            <div className="stat"><small>Vendor purchases</small><b>{sgd(a.totals.purchases)}</b><small>{a.totals.bills} bills</small></div>
            <div className="stat"><small>Cash out</small><b>{sgd(a.totals.cashout)}</b></div>
            <div className="stat"><small>Wastage</small><b>{a.totals.wastage ? sgd(a.totals.wastage) : `${a.totals.wastageLines} items`}</b></div>
          </div>
          {!verifiedOnly && a.totals.unverified > 0 && <p className="muted small">Includes {a.totals.unverified} {a.totals.unverified === 1 ? "entry" : "entries"} not verified yet.</p>}

          {period !== 'day' && (
            <div className="card">
              <b>Sales vs vendor purchases by day</b>
              <div style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer>
                  <BarChart data={a.days} margin={{ top: 8, right: 4, left: -12, bottom: 0 }} barGap={2}>
                    <CartesianGrid vertical={false} stroke="#eee" />
                    <XAxis dataKey="date" tickFormatter={(d) => prettyDate(d, period === 'week' ? { weekday: 'short' } : { day: 'numeric' })} tick={{ fontSize: 11, fill: '#666' }} tickLine={false} axisLine={{ stroke: '#ddd' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11, fill: '#666' }} tickLine={false} axisLine={false} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : v)} />
                    <Tooltip formatter={(v) => sgd(Number(v))} labelFormatter={(d) => prettyDate(String(d), { weekday: 'short', day: 'numeric', month: 'short' })} cursor={{ fill: 'rgba(0,0,0,.04)' }} />
                    <Legend iconType="square" wrapperStyle={{ fontSize: 12, color: '#666' }} />
                    <Bar dataKey="sales" name="Sales" fill={C_SALES} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="purchases" name="Purchases" fill={C_PURCH} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <Bars title="Items sold (by quantity)" rows={a.sold} value={(r) => r.qty} fmt={qtyFmt} />
          {a.payModes.length > 0 && (
            <div className="card small">
              <b>Sales by payment mode</b>
              {a.payModes.map(([m, v]) => <div key={m} className="row"><span className="grow">{m}</span>{sgd(v)}</div>)}
            </div>
          )}
          <Bars title="Items bought from vendors (by spend)" rows={a.bought} value={(r) => r.amount} fmt={qtyFmt} />
          <Bars title="Spend by vendor" rows={a.vendors} value={(r) => r.amount} fmt={(r) => `${sgd(r.amount)} · ${r.bills} bills`} />
          <Bars title="Wastage" rows={a.wasted} value={(r) => r.qty} fmt={qtyFmt} />

          {a.issues.length > 0 && (
            <div className="card small">
              <b>Delivery issues ({a.issues.length})</b>
              {a.issues.map((x, i) => (
                <Link key={i} to={`/entry/${x.entryId}`} className="row issue">
                  <span className="grow">{x.item} <span className="muted">· {x.vendor} · {prettyDate(x.date, { day: 'numeric', month: 'short' })}</span></span>
                  <span className="flag">{LINE_STATUS_LABEL[x.status]}</span>
                </Link>
              ))}
            </div>
          )}
          <p className="muted small">Sales minus vendor purchases: <b>{sgd(a.totals.sales - a.totals.purchases)}</b>. This is not P&L yet: it ignores stock on hand, rent and wages.</p>
        </>
      )}
    </div>
  )
}
