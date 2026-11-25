import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, type User } from 'firebase/auth'
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth, db, google } from './firebase'
import type { Role, UserProfile } from './types'

/** The first Level 3 admin. Everyone else starts as "pending" unless the admin invited their email with a level. */
export const BOOTSTRAP_ADMIN = 'kkalai@gmail.com'

interface AuthState {
  user: User | null
  profile: UserProfile | null
  loading: boolean
  role: Role | null
  login: () => Promise<void>
  logout: () => Promise<void>
}
const Ctx = createContext<AuthState>(null!)
export const useAuth = () => useContext(Ctx)
export const isLevel = (role: Role | null | undefined, min: 1 | 2 | 3) =>
  !!role && ['L1', 'L2', 'L3'].includes(role) && Number(role[1]) >= min

async function ensureProfile(u: User) {
  const ref = doc(db, 'users', u.uid)
  const snap = await getDoc(ref)
  if (snap.exists()) return
  const email = (u.email ?? '').toLowerCase()
  let role: Role = 'pending'
  if (email === BOOTSTRAP_ADMIN) role = 'L3'
  else {
    const invite = await getDoc(doc(db, 'invites', email)).catch(() => null)
    if (invite?.exists()) role = invite.get('role')
  }
  await setDoc(ref, { uid: u.uid, email, name: u.displayName ?? email, photoURL: u.photoURL ?? null, role, createdAt: serverTimestamp() })
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let unsubProfile = () => {}
    const unsub = onAuthStateChanged(auth, async (u) => {
      unsubProfile()
      setUser(u)
      if (!u) {
        setProfile(null)
        setLoading(false)
        return
      }
      try {
        await ensureProfile(u)
      } catch (e) {
        console.error(e)
      }
      unsubProfile = onSnapshot(doc(db, 'users', u.uid), (s) => {
        setProfile(s.exists() ? (s.data() as UserProfile) : null)
        setLoading(false)
      })
    })
    return () => {
      unsub()
      unsubProfile()
    }
  }, [])

  const login = async () => {
    try {
      await signInWithPopup(auth, google)
    } catch (e: any) {
      // Some phone browsers block popups (in-app browsers, iOS standalone PWA): fall back to a full-page redirect.
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e?.code))
        await signInWithRedirect(auth, google)
      else if (e?.code !== 'auth/popup-closed-by-user') throw e
    }
  }

  return (
    <Ctx.Provider value={{ user, profile, loading, role: profile?.role ?? null, login, logout: () => signOut(auth) }}>
      {children}
    </Ctx.Provider>
  )
}
