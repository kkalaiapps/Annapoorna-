import { useEffect, useState } from 'react'
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../auth'
import type { Entry } from '../types'
import EntryCard from '../components/EntryCard'

export default function MyEntries() {
  const { user } = useAuth()
  const [list, setList] = useState<Entry[] | null>(null)
  useEffect(() => {
    const q = query(collection(db, 'entries'), where('createdBy', '==', user!.uid), orderBy('createdAt', 'desc'), limit(50))
    return onSnapshot(q, (s) => setList(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Entry)))
  }, [user])
  return (
    <div className="stack">
      <h2>My entries</h2>
      {list === null ? <p className="muted">Loading…</p> : list.length === 0 ? <p className="muted">Nothing recorded yet.</p> : list.map((e) => <EntryCard key={e.id} e={e} />)}
    </div>
  )
}
