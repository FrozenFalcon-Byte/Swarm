import { LayoutGroup, animate, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useToast } from '../../components/Island'
import { Reveal, SplitWords } from '../../components/Reveal'
import { Roll } from '../../components/Roll'
import { SmoothScroll } from '../../components/SmoothScroll'
import { easeOut } from '../../lib/motion'
import { Footer, Nav } from '../landing/Landing'
import '../landing/landing.css'
import './site.css'

/* What tests that fail at random cost a team: every one is a rerun, a context switch and often an
   investigation into a bug that isn't there. Plain arithmetic, shown working, and kept in the link. */

type Key = 'eng' | 'runs' | 'rate' | 'mins' | 'wage' | 'fixed'
const FIELDS: { key: Key; label: string; hint: string; min: number; max: number; step: number; fmt: (v: number) => string; color: string }[] = [
  { key: 'eng', label: 'Engineers', hint: 'People who push code and wait on CI', min: 1, max: 300, step: 1, fmt: (v) => `${v}`, color: 'var(--coder)' },
  { key: 'runs', label: 'CI runs each, per day', hint: 'Pushes, pull requests, merges', min: 1, max: 30, step: 1, fmt: (v) => `${v}`, color: 'var(--triager)' },
  { key: 'rate', label: 'Runs that fail at random', hint: 'Red for no reason, green on a rerun', min: 0.5, max: 30, step: 0.5, fmt: (v) => `${v}%`, color: 'var(--tester)' },
  { key: 'mins', label: 'Minutes lost per failure', hint: 'Rerun, wait, look, lose your place', min: 5, max: 120, step: 5, fmt: (v) => `${v} min`, color: 'var(--lab)' },
  { key: 'wage', label: 'Cost of an engineer-hour', hint: 'Salary plus overheads', min: 20, max: 250, step: 5, fmt: (v) => `$${v}`, color: 'var(--reviewer)' },
]
const PRESETS: { label: string; v: Record<Key, number> }[] = [
  { label: 'Small team', v: { eng: 6, runs: 4, rate: 5, mins: 20, wage: 70, fixed: 80 } },
  { label: 'Growing startup', v: { eng: 25, runs: 6, rate: 8, mins: 25, wage: 90, fixed: 80 } },
  { label: 'Large org', v: { eng: 150, runs: 5, rate: 4, mins: 30, wage: 110, fixed: 80 } },
]
const DAYS = 21 // working days a month
const CELLS = 200 // each square is half a percent of the team's month

export default function Cost() {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [v, setV] = useState<Record<Key, number>>(() => {
    const base = { ...PRESETS[1].v }
    for (const k of Object.keys(base) as Key[]) { const n = Number(params.get(k)); if (params.has(k) && Number.isFinite(n)) base[k] = n }
    return base
  })
  // the numbers live in the address, so the page can be shared exactly as you set it
  useEffect(() => {
    const id = window.setTimeout(() => setParams(Object.fromEntries(Object.entries(v).map(([k, n]) => [k, String(n)])), { replace: true }), 250)
    return () => window.clearTimeout(id)
  }, [v, setParams])

  const failures = v.eng * v.runs * DAYS * (v.rate / 100)
  const hours = (failures * v.mins) / 60
  const cost = hours * v.wage
  const share = hours / (v.eng * 8 * DAYS)
  const saved = cost * (v.fixed / 100)
  const lostCells = Math.min(CELLS, Math.round(share * CELLS))
  const savedCells = Math.round(lostCells * (v.fixed / 100))
  const preset = PRESETS.find((p) => (Object.keys(p.v) as Key[]).every((k) => p.v[k] === v[k]))?.label

  const copy = async (what: 'link' | 'text') => {
    const text = what === 'link' ? window.location.href
      : `Tests that fail at random cost us about ${money(cost)} a month: ${Math.round(hours)} engineer-hours, ${Math.round(failures)} red runs. ` +
        `Fixing ${v.fixed}% of them would save ${money(saved * 12)} a year. (${window.location.href})`
    try { await navigator.clipboard.writeText(text); toast.ok(what === 'link' ? 'Link copied' : 'Summary copied', what === 'link' ? 'It opens with these exact numbers.' : 'Paste it wherever the budget gets decided.') }
    catch { toast.info('Couldn’t copy', 'Your browser blocked the clipboard.') }
  }

  return (
    <div className="landing site">
      <SmoothScroll />
      <Nav />
      <header className="site-hero">
        <p className="surtitle"><span style={{ background: 'var(--tester)' }} />Cost calculator</p>
        <SplitWords as="h1" text="What is rerunning CI costing you?" className="site-title" />
        <motion.p className="site-lede" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.8, ease: easeOut }}>
          Every test that fails at random is a rerun, a wait and a broken train of thought, and sometimes an afternoon chasing a bug that isn’t there. Set your numbers; the page does the arithmetic and shows its working.
        </motion.p>
      </header>

      <section className="cost-wrap">
        <motion.div className="cost-inputs" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45, duration: 0.9, ease: easeOut }}>
          <div className="pg-samples cost-presets">
            <span>Start from:</span>
            <LayoutGroup id="cost-presets">
              {PRESETS.map((p) => (
                <button key={p.label} className={`pg-sample ${preset === p.label ? 'on' : ''}`} onClick={() => setV({ ...p.v })}>
                  {preset === p.label && <motion.span layoutId="cost-preset-on" className="pg-sample-on" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                  <span>{p.label}</span>
                </button>
              ))}
            </LayoutGroup>
          </div>
          {FIELDS.map((f) => (
            <Slider key={f.key} keyName={f.key} label={f.label} hint={f.hint} min={f.min} max={f.max} step={f.step} fmt={f.fmt} color={f.color} value={v[f.key]} onChange={(n) => setV((o) => ({ ...o, [f.key]: n }))} />
          ))}
        </motion.div>

        <motion.div className="cost-out" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6, duration: 0.9, ease: easeOut }}>
          <div className="cost-hero">
            <span className="pg-k">Lost every month</span>
            <b className="cost-big"><Num value={cost} fmt={money} /><small>/ month</small></b>
            <p>That’s <b><Num value={cost * 12} fmt={money} /></b> a year, or about <b><Num value={share * 100} fmt={(n) => `${n.toFixed(1)}%`} /></b> of your team’s working time spent on runs that were never really broken.</p>
          </div>
          <div className="cost-stats">
            <div className="cost-stat"><b><Num value={failures} fmt={(n) => Math.round(n).toLocaleString()} /></b><span>red runs a month for no reason</span></div>
            <div className="cost-stat"><b><Num value={hours} fmt={(n) => Math.round(n).toLocaleString()} /></b><span>engineer-hours a month</span></div>
            <div className="cost-stat"><b><Num value={hours / 8} fmt={(n) => n.toFixed(1)} /></b><span>working days, every month</span></div>
          </div>
          <div className="cost-grid-card">
            <div className="cost-grid-head"><b>Your team’s month</b><span className="pg-k">each square = 0.5% of it</span></div>
            <div className="cost-grid" aria-hidden="true">
              {Array.from({ length: CELLS }, (_, k) => (
                <i key={k} className={k < savedCells ? 'saved' : k < lostCells ? 'lost' : ''} style={{ transitionDelay: `${Math.min(k, 60) * 6}ms` }} />
              ))}
            </div>
            <div className="cost-legend">
              <span><i style={{ background: 'var(--green)' }} />won back if {v.fixed}% are fixed</span>
              <span><i style={{ background: 'var(--tester)' }} />still lost</span>
              <span><i style={{ background: 'var(--white)' }} />real work</span>
            </div>
          </div>
          <div className="cost-save">
            <div className="cost-save-top">
              <div><span className="pg-k">If the agents fix {v.fixed}% of them</span></div>
              <b><Num value={saved * 12} fmt={money} /> <small style={{ fontSize: 16, color: 'var(--ink-2)' }}>a year</small></b>
            </div>
            <Slider keyName="fixed" label="Share of random failures fixed" hint="Some causes need a person; not every one is mechanical" min={0} max={100} step={5}
              fmt={(n) => `${n}%`} color="var(--green)" value={v.fixed} onChange={(n) => setV((o) => ({ ...o, fixed: n }))} />
          </div>
          <div className="cost-actions">
            <button className="btn btn-dark" onClick={() => copy('text')}><Roll>Copy a summary</Roll></button>
            <button className="btn btn-line" onClick={() => copy('link')}><Roll>Copy link</Roll></button>
          </div>
        </motion.div>
      </section>

      <section className="cost-how">
        <SplitWords text="How it’s counted" className="title-2" />
        <ol>
          {[
            <>Red runs a month: <code>engineers × runs a day × {DAYS} days × failure rate</code> = <b>{Math.round(failures).toLocaleString()}</b>.</>,
            <>Hours lost: <code>red runs × minutes each ÷ 60</code> = <b>{Math.round(hours).toLocaleString()}</b>. The minutes cover the rerun, the wait and getting back into the work.</>,
            <>Cost: <code>hours × cost per hour</code> = <b>{money(cost)}</b> a month.</>,
            <>It leaves out the slower one: real bugs that get ignored because “it’s probably just that test again”.</>,
          ].map((li, k) => <Reveal as="li" key={k} delay={k * 0.06}><span>{li}</span></Reveal>)}
        </ol>
      </section>

      <section className="site-band">
        <div className="site-band-inner">
          <SplitWords text="Find out which tests are the expensive ones." className="title-2" />
          <div className="site-cta">
            <Link to="/signup" className="btn btn-green btn-xl"><Roll>Connect a repository</Roll></Link>
            <Link to="/playground" className="btn btn-line btn-xl"><Roll>Try the playground</Roll></Link>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  )
}

function money(n: number) {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`
  if (n >= 1e4) return `$${Math.round(n / 1e3)}k`
  return `$${Math.round(n).toLocaleString()}`
}

/** A number that glides to its new value instead of jumping. */
function Num({ value, fmt }: { value: number; fmt: (n: number) => string }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const c = animate(from.current, value, { duration: 0.6, ease: easeOut, onUpdate: (n) => { from.current = n; setShown(n) } })
    return () => c.stop()
  }, [value])
  return <span>{fmt(shown)}</span>
}

function Slider({ keyName, label, hint, min, max, step, fmt, color, value, onChange }: {
  keyName?: string; label: string; hint: string; min: number; max: number; step: number; fmt: (v: number) => string; color: string; value: number; onChange: (n: number) => void
}) {
  const id = `cost-${keyName ?? label.replace(/\W+/g, '-').toLowerCase()}`
  const p = ((value - min) / (max - min)) * 100
  return (
    <div className="cost-field">
      <div className="cost-field-top">
        <label htmlFor={id}>{label}<small>{hint}</small></label>
        <motion.span key={value} className="cost-val" initial={{ y: -6, opacity: 0.4 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.25 }}>{fmt(value)}</motion.span>
      </div>
      <input id={id} className="cost-range" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        style={{ ['--p' as string]: `${p}%`, ['--c' as string]: color }} />
    </div>
  )
}
