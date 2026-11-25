import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import type { AppSettings } from '../types'

/** Admin: where bill photos and bank screenshots are saved (one shared Google Drive folder, not each phone's Drive). */
export default function DriveSettings() {
  const [s, setS] = useState<AppSettings>({})
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [params, setParams] = useSearchParams()

  useEffect(() => onSnapshot(doc(db, 'settings', 'app'), (d) => {
    const v = (d.data() ?? {}) as AppSettings
    setS(v)
    setLink((l) => l || v.driveFolderLink || '')
  }), [])
  useEffect(() => {
    const r = params.get('drive')
    if (r) {
      setMsg(r === 'connected' ? '✅ Google Drive connected. Now paste the folder link and save.' : `Drive connection failed: ${r}`)
      params.delete('drive')
      setParams(params, { replace: true })
    }
  }, [])

  const connect = async () => {
    setBusy('Opening Google…')
    try {
      const r = await httpsCallable<{ origin: string }, { url: string }>(functions, 'driveAuthUrl')({ origin: window.location.origin })
      window.location.href = r.data.url
    } catch (e: any) {
      setMsg(e.message)
      setBusy('')
    }
  }
  const save = async () => {
    setBusy('Checking folder…')
    setMsg('')
    try {
      const r = await httpsCallable<{ link: string }, { name: string }>(functions, 'setDriveFolder')({ link })
      setMsg(`✅ Saved. New photos go to “${r.data.name}”.`)
    } catch (e: any) {
      setMsg(e.message)
    }
    setBusy('')
  }

  return (
    <div className="card stack">
      <b>⚙️ Settings · Google Drive for photos</b>
      <p className="muted small">
        All bill photos and bank screenshots are saved in this one folder, sorted by month and type (for example 2026-11 / Vendor bills). Staff phones don't need Google Drive.
      </p>
      <div className="small">
        1. Google account: {s.driveConnectedEmail ? <b className="ok-text">{s.driveConnectedEmail}</b> : <span className="muted">not connected</span>}
      </div>
      <button className="btn ghost" disabled={!!busy} onClick={connect}>{s.driveConnectedEmail ? 'Reconnect Google Drive' : 'Connect Google Drive'}</button>
      <label className="field">
        <span>2. Drive folder link</span>
        <input placeholder="https://drive.google.com/drive/folders/…" value={link} onChange={(e) => setLink(e.target.value)} />
      </label>
      {s.driveFolderName && <div className="small">Current folder: <a className="link" href={s.driveFolderLink} target="_blank" rel="noreferrer">{s.driveFolderName}</a></div>}
      <button className="btn primary" disabled={!!busy || !link || !s.driveConnectedEmail} onClick={save}>{busy || 'Save folder'}</button>
      {msg && <p className="small">{msg}</p>}
    </div>
  )
}
