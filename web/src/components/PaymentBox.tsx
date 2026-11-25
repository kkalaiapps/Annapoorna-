import { useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { ref, uploadBytes } from 'firebase/storage'
import { db, storage } from '../firebase'
import { useAuth } from '../auth'
import { compressImage } from '../lib/image'
import { todaySG } from '../lib/dates'
import { sgd } from '../lib/money'
import type { Entry } from '../types'
import Photos from './Photos'

/** Level 2: record that a vendor bill was paid by bank transfer, with the bank screenshot as proof. */
export default function PaymentBox({ e }: { e: Entry }) {
  const { profile } = useAuth()
  const p = e.payment ?? { status: 'unpaid' as const }
  const [amount, setAmount] = useState(String(p.paidAmount ?? e.total ?? ''))
  const [date, setDate] = useState(p.paidDate ?? todaySG())
  const [bankRef, setBankRef] = useState(p.bankRef ?? '')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(p.status !== 'paid')

  const save = async () => {
    setBusy(true)
    try {
      const paths = [...(p.proofPaths ?? [])]
      for (const f of files) {
        const path = `payments/${e.id}/${Date.now()}-${paths.length + 1}.jpg`
        await uploadBytes(ref(storage, path), await compressImage(f), { contentType: 'image/jpeg' })
        paths.push(path)
      }
      const paid = Number(amount) || 0
      const status = paid <= 0 ? 'unpaid' : e.total != null && paid + 0.005 < e.total ? 'partial' : 'paid'
      await updateDoc(doc(db, 'entries', e.id), {
        payment: { status, paidAmount: paid || null, paidDate: date, bankRef: bankRef.trim() || null, proofPaths: paths, markedBy: profile?.name ?? null },
      })
      setFiles([])
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card stack">
      <div className="row">
        <b className="grow">🏦 Payment</b>
        <span className={`pill pay-${p.status}`}>{p.status}</span>
      </div>
      {p.status !== 'unpaid' && (
        <div className="small">
          Paid {sgd(p.paidAmount)} on {p.paidDate}{p.bankRef && ` · ref ${p.bankRef}`}{p.markedBy && ` · by ${p.markedBy}`}
        </div>
      )}
      {!!p.proofPaths?.length && <Photos entry={e} paths={p.proofPaths} showDriveLinks />}
      {editing ? (
        <>
          <div className="grid2">
            <label className="field"><span>Amount paid (SGD)</span><input inputMode="decimal" value={amount} onChange={(x) => setAmount(x.target.value)} /></label>
            <label className="field"><span>Paid on</span><input type="date" value={date} onChange={(x) => setDate(x.target.value)} /></label>
          </div>
          <label className="field"><span>Bank reference (optional)</span><input value={bankRef} onChange={(x) => setBankRef(x.target.value)} /></label>
          <label className="btn ghost">
            📎 Add bank screenshot{files.length ? ` (${files.length})` : ''}
            <input type="file" accept="image/*" multiple hidden onChange={(x) => setFiles([...files, ...Array.from(x.target.files ?? [])])} />
          </label>
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save payment'}</button>
        </>
      ) : (
        <button className="btn ghost" onClick={() => setEditing(true)}>Edit payment</button>
      )}
    </div>
  )
}
