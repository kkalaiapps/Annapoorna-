import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { arrayUnion, collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { isLevel, useAuth } from '../auth'
import { ENTRY_ICON, ENTRY_LABEL, LINE_STATUS_LABEL, type Entry, type Line, type LineStatus, type PriceAlert } from '../types'
import { prettyDate } from '../lib/dates'
import { num, sgd } from '../lib/money'
import Photos from '../components/Photos'
import PaymentBox from '../components/PaymentBox'
import { STATUS_LABEL } from '../components/EntryCard'

const blankLine = (): Line => ({ itemName: '', quantity: null, unit: null, unitPrice: null, amount: null, status: 'ok', note: null })
const toNum = (s: string) => (s.trim() === '' || isNaN(Number(s)) ? null : Number(s))

export default function EntryDetail() {
  const { id } = useParams() as { id: string }
  const { role, profile } = useAuth()
  const nav = useNavigate()
  const canEdit = isLevel(role, 2)
  const [e, setE] = useState<Entry | null | undefined>(undefined)
  const [draft, setDraft] = useState<Entry | null>(null)
  const [alerts, setAlerts] = useState<PriceAlert[]>([])
  const [busy, setBusy] = useState('')

  useEffect(() => onSnapshot(doc(db, 'entries', id), (s) => setE(s.exists() ? ({ id: s.id, ...s.data() } as Entry) : null), () => setE(null)), [id])
  useEffect(() => {
    if (!canEdit) return
    return onSnapshot(query(collection(db, 'priceAlerts'), where('entryId', '==', id)), (s) => setAlerts(s.docs.map((d) => ({ id: d.id, ...d.data() }) as PriceAlert)))
  }, [id, canEdit])

  const lineTotal = useMemo(() => (draft?.lines ?? []).reduce((s, l) => s + (l.amount ?? 0), 0), [draft])

  if (e === undefined) return <p className="muted">Loading…</p>
  if (e === null) return <p>Entry not found, or you don't have access.</p>

  const editing = draft !== null
  const view = draft ?? e
  const setLine = (i: number, patch: Partial<Line>) =>
    setDraft((d) => {
      const lines = [...(d!.lines ?? [])]
      const l = { ...lines[i], ...patch }
      if (('quantity' in patch || 'unitPrice' in patch) && l.quantity != null && l.unitPrice != null) l.amount = +(l.quantity * l.unitPrice).toFixed(2)
      lines[i] = l
      return { ...d!, lines }
    })

  const save = async (status?: 'verified' | 'rejected') => {
    const src = draft ?? e
    let rejectReason: string | null = null
    if (status === 'rejected') {
      rejectReason = prompt('Reason for rejecting?')
      if (rejectReason === null) return
    }
    setBusy('Saving…')
    const lines = (src.lines ?? []).filter((l) => l.itemName.trim())
    const patch: Record<string, unknown> = {
      vendorName: src.vendorName ?? null,
      invoiceNumber: src.invoiceNumber ?? null,
      date: src.date,
      lines,
      gst: src.gst ?? null,
      total: src.total ?? null,
      hasIssues: lines.some((l) => l.status !== 'ok'),
    }
    if (draft) patch.editLog = arrayUnion({ by: profile!.name, at: new Date().toISOString(), summary: 'Edited fields' })
    if (status) {
      patch.status = status
      patch.verifiedBy = profile!.uid
      patch.verifiedByName = profile!.name
      patch.verifiedAt = serverTimestamp()
      patch.rejectReason = rejectReason
    }
    await updateDoc(doc(db, 'entries', e.id), patch)
    setDraft(null)
    setBusy('')
    if (status) nav('/review')
  }

  const reread = async () => {
    setBusy('Reading photos again…')
    try {
      await httpsCallable(functions, 'rereadEntry')({ entryId: e.id })
    } catch (x: any) {
      alert(x.message)
    }
    setBusy('')
  }

  return (
    <div className="stack">
      <div className="row">
        <h2 className="grow">{ENTRY_ICON[e.type]} {ENTRY_LABEL[e.type]}</h2>
        <span className={`pill ${e.status}`}>{STATUS_LABEL[e.status]}</span>
      </div>
      <div className="muted small">
        {prettyDate(e.date)} · recorded by {e.createdByName}
        {e.verifiedByName && ` · ${e.status} by ${e.verifiedByName}`}
      </div>
      {e.remarks && <div className="card small">💬 {e.remarks}</div>}
      <Photos entry={e} paths={e.photoPaths} showDriveLinks={canEdit} />
      {canEdit && e.driveError && <div className="card warn small">Could not save to Google Drive: {e.driveError}. The photo is kept in the app storage instead.</div>}

      {e.status === 'processing' && <div className="card info">⏳ Reading the photo. This usually takes under a minute; the page updates by itself.</div>}
      {e.extractionError && <div className="card warn">Could not read automatically: {e.extractionError}{canEdit && ' You can type the details below.'}</div>}
      {e.rejectReason && <div className="card warn">Rejected: {e.rejectReason}</div>}
      {!!e.warnings?.length && (
        <div className="card warn small">
          <b>Check these:</b>
          <ul>{e.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      {alerts.map((a) => (
        <div key={a.id} className="card alert small">
          🔔 <b>{a.itemName}</b> price changed: {sgd(a.oldPrice)} → <b>{sgd(a.newPrice)}</b>
          {a.changePct != null && ` (${a.changePct > 0 ? '+' : ''}${a.changePct}%)`} since {prettyDate(a.oldDate)}
        </div>
      ))}

      {e.status !== 'processing' && (
        <div className="card stack">
          {e.type === 'vendor_bill' && (
            <div className="grid2">
              <label className="field"><span>Vendor</span><input disabled={!editing} value={view.vendorName ?? ''} onChange={(x) => setDraft({ ...view, vendorName: x.target.value })} /></label>
              <label className="field"><span>Invoice no.</span><input disabled={!editing} value={view.invoiceNumber ?? ''} onChange={(x) => setDraft({ ...view, invoiceNumber: x.target.value })} /></label>
            </div>
          )}
          {editing && (
            <label className="field"><span>Business date</span><input type="date" value={view.date} onChange={(x) => setDraft({ ...view, date: x.target.value })} /></label>
          )}

          <b>{e.type === 'sales' ? 'Items sold' : e.type === 'cashout' ? 'Payouts' : e.type === 'wastage' ? 'Items wasted' : 'Items supplied'}</b>
          {(view.lines ?? []).length === 0 && <p className="muted small">No lines.</p>}
          {(view.lines ?? []).map((l, i) =>
            editing ? (
              <div key={i} className={`line edit s-${l.status}`}>
                <input className="name" placeholder="Item" value={l.itemName} onChange={(x) => setLine(i, { itemName: x.target.value })} />
                <div className="grid4">
                  <input inputMode="decimal" placeholder="Qty" value={l.quantity ?? ''} onChange={(x) => setLine(i, { quantity: toNum(x.target.value) })} />
                  <input placeholder="Unit" value={l.unit ?? ''} onChange={(x) => setLine(i, { unit: x.target.value || null })} />
                  <input inputMode="decimal" placeholder="Unit $" value={l.unitPrice ?? ''} onChange={(x) => setLine(i, { unitPrice: toNum(x.target.value) })} />
                  <input inputMode="decimal" placeholder="Amount" value={l.amount ?? ''} onChange={(x) => setLine(i, { amount: toNum(x.target.value) })} />
                </div>
                <div className="row">
                  <select value={l.status} onChange={(x) => setLine(i, { status: x.target.value as LineStatus })}>
                    {Object.entries(LINE_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <input className="grow" placeholder="Note" value={l.note ?? ''} onChange={(x) => setLine(i, { note: x.target.value || null })} />
                  <button className="icon" onClick={() => setDraft({ ...view, lines: view.lines!.filter((_, j) => j !== i) })}>🗑️</button>
                </div>
              </div>
            ) : (
              <div key={i} className={`line s-${l.status}`}>
                <div className="row">
                  <span className="grow">{l.itemName}</span>
                  <b>{sgd(l.amount)}</b>
                </div>
                <div className="muted small">
                  {num(l.quantity)} {l.unit ?? ''} {l.unitPrice != null && `× ${sgd(l.unitPrice)}`}
                  {l.status !== 'ok' && <span className="flag"> · {LINE_STATUS_LABEL[l.status]}</span>}
                  {l.note && ` · “${l.note}”`}
                </div>
              </div>
            ),
          )}
          {editing && <button className="btn ghost" onClick={() => setDraft({ ...view, lines: [...(view.lines ?? []), blankLine()] })}>+ Add line</button>}

          {!!e.paymentBreakdown?.length && (
            <div className="small">
              <b>Payment modes</b>
              {e.paymentBreakdown.map((p, i) => <div key={i} className="row"><span className="grow">{p.method}</span>{sgd(p.amount)}</div>)}
            </div>
          )}
          <div className="totals">
            {e.type === 'vendor_bill' && (
              <div className="row"><span className="grow">GST</span>{editing ? <input inputMode="decimal" value={view.gst ?? ''} onChange={(x) => setDraft({ ...view, gst: toNum(x.target.value) })} /> : sgd(view.gst)}</div>
            )}
            <div className="row big"><span className="grow">Total</span>{editing ? <input inputMode="decimal" value={view.total ?? ''} onChange={(x) => setDraft({ ...view, total: toNum(x.target.value) })} /> : <b>{sgd(view.total)}</b>}</div>
            {editing && Math.abs(lineTotal + (view.gst ?? 0) - (view.total ?? 0)) > 0.05 && (
              <div className="muted small">Lines + GST add up to {sgd(lineTotal + (view.gst ?? 0))}</div>
            )}
          </div>
        </div>
      )}

      {canEdit && e.status !== 'processing' && (
        <div className="stack">
          {editing ? (
            <div className="grid2">
              <button className="btn ghost" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn" disabled={!!busy} onClick={() => save()}>{busy || 'Save changes'}</button>
            </div>
          ) : (
            <button className="btn ghost" onClick={() => setDraft({ ...e, lines: e.lines ?? [] })}>✏️ Edit</button>
          )}
          {e.status !== 'verified' && (
            <div className="grid2">
              <button className="btn danger" disabled={!!busy} onClick={() => save('rejected')}>Reject</button>
              <button className="btn primary" disabled={!!busy} onClick={() => save('verified')}>✅ Verify</button>
            </div>
          )}
          <button className="btn ghost small" disabled={!!busy} onClick={reread}>↻ Read photos again</button>
        </div>
      )}

      {canEdit && e.type === 'vendor_bill' && e.status !== 'processing' && <PaymentBox e={e} />}
    </div>
  )
}
