import { Link } from 'react-router-dom'
import { ENTRY_ICON, ENTRY_LABEL, type Entry } from '../types'
import { prettyDate } from '../lib/dates'
import { sgd } from '../lib/money'

export const STATUS_LABEL = { processing: 'Reading…', needs_review: 'To verify', verified: 'Verified', rejected: 'Rejected' }

export default function EntryCard({ e, showBy }: { e: Entry; showBy?: boolean }) {
  return (
    <Link to={`/entry/${e.id}`} className="card row">
      <span className="tile-icon">{ENTRY_ICON[e.type]}</span>
      <div className="grow">
        <b>{e.type === 'vendor_bill' && e.vendorName ? e.vendorName : ENTRY_LABEL[e.type]}</b>
        <div className="muted small">
          {prettyDate(e.date)}
          {showBy && ` · ${e.createdByName}`}
          {e.hasIssues && ' · ⚠️ items flagged'}
          {e.type === 'vendor_bill' && e.payment && ` · ${e.payment.status}`}
        </div>
      </div>
      <div className="right">
        <div>{sgd(e.total)}</div>
        <span className={`pill ${e.status}`}>{STATUS_LABEL[e.status]}</span>
      </div>
    </Link>
  )
}
