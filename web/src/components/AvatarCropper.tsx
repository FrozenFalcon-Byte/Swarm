import { AnimatePresence, motion, useMotionValue, animate } from 'motion/react'
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { easeOut } from '../lib/motion'
import { Roll } from './Roll'

const STAGE = 300 // the crop circle's diameter on screen
const OUT = 512 // the saved picture, square
const MAX_BYTES = 280_000 // stays well inside Firestore's per-document limit

/** Pick, position and crop a profile picture. Resolves with a WebP data URL. */
export function AvatarCropper({ file, onCancel, onSave }: { file: File | null; onCancel: () => void; onSave: (dataUrl: string) => Promise<void> }) {
  // rendered at the end of <body>: inside the animated page, a transformed parent would pin the dialog to the page
  return createPortal(
    <AnimatePresence>
      {file && <CropDialog key={file.name + file.size + file.lastModified} file={file} onCancel={onCancel} onSave={onSave} />}
    </AnimatePresence>,
    document.body,
  )
}

function CropDialog({ file, onCancel, onSave }: { file: File; onCancel: () => void; onSave: (dataUrl: string) => Promise<void> }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [url, setUrl] = useState('')
  const [zoom, setZoom] = useState(1)
  const [turn, setTurn] = useState(0) // quarter turns
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number } | null>(null)
  const pinch = useRef(new Map<number, { x: number; y: number }>())
  const pinchStart = useRef<{ d: number; z: number } | null>(null)

  useEffect(() => {
    let live = true
    const u = URL.createObjectURL(file)
    const im = new Image()
    im.decoding = 'async'
    // only this run's image counts: a cleaned-up run revokes its URL, which makes its image fail to load
    im.onload = () => { if (live) { setError(''); setImg(im) } }
    im.onerror = () => { if (live) setError('That file isn’t an image this browser can read. Try a JPEG, PNG or WebP.') }
    im.src = u
    setUrl(u)
    return () => { live = false; URL.revokeObjectURL(u) }
  }, [file])

  // the image's size on screen: it always covers the circle, then zoom scales it further
  const rotated = turn % 2 === 1
  const w = img ? (rotated ? img.naturalHeight : img.naturalWidth) : 1
  const h = img ? (rotated ? img.naturalWidth : img.naturalHeight) : 1
  const base = Math.max(STAGE / w, STAGE / h)
  const scale = base * zoom
  const limits = useCallback((z: number) => ({ x: Math.max(0, (w * base * z - STAGE) / 2), y: Math.max(0, (h * base * z - STAGE) / 2) }), [w, h, base])
  const clamp = useCallback((z: number, spring = false) => {
    const l = limits(z)
    const nx = Math.min(l.x, Math.max(-l.x, x.get())), ny = Math.min(l.y, Math.max(-l.y, y.get()))
    if (spring) { animate(x, nx, { type: 'spring', stiffness: 380, damping: 32 }); animate(y, ny, { type: 'spring', stiffness: 380, damping: 32 }) }
    else { x.set(nx); y.set(ny) }
  }, [limits, x, y])
  useEffect(() => { clamp(zoom, true) }, [zoom, turn, clamp])

  const setZoomClamped = (z: number) => setZoom(Math.min(4, Math.max(1, z)))

  const down = (e: RPointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId)
    pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current.size === 2) {
      const [a, b] = [...pinch.current.values()]
      pinchStart.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom }
      drag.current = null
    } else {
      drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: x.get(), oy: y.get() }
    }
  }
  const move = (e: RPointerEvent) => {
    if (pinch.current.has(e.pointerId)) pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pinch.current.values()]
      setZoomClamped(pinchStart.current.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinchStart.current.d))
      return
    }
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    // a little rubber band past the edges, springing back on release
    const l = limits(zoom)
    const band = (v: number, m: number) => (v > m ? m + (v - m) * 0.3 : v < -m ? -m + (v + m) * 0.3 : v)
    x.set(band(d.ox + e.clientX - d.sx, l.x))
    y.set(band(d.oy + e.clientY - d.sy, l.y))
  }
  const up = (e: RPointerEvent) => {
    pinch.current.delete(e.pointerId)
    if (pinch.current.size < 2) pinchStart.current = null
    drag.current = null
    clamp(zoom, true)
  }

  const save = async () => {
    if (!img) return
    setBusy(true); setError('')
    try {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = OUT
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingQuality = 'high'
      // map the circle back into the (rotated) image: draw the image around the canvas centre
      const k = OUT / STAGE
      ctx.translate(OUT / 2 + x.get() * k, OUT / 2 + y.get() * k)
      ctx.rotate((turn * Math.PI) / 2)
      const s = scale * k
      ctx.drawImage(img, (-img.naturalWidth * s) / 2, (-img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s)
      let quality = 0.86, data = canvas.toDataURL('image/webp', quality)
      if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/jpeg', quality) // Safari without WebP encoding
      while (data.length > MAX_BYTES && quality > 0.4) { quality -= 0.12; data = canvas.toDataURL(data.startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg', quality) }
      await onSave(data)
    } catch (e) {
      setError((e as Error).message || 'Couldn’t save the picture.')
      setBusy(false)
    }
  }

  return (
    <motion.div className="modal" role="dialog" aria-label="Crop your picture" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="scrim" onClick={busy ? undefined : onCancel} />
      <motion.div className="crop" initial={{ y: 40, scale: 0.94, opacity: 0, filter: 'blur(10px)' }} animate={{ y: 0, scale: 1, opacity: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }} exit={{ y: 24, scale: 0.97, opacity: 0, filter: 'blur(6px)' }}
        transition={{ type: 'spring', stiffness: 260, damping: 26, filter: { duration: 0.35, ease: 'easeOut' } }}>
        <header className="crop-head"><h3>Position your picture</h3><p>Drag to move. Pinch, scroll or use the slider to zoom.</p></header>
        <div className="crop-stage" style={{ width: STAGE, height: STAGE }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          onWheel={(e) => setZoomClamped(zoom * (e.deltaY > 0 ? 0.94 : 1.06))}>
          {url && img && (
            <motion.img src={url} alt="" draggable={false} className="crop-img"
              style={{ x, y, width: img.naturalWidth * scale, height: img.naturalHeight * scale, marginLeft: (-img.naturalWidth * scale) / 2, marginTop: (-img.naturalHeight * scale) / 2 }}
              animate={{ rotate: turn * 90 }} transition={{ duration: 0.5, ease: easeOut }} />
          )}
          <span className="crop-ring" aria-hidden="true" />
          {!img && !error && <span className="crop-loading">Loading…</span>}
        </div>
        <div className="crop-controls">
          <span className="crop-z" aria-hidden="true">−</span>
          <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" />
          <span className="crop-z" aria-hidden="true">+</span>
          <button type="button" className="icon-btn" data-nudge="spin" onClick={() => setTurn((t) => (t + 1) % 4)} aria-label="Rotate" title="Rotate">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5" /></svg>
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
        <footer className="crop-foot">
          <button type="button" className="btn btn-line" onClick={onCancel} disabled={busy}><Roll>Cancel</Roll></button>
          <button type="button" className="btn btn-dark" onClick={save} disabled={busy || !img}><Roll>{busy ? 'Saving…' : 'Save picture'}</Roll></button>
        </footer>
      </motion.div>
    </motion.div>
  )
}
