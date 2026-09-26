import { AnimatePresence, LayoutGroup, animate, motion } from 'motion/react'
import { forwardRef, useDeferredValue, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../../components/Island'
import { Reveal, SplitWords } from '../../components/Reveal'
import { Roll } from '../../components/Roll'
import { SmoothScroll } from '../../components/SmoothScroll'
import { CAUSES, SAMPLES, applyFixes, hashText, scan, seeded, type Finding } from '../../lib/flakescan'
import { easeOut } from '../../lib/motion'
import { Footer, Nav } from '../landing/Landing'
import '../landing/landing.css'
import './site.css'

/* The playground: paste a test and see, line by line, what makes it pass on one run and fail on the
   next. Run it twelve times (simulated from the causes found), let the fixes write themselves, and run
   it again. The code lives in the link, so a result can be shared as-is. */

type RunCell = 'idle' | 'wait' | 'pass' | 'fail'
const RUNS = 12

function readShared(): string | null {
  const m = window.location.hash.match(/^#c=(.+)$/)
  if (!m) return null
  try { return decodeURIComponent(escape(atob(m[1]))) } catch { return null }
}

export default function Playground() {
  const toast = useToast()
  const [sample, setSample] = useState(() => (readShared() ? '' : SAMPLES[0].id))
  const [code, setCode] = useState(() => readShared() ?? SAMPLES[0].code)
  const deferred = useDeferredValue(code)
  const result = useMemo(() => scan(deferred), [deferred])
  const [focus, setFocus] = useState<number | null>(null)
  const [changed, setChanged] = useState<number[]>([])
  const [runs, setRuns] = useState<RunCell[]>(() => Array(RUNS).fill('idle'))
  const [running, setRunning] = useState(false)
  const [lastRun, setLastRun] = useState<{ fails: number; clean: boolean } | null>(null)
  const round = useRef(0)
  const editor = useRef<EditorHandle>(null)

  // anything you type makes the last run stale
  useEffect(() => { setLastRun(null); setRuns(Array(RUNS).fill('idle')) }, [deferred])

  const pick = (id: string) => {
    const s = SAMPLES.find((x) => x.id === id)!
    setSample(id); setCode(s.code); setChanged([]); setFocus(null)
    history.replaceState(null, '', window.location.pathname)
  }

  const run = async () => {
    if (running) return
    setRunning(true)
    const r = seeded(hashText(code) + ++round.current * 7919)
    const outcome = Array.from({ length: RUNS }, () => (r() < result.risk ? 'fail' : 'pass') as RunCell)
    setRuns(Array(RUNS).fill('wait'))
    for (let k = 0; k < RUNS; k++) {
      await new Promise((res) => setTimeout(res, 120))
      setRuns((prev) => prev.map((c, i) => (i === k ? outcome[k] : c)))
    }
    setLastRun({ fails: outcome.filter((c) => c === 'fail').length, clean: result.findings.length === 0 })
    setRunning(false)
  }

  const fix = () => {
    const f = applyFixes(code, result)
    setCode(f.code); setChanged(f.changed); setSample(''); setFocus(null)
    toast.ok(`${result.fixable} ${result.fixable === 1 ? 'fix' : 'fixes'} applied`, 'Changed lines are marked green. Run it again.')
    window.setTimeout(() => setChanged([]), 4200)
  }

  const share = async () => {
    const url = `${window.location.origin}/playground#c=${btoa(unescape(encodeURIComponent(code)))}`
    history.replaceState(null, '', url)
    try { await navigator.clipboard.writeText(url); toast.ok('Link copied', 'Anyone with it sees this exact test.') }
    catch { toast.info('Link is in the address bar', 'Copy it from there to share.') }
  }

  const needsPerson = result.findings.filter((f) => f.fix === undefined)

  return (
    <div className="landing site">
      <SmoothScroll />
      <Nav />
      <header className="site-hero">
        <p className="surtitle"><span style={{ background: 'var(--triager)' }} />Playground</p>
        <SplitWords as="h1" text="Why does this test fail at random?" className="site-title" />
        <motion.p className="site-lede" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.8, ease: easeOut }}>
          Paste a Python test. The playground points at the lines that make it pass one run and fail the next, runs it twelve times, and writes the fixes it can.
          It runs entirely in your browser; nothing is sent anywhere.
        </motion.p>
        <motion.div className="pg-samples" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.8, ease: easeOut }}>
          <span>Try:</span>
          <LayoutGroup id="pg-samples">
            {SAMPLES.map((s) => (
              <button key={s.id} className={`pg-sample ${sample === s.id ? 'on' : ''}`} onClick={() => pick(s.id)}>
                {sample === s.id && <motion.span layoutId="pg-sample-on" className="pg-sample-on" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                <span>{s.label}</span>
              </button>
            ))}
          </LayoutGroup>
        </motion.div>
      </header>

      <section className="pg-bench">
        <motion.div className="pg-editor-card" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45, duration: 0.9, ease: easeOut }}>
          <div className="pg-chrome">
            <span className="pg-lights" aria-hidden="true"><i /><i /><i /></span>
            <b className="mono">test_example.py</b>
            <span className="pg-chrome-actions">
              <button className="pg-ghost" onClick={share}>Share</button>
              <button className="pg-ghost" onClick={() => { setCode(''); setSample(''); editor.current?.focus() }}>Clear</button>
            </span>
          </div>
          <Editor ref={editor} code={code} onChange={(v) => { setCode(v); setSample('') }} findings={result.findings} focus={focus} changed={changed} />
        </motion.div>

        <motion.aside className="pg-report" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6, duration: 0.9, ease: easeOut }}>
          <div className="pg-risk">
            <Gauge value={result.risk} />
            <div>
              <span className="pg-k">Chance a run fails</span>
              <p>{result.findings.length === 0 ? 'Nothing here makes the outcome change between runs.'
                : `${result.findings.length} ${result.findings.length === 1 ? 'cause' : 'causes'} found. ${result.fixable ? `${result.fixable} can be fixed for you.` : 'None can be fixed mechanically.'}`}</p>
            </div>
          </div>

          <ul className="pg-findings">
            <AnimatePresence initial={false}>
              {result.findings.map((f) => (
                <motion.li key={`${f.line}-${f.cause}`} layout initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -18 }} transition={{ duration: 0.4, ease: easeOut }}>
                  <button className={`pg-finding ${focus === f.line ? 'on' : ''}`} style={{ ['--c' as string]: CAUSES[f.cause].color }}
                    onMouseEnter={() => setFocus(f.line)} onMouseLeave={() => setFocus(null)} onClick={() => editor.current?.reveal(f.line)}>
                    <span className="pg-line mono">L{f.line + 1}</span>
                    <span className="pg-finding-text"><b>{CAUSES[f.cause].label}</b><span>{f.text}</span></span>
                    <span className={`pg-tag ${f.fix === undefined ? 'human' : ''}`}>{f.fix === undefined ? 'needs you' : f.fix === '' ? 'remove' : 'auto-fix'}</span>
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
            {result.findings.length === 0 && (
              <motion.li className="pg-clean" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
                <span className="pg-clean-dots" aria-hidden="true">{['triager', 'coder', 'tester', 'reviewer'].map((a, i) => <motion.i key={a} style={{ background: `var(--${a})` }} animate={{ y: [0, -6, 0] }} transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.15 }} />)}</span>
                No known causes. If it still fails at random, the cause is somewhere this can’t see, which is where the full swarm comes in.
              </motion.li>
            )}
          </ul>

          <div className="pg-runs">
            <div className="pg-runs-head">
              <span className="pg-k">12 runs <em>simulated from the causes above</em></span>
              <AnimatePresence mode="wait">
                {lastRun && (
                  <motion.b key={`${lastRun.fails}-${round.current}`} className={lastRun.fails ? 'bad' : 'good'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                    {lastRun.fails ? `${lastRun.fails} of 12 failed` : '12 of 12 passed'}
                  </motion.b>
                )}
              </AnimatePresence>
            </div>
            <div className="pg-cells" aria-live="polite">
              {runs.map((c, k) => <i key={k} className={`pg-cell pg-cell--${c}`} />)}
            </div>
          </div>

          <div className="pg-actions">
            <button className="btn btn-dark" onClick={run} disabled={running}><Roll>{running ? 'Running…' : lastRun ? 'Run again' : 'Run 12 times'}</Roll></button>
            <AnimatePresence>
              {result.fixable > 0 && (
                <motion.button className="btn btn-green" onClick={fix} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.3, ease: easeOut }}>
                  <Roll>{`Apply ${result.fixable} ${result.fixable === 1 ? 'fix' : 'fixes'}`}</Roll>
                </motion.button>
              )}
            </AnimatePresence>
          </div>
          {needsPerson.length > 0 && result.fixable === 0 && (
            <p className="pg-note">What’s left needs a decision, like where shared state should live. On the board, Swarm would mark this <b>Needs you</b> rather than guess.</p>
          )}
        </motion.aside>
      </section>

      <section className="site-band">
        <div className="site-band-inner">
          <SplitWords text="The playground reads one file. The swarm runs your suite." className="title-2" />
          <div className="site-trio">
            {[
              { c: 'var(--triager)', t: 'Reads the issue too', d: 'The triager matches the failure in the issue to a cause, and folds duplicates into the first report.' },
              { c: 'var(--tester)', t: 'Proves it, for real', d: 'The tester runs the test many times before and after the patch in a sandbox, under different hash seeds.' },
              { c: 'var(--reviewer)', t: 'Rejects lazy fixes', d: 'Retries, skips and sleeps are sent back. You only see patches that remove the cause.' },
            ].map((x, k) => (
              <Reveal key={x.t} delay={k * 0.08} className="site-tri">
                <span className="site-tri-dot" style={{ background: x.c }} />
                <b>{x.t}</b>
                <p>{x.d}</p>
              </Reveal>
            ))}
          </div>
          <div className="site-cta">
            <Link to="/signup" className="btn btn-green btn-xl"><Roll>Run it on your repo</Roll></Link>
            <Link to="/cost" className="btn btn-line btn-xl"><Roll>What is this costing us?</Roll></Link>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  )
}

/* ---------------------------------------------------------------- the editor */

interface EditorHandle { focus(): void; reveal(line: number): void }
const LH = 24 // px per line, shared with the CSS


const Editor = forwardRef<EditorHandle, { code: string; onChange: (v: string) => void; findings: Finding[]; focus: number | null; changed: number[] }>(
  function Editor({ code, onChange, findings, focus, changed }, ref) {
    const area = useRef<HTMLTextAreaElement>(null)
    const back = useRef<HTMLDivElement>(null)
    const [pulse, setPulse] = useState<number | null>(null)
    useImperativeHandle(ref, () => ({
      focus: () => area.current?.focus(),
      reveal: (line) => {
        const a = area.current
        if (!a) return
        a.scrollTo({ top: Math.max(0, line * LH - a.clientHeight / 2), behavior: 'smooth' })
        setPulse(line); window.setTimeout(() => setPulse(null), 1200)
      },
    }))
    const lines = code.split('\n')
    const byLine = new Map(findings.map((f) => [f.line, f]))
    const fresh = new Set(changed)
    const sync = () => { if (back.current && area.current) back.current.style.transform = `translate(${-area.current.scrollLeft}px, ${-area.current.scrollTop}px)` }
    const key = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== 'Tab') return
      e.preventDefault()
      const t = e.currentTarget, s = t.selectionStart
      onChange(code.slice(0, s) + '    ' + code.slice(t.selectionEnd))
      requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 4 })
    }
    return (
      <div className="pg-editor" style={{ ['--lh' as string]: `${LH}px` }}>
        <div className="pg-editor-back" aria-hidden="true" ref={back}>
          {lines.map((l, i) => {
            const f = byLine.get(i)
            return (
              <div key={i} className={`pg-row ${f ? 'hit' : ''} ${focus === i || pulse === i ? 'focus' : ''} ${fresh.has(i) ? 'fresh' : ''}`}
                style={f ? { ['--c' as string]: CAUSES[f.cause].color } : undefined}>
                <span className="pg-no">{i + 1}</span>
                <span className="pg-src">{l || ' '}</span>
              </div>
            )
          })}
        </div>
        <textarea ref={area} className="pg-area" value={code} spellCheck={false} autoCapitalize="off" autoComplete="off" wrap="off"
          aria-label="Test code" onChange={(e) => onChange(e.target.value)} onScroll={sync} onKeyDown={key} placeholder="Paste a pytest test here…" />
      </div>
    )
  })

function Gauge({ value }: { value: number }) {
  const [shown, setShown] = useState(0)
  const last = useRef(0)
  useEffect(() => {
    const c = animate(last.current, value, { duration: 0.9, ease: easeOut, onUpdate: setShown })
    last.current = value
    return () => c.stop()
  }, [value])
  const pct = Math.round(shown * 100)
  const tone = value >= 0.4 ? 'var(--tester)' : value > 0 ? 'var(--triager)' : 'var(--reviewer)'
  return (
    <div className="pg-gauge" aria-label={`${Math.round(value * 100)} percent`}>
      <svg viewBox="0 0 120 120" width="120" height="120">
        <circle cx="60" cy="60" r="50" fill="none" stroke="var(--grey-6)" strokeWidth="12" />
        <motion.circle cx="60" cy="60" r="50" fill="none" stroke={tone} strokeWidth="12" strokeLinecap="round" transform="rotate(-90 60 60)"
          style={{ pathLength: shown }} animate={{ stroke: tone }} transition={{ duration: 0.5 }} />
        <circle cx="60" cy="60" r="50" fill="none" stroke="var(--ink)" strokeWidth="2" opacity="0.08" />
      </svg>
      <b className="tabnum">{pct}<small>%</small></b>
    </div>
  )
}
