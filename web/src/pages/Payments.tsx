import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import type { Entry } from '../types'
import { prettyDate } from '../lib/dates'
import { sgd } from '../lib/money'

type F = 'outstanding' | 'paid' | 'all'

export default function Payments() {
  const [list, setList] = useState<Entry[] | null>(null)
  const [f, setF] = useState<F>('outstanding')
  const [vendor, setVendor] = useState('')
  useEffect(() => {
    const q = query(collection(db, 'entries'), where('type', '==', 'vendor_bill'), orderBy('date', 'desc'), limit(500))
    return onSnapshot(q, (s) => setList(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Entry).filter((e) => e.status !== 'rejected')))
  }, [])

  const owed = (e: Entry) => Math.max(0, (e.total ?? 0) - (e.payment?.paidAmount ?? 0))
  const byVendor = useMemo(() => {
    const m = new Map<string, { owed: number; bills: number }>()
    for (const e of list ?? []) {
      if (e.payment?.status === 'paid') continue
      const k = e.vendorName || 'Unknown vendor'
      const v = m.get(k) ?? { owed: 0, bills: 0 }
      v.owed += owed(e)
      v.bills++
      m.set(k, v)
    }
    return [...m.entries()].sort((a, b) => b[1].owed - a[1].owed)
  }, [list])
  const totalOwed = byVendor.reduce((s, [, v]) => s + v.owed, 0)
  const maxOwed = byVendor[0]?.[1].owed || 1

  const shown = (list ?? []).filter(
    (e) => (f === 'all' || (f === 'paid' ? e.payment?.status === 'paid' : e.payment?.status !== 'paid')) && (!vendor || (e.vendorName || 'Unknown vendor') === vendor),
  )

  return (
    <div className="stack">
      <h2>Vendor payments</h2>
      <div className="stat-row">
        <div className="stat"><small>Outstanding</small><b>{sgd(totalOwed)}</b></div>
        <div className="stat"><small>Unpaid bills</small><b>{byVendor.reduce((s, [, v]) => s + v.bills, 0)}</b></div>
      </div>

      {byVendor.length > 0 && (
        <div className="card">
          <b>Owed by vendor</b>
          <div className="hbars">
            {byVendor.map(([name, v]) => (
              <button key={name} className={`hbar ${vendor === name ? 'sel' : ''}`} onClick={() => setVendor(vendor === name ? '' : name)} title={`${v.bills} bills`}>
                <span className="lbl">{name}</span>
                <span className="track"><span className="fill" style={{ width: `${(v.owed / maxOwed) * 100}%` }} /></span>
                <span className="val">{sgd(v.owed)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="seg">
        {(['outstanding', 'paid', 'all'] as F[]).map((x) => <button key={x} className={f === x ? 'on' : ''} onClick={() => setF(x)}>{x}</button>)}
      </div>
      {vendor && <button className="btn ghost small" onClick={() => setVendor('')}>Showing {vendor} only ✕</button>}
      {list === null && <p className="muted">Loading…</p>}
      {shown.map((e) => (
        <Link key={e.id} to={`/entry/${e.id}`} className="card row">
          <div className="grow">
            <b>{e.vendorName || 'Unknown vendor'}</b>
            <div className="muted small">{prettyDate(e.date)}{e.invoiceNumber && ` · #${e.invoiceNumber}`}{e.status !== 'verified' && ' · not verified yet'}</div>
          </div>
          <div className="right">
            <div>{sgd(e.total)}</div>
            <span className={`pill pay-${e.payment?.status ?? 'unpaid'}`}>{e.payment?.status ?? 'unpaid'}{e.payment?.proofPaths?.length ? ' 📎' : ''}</span>
          </div>
        </Link>
      ))}
      {list && shown.length === 0 && <p className="muted">Nothing here.</p>}
    </div>
  )
}
