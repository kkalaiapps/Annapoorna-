import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { ref, uploadBytes } from 'firebase/storage'
import { db, ENTITY, storage } from '../firebase'
import { useAuth } from '../auth'
import { compressImage } from '../lib/image'
import { todaySG } from '../lib/dates'
import { ENTRY_ICON, ENTRY_LABEL, type EntryType } from '../types'

interface Shot { file: File; url: string }

export default function Capture() {
  const { type } = useParams() as { type: EntryType }
  const { user, profile } = useAuth()
  const nav = useNavigate()
  const camRef = useRef<HTMLInputElement>(null)
  const galRef = useRef<HTMLInputElement>(null)
  const [shots, setShots] = useState<Shot[]>([])
  const [date, setDate] = useState(todaySG())
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  if (!ENTRY_LABEL[type]) return <p>Unknown entry type.</p>

  const add = (files: FileList | null) => {
    if (!files) return
    setShots((s) => [...s, ...Array.from(files).map((file) => ({ file, url: URL.createObjectURL(file) }))])
  }

  const submit = async () => {
    if (!shots.length || !user) return
    setErr('')
    try {
      const entryRef = doc(collection(db, 'entries'))
      const paths: string[] = []
      for (let i = 0; i < shots.length; i++) {
        setBusy(`Uploading photo ${i + 1} of ${shots.length}…`)
        const blob = await compressImage(shots[i].file)
        const path = `entries/${entryRef.id}/${i + 1}.jpg`
        await uploadBytes(ref(storage, path), blob, { contentType: 'image/jpeg' })
        paths.push(path)
      }
      setBusy('Saving…')
      await setDoc(entryRef, {
        entity: ENTITY,
        type,
        date,
        status: 'processing',
        photoPaths: paths,
        remarks: remarks.trim() || null,
        createdBy: user.uid,
        createdByName: profile?.name ?? user.email,
        createdAt: serverTimestamp(),
        ...(type === 'vendor_bill' ? { payment: { status: 'unpaid' } } : {}),
      })
      nav(`/entry/${entryRef.id}`, { replace: true })
    } catch (e: any) {
      setErr(e.message ?? String(e))
      setBusy('')
    }
  }

  return (
    <div className="stack">
      <h2>{ENTRY_ICON[type]} {ENTRY_LABEL[type]}</h2>

      <div className="grid2">
        <button className="btn big camera" onClick={() => camRef.current?.click()} disabled={!!busy}>
          <span className="tile-icon">📷</span>Take photo
        </button>
        <button className="btn big gallery" onClick={() => galRef.current?.click()} disabled={!!busy}>
          <span className="tile-icon">🖼️</span>Upload from phone
        </button>
      </div>
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = '' }} />
      <input ref={galRef} type="file" accept="image/*" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = '' }} />

      {shots.length > 0 && (
        <>
          <p className="muted small">{shots.length} photo{shots.length > 1 ? 's' : ''}. Long bill? Take one photo per page.</p>
          <div className="thumbs">
            {shots.map((s, i) => (
              <div key={s.url} className="thumb">
                <img src={s.url} alt={`page ${i + 1}`} />
                <button onClick={() => setShots((x) => x.filter((_, j) => j !== i))} aria-label="remove">✕</button>
              </div>
            ))}
          </div>
        </>
      )}

      <label className="field">
        <span>Business date</span>
        <input type="date" value={date} max={todaySG()} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="field">
        <span>Remarks (optional)</span>
        <textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={type === 'vendor_bill' ? 'e.g. onions bad, 2 bags to replace' : ''} />
      </label>

      {err && <p className="error">{err}</p>}
      <button className="btn primary big" disabled={!shots.length || !!busy} onClick={submit}>
        {busy || 'Submit'}
      </button>
    </div>
  )
}
