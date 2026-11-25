import { useEffect, useState } from 'react'
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import type { Entry, EntryStatus } from '../types'
import EntryCard from '../components/EntryCard'

const TABS: { s: EntryStatus; label: string }[] = [
  { s: 'needs_review', label: 'To verify' },
  { s: 'processing', label: 'Reading' },
  { s: 'verified', label: 'Verified' },
  { s: 'rejected', label: 'Rejected' },
]

export default function Review() {
  const [tab, setTab] = useState<EntryStatus>('needs_review')
  const [list, setList] = useState<Entry[] | null>(null)
  useEffect(() => {
    setList(null)
    const q = query(collection(db, 'entries'), where('status', '==', tab), orderBy('createdAt', 'desc'), limit(100))
    return onSnapshot(q, (s) => setList(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Entry)))
  }, [tab])
  return (
    <div className="stack">
      <h2>Verify entries</h2>
      <div className="seg">
        {TABS.map((t) => (
          <button key={t.s} className={tab === t.s ? 'on' : ''} onClick={() => setTab(t.s)}>{t.label}</button>
        ))}
      </div>
      {list === null ? <p className="muted">Loading…</p> : list.length === 0 ? <p className="muted">Nothing here.</p> : list.map((e) => <EntryCard key={e.id} e={e} showBy />)}
    </div>
  )
}
