import { useEffect, useState } from 'react'
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { BOOTSTRAP_ADMIN, useAuth } from '../auth'
import DriveSettings from '../components/DriveSettings'
import { ROLE_LABEL, type Role, type UserProfile } from '../types'

const ASSIGNABLE: Role[] = ['L1', 'L2', 'L3', 'disabled']

export default function Admin() {
  const { profile } = useAuth()
  const [users, setUsers] = useState<UserProfile[]>([])
  const [invites, setInvites] = useState<{ id: string; role: Role }[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('L1')

  useEffect(() => onSnapshot(query(collection(db, 'users'), orderBy('createdAt', 'desc')), (s) => setUsers(s.docs.map((d) => d.data() as UserProfile))), [])
  useEffect(() => onSnapshot(collection(db, 'invites'), (s) => setInvites(s.docs.map((d) => ({ id: d.id, role: d.get('role') })))), [])

  const setUserRole = (u: UserProfile, r: Role) =>
    updateDoc(doc(db, 'users', u.uid), { role: r, approvedBy: profile!.email, approvedAt: serverTimestamp() })

  const invite = async () => {
    const e = email.trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(e)) return alert('Enter a valid email')
    const existing = users.find((u) => u.email === e)
    if (existing) await setUserRole(existing, role)
    else await setDoc(doc(db, 'invites', e), { role, invitedBy: profile!.email, createdAt: serverTimestamp() })
    setEmail('')
  }

  const pending = users.filter((u) => u.role === 'pending')
  const others = users.filter((u) => u.role !== 'pending')

  return (
    <div className="stack">
      <h2>Users & settings</h2>

      <DriveSettings />

      {pending.length > 0 && (
        <div className="card stack">
          <b>Waiting for approval ({pending.length})</b>
          {pending.map((u) => (
            <div key={u.uid} className="stack small">
              <div><b>{u.name}</b> · {u.email}</div>
              <div className="grid3">
                <button className="btn small" onClick={() => setUserRole(u, 'L1')}>Level 1</button>
                <button className="btn small" onClick={() => setUserRole(u, 'L2')}>Level 2</button>
                <button className="btn danger small" onClick={() => setUserRole(u, 'disabled')}>Deny</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card stack">
        <b>Pre-approve an email</b>
        <p className="muted small">They get this level the first time they sign in with Google.</p>
        <input type="email" placeholder="name@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <div className="row">
          <select className="grow" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ASSIGNABLE.filter((r) => r !== 'disabled').map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <button className="btn primary" onClick={invite}>Approve</button>
        </div>
        {invites.map((i) => (
          <div key={i.id} className="row small">
            <span className="grow">✉️ {i.id} · {ROLE_LABEL[i.role]}</span>
            <button className="icon" onClick={() => deleteDoc(doc(db, 'invites', i.id))}>✕</button>
          </div>
        ))}
      </div>

      <div className="card stack">
        <b>All users</b>
        {others.map((u) => (
          <div key={u.uid} className="row small">
            <div className="grow"><b>{u.name}</b><div className="muted">{u.email}</div></div>
            <select value={u.role} disabled={u.email === BOOTSTRAP_ADMIN || u.uid === profile!.uid} onChange={(e) => setUserRole(u, e.target.value as Role)}>
              {ASSIGNABLE.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}
