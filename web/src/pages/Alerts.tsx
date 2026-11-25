import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import type { PriceAlert } from '../types'
import { prettyDate } from '../lib/dates'
import { sgd } from '../lib/money'

export default function Alerts() {
  const [list, setList] = useState<PriceAlert[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  useEffect(() => onSnapshot(query(collection(db, 'priceAlerts'), orderBy('createdAt', 'desc'), limit(200)), (s) => setList(s.docs.map((d) => ({ id: d.id, ...d.data() }) as PriceAlert))), [])
  const shown = (list ?? []).filter((a) => showAll || !a.acknowledged)
  return (
    <div className="stack">
      <h2>Unit price alerts</h2>
      <p className="muted small">Raised when a vendor bill shows a different unit price from that vendor's last verified bill for the same item.</p>
      <label className="row small"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />&nbsp;Show acknowledged</label>
      {list === null && <p className="muted">Loading…</p>}
      {list && shown.length === 0 && <p className="muted">No new price changes. 👍</p>}
      {shown.map((a) => {
        const up = a.newPrice > a.oldPrice
        return (
          <div key={a.id} className={`card stack ${a.acknowledged ? 'dim' : ''}`}>
            <div className="row">
              <b className="grow">{a.itemName}</b>
              <span className={`pill ${up ? 'up' : 'down'}`}>{up ? '▲' : '▼'} {a.changePct != null ? `${Math.abs(a.changePct)}%` : ''}</span>
            </div>
            <div className="small">
              {a.vendorName}: {sgd(a.oldPrice)} ({prettyDate(a.oldDate)}) → <b>{sgd(a.newPrice)}</b> ({prettyDate(a.date)}){a.unit && ` per ${a.unit}`}
            </div>
            <div className="row">
              <Link to={`/entry/${a.entryId}`} className="btn ghost small grow">Open bill</Link>
              {!a.acknowledged && <button className="btn small" onClick={() => updateDoc(doc(db, 'priceAlerts', a.id), { acknowledged: true })}>Acknowledge</button>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
