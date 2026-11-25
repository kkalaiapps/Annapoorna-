import { Link } from 'react-router-dom'
import { ENTRY_ICON, ENTRY_LABEL, type EntryType } from '../types'
import { isLevel, useAuth } from '../auth'

const TYPES: EntryType[] = ['sales', 'cashout', 'vendor_bill', 'wastage']
const HINT: Record<EntryType, string> = {
  sales: 'POS printout or handwritten sheet',
  cashout: 'Money paid out of the drawer',
  vendor_bill: 'Invoice or delivery order',
  wastage: 'Items thrown away',
}

export default function Home() {
  const { profile, role } = useAuth()
  return (
    <div className="stack">
      <h2>Hi {profile?.name.split(' ')[0]}, what are you recording?</h2>
      <div className="grid2">
        {TYPES.map((t) => (
          <Link key={t} to={`/capture/${t}`} className={`tile tile-${t}`}>
            <span className="tile-icon">{ENTRY_ICON[t]}</span>
            <b>{ENTRY_LABEL[t]}</b>
            <small>{HINT[t]}</small>
          </Link>
        ))}
      </div>
      <Link to="/mine" className="btn ghost">📋 My recent entries</Link>
      {isLevel(role, 2) && <p className="muted small">Bills you record are read automatically and wait in Verify.</p>}
    </div>
  )
}
