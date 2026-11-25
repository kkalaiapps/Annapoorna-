import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { lazy, Suspense, useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db, ENTITY } from './firebase'
import { isLevel, useAuth } from './auth'
import { ROLE_LABEL } from './types'
import Login from './pages/Login'
import Home from './pages/Home'
import Capture from './pages/Capture'
import MyEntries from './pages/MyEntries'
import Review from './pages/Review'
import EntryDetail from './pages/EntryDetail'
import Payments from './pages/Payments'
import Alerts from './pages/Alerts'
import Admin from './pages/Admin'
const Dashboard = lazy(() => import('./pages/Dashboard'))

function useOpenAlerts(enabled: boolean) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!enabled) return
    return onSnapshot(query(collection(db, 'priceAlerts'), where('acknowledged', '==', false)), (s) => setN(s.size))
  }, [enabled])
  return n
}

export default function App() {
  const { user, profile, loading, role, logout } = useAuth()
  const l2 = isLevel(role, 2)
  const alerts = useOpenAlerts(l2)

  if (loading) return <div className="center muted">Loading…</div>
  if (!user) return <Login />
  if (!profile || !isLevel(role, 1))
    return (
      <div className="center stack">
        <h2>{role === 'disabled' ? 'Access removed' : 'Waiting for approval'}</h2>
        <p className="muted">
          You are signed in as <b>{user.email}</b>.<br />
          {role === 'disabled' ? 'Ask the admin if this is a mistake.' : 'The admin needs to approve your email before you can use the app.'}
        </p>
        <button className="btn ghost" onClick={logout}>Sign out</button>
      </div>
    )

  return (
    <div className="app">
      <header className="top">
        <div>
          <div className="brand">ANNAPOORNA</div>
          <div className="sub">{ENTITY.replace('ANNAPOORNA ', '')} · {ROLE_LABEL[role!]}</div>
        </div>
        <button className="avatar" onClick={() => confirm('Sign out?') && logout()} title={profile.email}>
          {profile.photoURL ? <img src={profile.photoURL} alt="" referrerPolicy="no-referrer" /> : profile.name[0]}
        </button>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/capture/:type" element={<Capture />} />
          <Route path="/mine" element={<MyEntries />} />
          <Route path="/entry/:id" element={<EntryDetail />} />
          {l2 && <Route path="/review" element={<Review />} />}
          {l2 && <Route path="/payments" element={<Payments />} />}
          {l2 && <Route path="/dashboard" element={<Suspense fallback={<p className="muted">Loading…</p>}><Dashboard /></Suspense>} />}
          {l2 && <Route path="/alerts" element={<Alerts />} />}
          {role === 'L3' && <Route path="/admin" element={<Admin />} />}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
      <nav className="tabs">
        <NavLink to="/" end><span>📷</span>Record</NavLink>
        {!l2 && <NavLink to="/mine"><span>📋</span>My entries</NavLink>}
        {l2 && <NavLink to="/review"><span>✅</span>Verify</NavLink>}
        {l2 && <NavLink to="/payments"><span>🏦</span>Payments</NavLink>}
        {l2 && <NavLink to="/dashboard"><span>📊</span>Dashboard</NavLink>}
        {l2 && (
          <NavLink to="/alerts">
            <span>🔔{alerts > 0 && <i className="badge">{alerts}</i>}</span>Alerts
          </NavLink>
        )}
        {role === 'L3' && <NavLink to="/admin"><span>👥</span>Admin</NavLink>}
      </nav>
    </div>
  )
}
