import { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import type { Entry } from '../types'

// Photos live in the admin's Google Drive folder. The app fetches them through a Cloud Function that checks access.
const cache = new Map<string, Promise<string>>()
const getPhoto = httpsCallable<{ entryId: string; path: string }, { dataUrl: string }>(functions, 'getPhoto')
const load = (entryId: string, path: string) => {
  const k = entryId + '|' + path
  if (!cache.has(k)) {
    const p = getPhoto({ entryId, path }).then((r) => r.data.dataUrl)
    p.catch(() => cache.delete(k))
    cache.set(k, p)
  }
  return cache.get(k)!
}

export default function Photos({ entry, paths, showDriveLinks }: { entry: Entry; paths: string[]; showDriveLinks?: boolean }) {
  const [urls, setUrls] = useState<(string | null)[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const key = paths.join('|') + (entry.driveFiles?.length ?? 0)
  useEffect(() => {
    let alive = true
    setUrls(paths.map(() => null))
    paths.forEach((p, i) =>
      load(entry.id, p)
        .then((u) => alive && setUrls((x) => Object.assign([...x], { [i]: u })))
        .catch(() => alive && setUrls((x) => Object.assign([...x], { [i]: '' }))),
    )
    return () => { alive = false }
  }, [entry.id, key])
  return (
    <>
      <div className="thumbs">
        {paths.map((p, i) => {
          const drive = entry.driveFiles?.find((f) => f.path === p)
          return (
            <div key={p} className="thumb-wrap">
              <div className="thumb" onClick={() => urls[i] && setOpen(urls[i])}>
                {urls[i] ? <img src={urls[i]!} alt={`photo ${i + 1}`} /> : <span className="muted small">{urls[i] === '' ? 'Not available' : 'Loading…'}</span>}
              </div>
              {showDriveLinks && drive && <a className="small link" href={drive.link} target="_blank" rel="noreferrer">Open in Drive</a>}
            </div>
          )
        })}
      </div>
      {open && (
        <div className="lightbox" onClick={() => setOpen(null)}>
          <img src={open} alt="" />
        </div>
      )}
    </>
  )
}
