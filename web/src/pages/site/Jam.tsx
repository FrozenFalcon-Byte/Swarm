import { AnimatePresence, LayoutGroup, motion, useAnimationControls } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '../../components/Island'
import { SplitWords } from '../../components/Reveal'
import { SmoothScroll } from '../../components/SmoothScroll'
import { easeOut } from '../../lib/motion'
import { Footer, Nav } from '../landing/Landing'
import '../landing/landing.css'
import './site.css'
import './jam.css'

/* The Jam: the agents are a band. Tap the grid to write a sixteen-step loop, press play and each one plays its
   part, bouncing on its own notes. Bass and bells climb in pitch with each tap; tap a player to mute them. All
   the sound is made in the browser with Web Audio, and Share puts the whole beat in the link. */

const STEPS = 16
type Row = { id: string; who: string; sound: string; say: string; c: string; pitched?: boolean }
const ROWS: Row[] = [
  { id: 'kick', who: 'Triager', sound: 'Kick', say: 'boom', c: 'var(--triager)' },
  { id: 'clap', who: 'Coder', sound: 'Clap', say: 'clap', c: 'var(--coder)' },
  { id: 'hat', who: 'Tester', sound: 'Hi-hat', say: 'tss', c: 'var(--tester)' },
  { id: 'bass', who: 'Reviewer', sound: 'Bass', say: 'bwom', c: 'var(--reviewer)', pitched: true },
  { id: 'bell', who: 'Lab', sound: 'Bells', say: 'ding', c: 'var(--lab)', pitched: true },
]
type Grid = number[][] // [row][step]: 0 off, 1 on (drums) or 1–4 pitch (bass, bells)
const g = (...rows: string[]): Grid => rows.map((r) => [...r].map(Number))
const PRESETS: { id: string; label: string; bpm: number; swing: boolean; grid: Grid }[] = [
  { id: 'floor', label: 'Four on the floor', bpm: 120, swing: false, grid: g('1000100010001000', '0000100000001000', '0010001000100010', '1000003000200010', '0030000400020000') },
  { id: 'bap', label: 'Boom bap', bpm: 88, swing: true, grid: g('1000000010100000', '0000100000001000', '1010101010101010', '1000000030200000', '0000000000040300') },
  { id: 'bossa', label: 'Bossa', bpm: 112, swing: false, grid: g('1001100110011001', '1001001000100100', '1111111111111111', '1000003010000030', '0200000030000400') },
  { id: 'lullaby', label: 'Lullaby', bpm: 76, swing: true, grid: g('1000000000000000', '0000000000000000', '0000100000001000', '1000000020000000', '4020301040203010') },
]
const EMPTY = (): Grid => ROWS.map(() => new Array(STEPS).fill(0))
const BASS = [65.41, 77.78, 87.31, 98.0] // C2, E♭2, F2, G2: C minor pentatonic, so any tap sounds right
const BELL = [523.25, 622.25, 783.99, 932.33] // C5, E♭5, G5, B♭5

/* ---------- sound */
function synth() {
  const ctx = new AudioContext()
  const out = ctx.createDynamicsCompressor()
  const master = ctx.createGain(); master.gain.value = 0.8
  master.connect(out); out.connect(ctx.destination)
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const env = (t: number, peak: number, len: number) => { const v = ctx.createGain(); v.gain.setValueAtTime(peak, t); v.gain.exponentialRampToValueAtTime(0.001, t + len); v.connect(master); return v }
  const hiss = (t: number, len: number, type: BiquadFilterType, f: number, peak: number) => {
    const s = ctx.createBufferSource(); s.buffer = noise
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f
    s.connect(fl); fl.connect(env(t, peak, len)); s.start(t); s.stop(t + len)
  }
  const play = (row: string, v: number, t: number, accent: boolean) => {
    if (row === 'kick') {
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14)
      o.connect(env(t, 1, 0.4)); o.start(t); o.stop(t + 0.4)
    } else if (row === 'clap') {
      hiss(t, 0.2, 'bandpass', 1500, 0.9)
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 190; o.connect(env(t, 0.35, 0.09)); o.start(t); o.stop(t + 0.1)
    } else if (row === 'hat') {
      hiss(t, accent ? 0.07 : 0.045, 'highpass', 7200, accent ? 0.32 : 0.18)
    } else if (row === 'bass') {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = BASS[v - 1]
      const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = 7
      fl.frequency.setValueAtTime(1400, t); fl.frequency.exponentialRampToValueAtTime(220, t + 0.25)
      o.connect(fl); fl.connect(env(t, 0.42, 0.34)); o.start(t); o.stop(t + 0.36)
    } else {
      const f = BELL[v - 1]
      for (const [m, a] of [[1, 0.22], [2.76, 0.06]] as const) {
        const o = ctx.createOscillator(); o.frequency.value = f * m; o.connect(env(t, a, 1.3)); o.start(t); o.stop(t + 1.3)
      }
    }
  }
  return { ctx, play }
}

/* ---------- the beat in a link */
const encode = (grid: Grid, bpm: number, swing: boolean) => `${grid.map((r) => r.join('')).join('-')}-${bpm}-${swing ? 1 : 0}`
function decode(s: string) {
  const p = s.split('-')
  if (p.length !== ROWS.length + 2 || !p.slice(0, ROWS.length).every((r) => /^[0-4]{16}$/.test(r))) return null
  const bpm = Math.min(160, Math.max(60, Number(p[ROWS.length]) || 110))
  return { grid: p.slice(0, ROWS.length).map((r, i) => [...r].map((c) => (ROWS[i].pitched ? Number(c) : Math.min(1, Number(c))))), bpm, swing: p[ROWS.length + 1] === '1' }
}
function surprise(): Grid {
  const r = (p: number) => Math.random() < p
  const grid = EMPTY()
  for (let s = 0; s < STEPS; s++) {
    grid[0][s] = s % 8 === 0 || (s % 2 === 0 && r(0.18)) ? 1 : 0
    grid[1][s] = s % 8 === 4 || r(0.06) ? 1 : 0
    grid[2][s] = s % 2 === 0 ? (r(0.85) ? 1 : 0) : r(0.3) ? 1 : 0
    grid[3][s] = s === 0 ? 1 : r(0.2) ? 1 + Math.floor(Math.random() * 4) : 0
    grid[4][s] = r(0.16) ? 1 + Math.floor(Math.random() * 4) : 0
  }
  return grid
}

export default function Jam() {
  const toast = useToast()
  const start = useState(() => (typeof window !== 'undefined' ? decode(window.location.hash.replace(/^#g=/, '')) : null))[0]
  const [grid, setGrid] = useState<Grid>(start?.grid ?? PRESETS[0].grid)
  const [bpm, setBpm] = useState(start?.bpm ?? PRESETS[0].bpm)
  const [swing, setSwing] = useState(start?.swing ?? PRESETS[0].swing)
  const [preset, setPreset] = useState(start ? '' : PRESETS[0].id)
  const [muted, setMuted] = useState<boolean[]>(() => ROWS.map(() => false))
  const [playing, setPlaying] = useState(false)
  const [step, setStep] = useState(-1)
  const [beat, setBeat] = useState(0) // counts every step played, so each hit is a new event

  // the scheduler reads these, so edits land on the very next step without restarting
  const live = useRef({ grid, bpm, swing, muted })
  useEffect(() => { live.current = { grid, bpm, swing, muted } }, [grid, bpm, swing, muted])
  const audio = useRef<ReturnType<typeof synth> | null>(null)
  const sound = () => {
    if (!audio.current) audio.current = synth()
    if (audio.current.ctx.state === 'suspended') void audio.current.ctx.resume()
    return audio.current
  }
  useEffect(() => () => { void audio.current?.ctx.close() }, [])

  useEffect(() => {
    if (!playing) return
    const a = sound()
    let next = a.ctx.currentTime + 0.06, n = 0, raf = 0
    const queue: { s: number; t: number }[] = []
    const tick = window.setInterval(() => {
      while (next < a.ctx.currentTime + 0.12) {
        const s = n % STEPS, { grid, bpm, swing, muted } = live.current
        ROWS.forEach((r, i) => { const v = grid[i][s]; if (v && !muted[i]) a.play(r.id, v, next, s % 4 === 0) })
        queue.push({ s, t: next })
        const sixteenth = 60 / bpm / 4
        next += swing ? sixteenth * (s % 2 === 0 ? 1.34 : 0.66) : sixteenth
        n++
      }
    }, 25)
    const draw = () => {
      let last: number | null = null
      while (queue.length && queue[0].t <= a.ctx.currentTime) last = queue.shift()!.s
      if (last !== null) { setStep(last); setBeat((b) => b + 1) }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => { window.clearInterval(tick); cancelAnimationFrame(raf) }
  }, [playing]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback(() => { setPlaying((p) => !p); setStep(-1) }, [])
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || (e.target as HTMLElement).closest('input, textarea, select, button, [contenteditable]')) return
      e.preventDefault(); toggle()
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [toggle])

  const tap = (i: number, s: number, clear = false) => {
    const r = ROWS[i], v = grid[i][s]
    const nv = clear ? 0 : r.pitched ? (v + 1) % 5 : v ? 0 : 1
    setGrid((gr) => gr.map((row, k) => (k === i ? row.map((x, j) => (j === s ? nv : x)) : row)))
    setPreset('')
    if (nv && !playing) { const a = sound(); a.play(r.id, nv, a.ctx.currentTime + 0.01, true) }
  }
  const load = (p: (typeof PRESETS)[number]) => { setGrid(p.grid); setBpm(p.bpm); setSwing(p.swing); setPreset(p.id) }
  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}#g=${encode(grid, bpm, swing)}`
    window.history.replaceState(null, '', url)
    try { await navigator.clipboard.writeText(url); toast.ok('Link copied', 'Whoever opens it hears exactly this beat.') }
    catch { toast.info('Couldn’t copy', 'The link is in the address bar now.') }
  }

  return (
    <div className="landing site jam-page">
      <SmoothScroll />
      <Nav />
      <header className="site-hero jam-hero">
        <p className="surtitle"><span style={{ background: 'var(--lab)' }} />The Jam</p>
        <SplitWords as="h1" text="Start the band." className="site-title" />
        <motion.p className="site-lede" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.8, ease: easeOut }}>
          The agents take a night off. Tap the grid to write a loop, hit play, and each one plays its part. Tap a player to let them rest.
        </motion.p>
      </header>

      <section className={`jam-stage ${playing ? 'is-playing' : ''}`} style={{ ['--beat' as string]: `${60 / bpm}s` }}>
        <motion.div className="jam-presets" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45, duration: 0.8, ease: easeOut }}>
          <span>Start from</span>
          <LayoutGroup id="jam-presets">
            {PRESETS.map((p) => (
              <button key={p.id} className={`pg-sample ${preset === p.id ? 'on' : ''}`} onClick={() => load(p)}>
                {preset === p.id && <motion.span layoutId="jam-preset-on" className="pg-sample-on" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                <span>{p.label}</span>
              </button>
            ))}
          </LayoutGroup>
        </motion.div>

        <div className="jam-band-wrap">
          <Band step={step} beat={beat} grid={grid} muted={muted} playing={playing}
            onTap={(i) => setMuted((m) => m.map((x, k) => (k === i ? !x : x)))} />
        </div>

        <motion.div className="jam-grid" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.8, ease: easeOut }}>
          {ROWS.map((r, i) => (
            <div key={r.id} className={`jam-row ${muted[i] ? 'is-muted' : ''}`} style={{ ['--c' as string]: r.c }}>
              <button className="jam-who" onClick={() => setMuted((m) => m.map((x, k) => (k === i ? !x : x)))} aria-pressed={!muted[i]} aria-label={`${muted[i] ? 'Unmute' : 'Mute'} ${r.who}`}>
                <i /><span><b>{r.who}</b><small>{muted[i] ? 'resting' : r.sound}</small></span>
              </button>
              <div className="jam-cells">
                {grid[i].map((v, s) => (
                  <button key={s} className={`jam-cell ${v ? 'on' : ''} ${s === step ? 'is-now' : ''} ${s === step && v && !muted[i] ? 'is-hit' : ''} ${s % 4 === 0 ? 'is-down' : ''}`}
                    style={{ ['--v' as string]: r.pitched ? v / 4 : v }} onClick={(e) => tap(i, s, e.shiftKey)} onContextMenu={(e) => { e.preventDefault(); tap(i, s, true) }}
                    aria-label={`${r.sound}, step ${s + 1}${v ? (r.pitched ? `, note ${v}` : ', on') : ''}`} aria-pressed={!!v}>
                    {r.pitched && v > 0 && <span className="jam-pitch" />}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </motion.div>

        <motion.div className="jam-dock" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.65, type: 'spring', stiffness: 120, damping: 18 }}>
          <motion.button className={`jam-play ${playing ? 'on' : ''}`} onClick={toggle} whileTap={{ scale: 0.9 }} aria-label={playing ? 'Stop' : 'Play'}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.svg key={playing ? 'stop' : 'play'} viewBox="0 0 24 24" initial={{ scale: 0.4, rotate: -90, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} exit={{ scale: 0.4, rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }}>
                {playing ? <rect x="6" y="6" width="12" height="12" rx="2.5" /> : <path d="M8 5.5v13l10.5-6.5z" />}
              </motion.svg>
            </AnimatePresence>
          </motion.button>

          <div className="jam-knobs">
            <label className="jam-tempo">
              <span><b className="mono">{bpm}</b> bpm</span>
              <input type="range" min={60} max={160} value={bpm} onChange={(e) => { setBpm(Number(e.target.value)); setPreset('') }} aria-label="Tempo" />
            </label>
            <button className={`jam-swing ${swing ? 'on' : ''}`} onClick={() => { setSwing((x) => !x); setPreset('') }} aria-pressed={swing}><i />Swing</button>
          </div>

          <div className="jam-acts">
            <motion.button className="jam-act" whileTap={{ rotate: 200, scale: 0.9 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }} onClick={() => { setGrid(surprise()); setPreset('') }}>Surprise me</motion.button>
            <button className="jam-act" onClick={() => { setGrid(EMPTY()); setPreset('') }}>Clear</button>
            <button className="jam-act jam-act--dark" onClick={share}>Share</button>
          </div>
        </motion.div>
      </section>
      <Footer />
    </div>
  )
}

/* ---------- the band on stage */
const SHAPE = [
  { w: 118, h: 124, r: 50 }, { w: 100, h: 150, r: 34 }, { w: 96, h: 116, r: 48 }, { w: 124, h: 140, r: 26 }, { w: 98, h: 128, r: 49 },
]
function Band({ step, beat, grid, muted, playing, onTap }: { step: number; beat: number; grid: Grid; muted: boolean[]; playing: boolean; onTap: (i: number) => void }) {
  const look = step < 0 ? 0 : (step / (STEPS - 1)) * 2 - 1 // pupils follow the playhead across the grid
  return (
    <svg className="jam-band" viewBox="30 18 940 206" role="img" aria-label="The band">
      <path className="jam-floor" d="M20 214H980" />
      {ROWS.map((r, i) => {
        const x = 110 + i * 195
        const hit = step >= 0 && !!grid[i][step] && !muted[i]
        return <Player key={r.id} row={r} shape={SHAPE[i]} x={x} hit={hit} beat={beat} muted={muted[i]} playing={playing} look={look} lead={i} onTap={() => onTap(i)} />
      })}
    </svg>
  )
}

function Player({ row, shape, x, hit, beat, muted, playing, look, lead, onTap }: {
  row: Row; shape: { w: number; h: number; r: number }; x: number; hit: boolean; beat: number; muted: boolean; playing: boolean; look: number; lead: number; onTap: () => void
}) {
  const body = useAnimationControls()
  useEffect(() => {
    if (hit) void body.start({ scaleY: [1, 0.8, 1.12, 1], scaleX: [1, 1.14, 0.94, 1], transition: { duration: 0.34, ease: 'easeOut' } })
  }, [hit, beat]) // eslint-disable-line react-hooks/exhaustive-deps
  const { w, h, r } = shape
  const d = `M${-w / 2} 0V${-h + r}Q${-w / 2} ${-h} ${-w / 2 + r} ${-h}H${w / 2 - r}Q${w / 2} ${-h} ${w / 2} ${-h + r}V0Z`
  const ey = -h + 44, px = look * 3.5
  return (
    <g transform={`translate(${x} 214)`} className={`jam-player ${muted ? 'is-muted' : ''} ${playing && !muted ? 'is-grooving' : ''}`} style={{ ['--lead' as string]: lead }}
      onClick={onTap} role="button" aria-label={`${muted ? 'Wake' : 'Rest'} ${row.who}`}>
      <ellipse className="jam-shadow" cx="0" cy="2" rx={w / 2 + 6} ry="7" />
      <g className="jam-sway">
        <motion.g animate={body} style={{ originX: 0.5, originY: 1 }}>
          <path d={d} fill={row.c} className="jam-body" />
          {muted ? (
            <g className="jam-eyes-shut"><path d={`M-26 ${ey}h16M10 ${ey}h16`} /></g>
          ) : (
            <g>
              <circle cx="-18" cy={ey} r="12" className="jam-eye" /><circle cx="18" cy={ey} r="12" className="jam-eye" />
              <circle cx={-18 + px} cy={ey + 1} r="5.5" className="jam-pupil" /><circle cx={18 + px} cy={ey + 1} r="5.5" className="jam-pupil" />
            </g>
          )}
          {hit ? <ellipse cx="0" cy={ey + 30} rx="11" ry="9" className="jam-mouth-open" />
            : <path d={`M-10 ${ey + 26}q10 ${muted ? 0 : 9} 20 0`} className="jam-mouth" />}
          <text y="-22" className="jam-name">{row.who}</text>
        </motion.g>
      </g>
      <AnimatePresence>
        {hit && (
          <motion.text key={beat} className="jam-say" initial={{ opacity: 0, y: -h - 6, scale: 0.6 }} animate={{ opacity: 1, y: -h - 30, scale: 1 }}
            exit={{ opacity: 0, y: -h - 50, transition: { duration: 0.5 } }} transition={{ duration: 0.25, ease: 'easeOut' }}>{row.say}</motion.text>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {muted && (
          <motion.text key="z" className="jam-z" x={w / 2 - 6} initial={{ opacity: 0, y: -h }} animate={{ opacity: 1, y: -h - 18 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>z z</motion.text>
        )}
      </AnimatePresence>
    </g>
  )
}
