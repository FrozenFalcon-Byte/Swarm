import { motion, useMotionValueEvent, useScroll } from 'motion/react'
import { useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useWinHeight } from '../../lib/winHeight'
import './relay.css'

/*
 * The Relay: one bug, handed from agent to agent until it ships.
 * Kept deliberately light: scrolling only decides which scene is showing, and every change between scenes is a short
 * CSS transition on transform and opacity (compositor-only), so it stays smooth on any machine.
 */

const ROLES = ['triager', 'coder', 'tester', 'reviewer'] as const
const TITLE_KEY = 'swarm:relay-title'
const DEFAULT_TITLE = 'The save button ignores the second click'

const SCENES = [
  { k: 'The bug', t: 'It starts with a dot.', s: 'Somewhere in your code, something small goes wrong.', c: 'var(--grey-6)' },
  { k: 'The issue', t: 'Someone opens an issue.', s: 'Now it has a name, a number, and four agents on the way.', c: 'var(--white)' },
  { k: 'Triage', t: 'The triager reads it first.', s: 'Is it real? How bad? Who takes it? Sorted in seconds.', c: 'var(--triager)' },
  { k: 'The fix', t: 'The coder writes the fix.', s: 'Small and careful, one line at a time.', c: 'var(--coder)' },
  { k: 'Tests', t: 'The tester tries to break it.', s: 'Every test runs. The one that fails gets fixed too.', c: 'var(--tester)' },
  { k: 'Review', t: 'The reviewer signs off.', s: 'Nothing ships without a second look.', c: 'var(--reviewer)' },
  { k: 'Merge', t: 'It merges.', s: 'One more dot on the line. Nobody had to lift a finger.', c: 'var(--reviewer)' },
  { k: 'Again', t: 'That’s the relay.', s: 'Four agents, one baton, every single time.', c: 'var(--triager)' },
]
const LAST = SCENES.length - 1

const DIFF: [string, string][] = [
  [' ', 'async function save(form) {'], ['-', '  if (clicks > 1) return'], ['-', '  clicks++'],
  ['+', '  if (saving) return form.pending'], ['+', '  saving = true'], ['+', '  try { await submit(form) }'], ['+', '  finally { saving = false }'], [' ', '}'],
]
const CHIPS = [['bug', 'var(--tester)'], ['priority: high', 'var(--triager)'], ['→ coder', 'var(--coder)']] as const
const COMMITS = 9

const readTitle = () => { try { return localStorage.getItem(TITLE_KEY) || DEFAULT_TITLE } catch { return DEFAULT_TITLE } }
const vars = (o: Record<string, string | number>) => o as CSSProperties

export default function Relay() {
  const winH = useWinHeight()
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const [scene, setScene] = useState(0)
  useMotionValueEvent(scrollYProgress, 'change', (v) => setScene(Math.min(LAST, Math.max(0, Math.floor(v * SCENES.length)))))
  const [title, setTitle] = useState(readTitle)

  const again = (next: string) => {
    const t = next.trim() || DEFAULT_TITLE
    setTitle(t)
    try { localStorage.setItem(TITLE_KEY, t) } catch { /* this visit only */ }
    const top = (ref.current?.getBoundingClientRect().top ?? 0) + window.scrollY
    window.scrollTo({ top, behavior: document.documentElement.classList.contains('less-motion') ? 'auto' : 'smooth' })
  }

  return (
    <div className="page rl-page" style={winH}>
      <section ref={ref} className="rl-film">
        <div className="rl-pin">
          <div className={`rl-stage is-s${scene}`} style={vars({ '--c': SCENES[scene].c })}>
            <div className="rl-top">
              <span className="rl-chip"><b>The Relay</b><Link to="/app/fun" className="rl-back">← Just for fun</Link></span>
            </div>

            <div className="rl-heads">
              {SCENES.map((s, k) => (
                <div key={s.k} className={`rl-head ${k === scene ? 'on' : k < scene ? 'past' : ''}`} aria-hidden={k !== scene}>
                  <span className="rl-kicker">{String(k + 1).padStart(2, '0')} · {s.k}</span>
                  <h1>{s.t}</h1>
                  <p>{s.s}</p>
                </div>
              ))}
            </div>

            <div className="rl-center">
              <span className="rl-dot" aria-hidden="true"><i /></span>

              <div className="rl-card" aria-hidden="true">
                <span className="rl-stripe" />
                <div className="rl-face rl-issue">
                  <span className="rl-meta">#142 · opened just now</span>
                  <b className="rl-title">{title}</b>
                  <span className="rl-bars"><i /><i /><i /></span>
                  <span className="rl-labels">{CHIPS.map(([t, c], i) => <span key={t} className="rl-label" style={vars({ background: c, '--i': i })}>{t}</span>)}</span>
                </div>
                <div className="rl-face rl-code">
                  <span className="rl-code-head"><i /><i /><i /><em>save.ts</em></span>
                  {DIFF.map(([m, t], i) => (
                    <span key={i} className={`rl-row ${m === '+' ? 'is-add' : m === '-' ? 'is-del' : ''}`} style={vars({ '--i': i })}><b>{m}</b><code>{t}</code></span>
                  ))}
                </div>
                <div className="rl-face rl-tests">
                  {Array.from({ length: 12 }, (_, i) => <span key={i} className={`rl-test ${i === 6 ? 'is-shaky' : ''}`} style={vars({ '--i': i })}><i>✓</i></span>)}
                </div>
                <div className="rl-face rl-review">
                  <span className="rl-stamp"><svg viewBox="0 0 100 100"><path d="M28 52 L44 67 L73 35" /></svg></span>
                  <b>Approved</b>
                </div>
              </div>

              <div className="rl-line" aria-hidden="true">
                <i className="rl-rail" />
                {Array.from({ length: COMMITS }, (_, i) => (
                  <span key={i} className={`rl-commit ${i === COMMITS - 1 ? 'is-new' : ''}`} style={vars({ '--i': i, '--c': `var(--${ROLES[i % 4]})` })} />
                ))}
              </div>

              <Finale shown={scene === LAST} title={title} onAgain={again} />
            </div>

            <div className="rl-crew">
              {ROLES.map((r, k) => (
                <span key={r} className={`rl-agent ${scene === k + 2 ? 'is-on' : ''} ${scene > k + 2 && scene < LAST ? 'is-done' : ''}`} style={vars({ '--c': `var(--${r})`, '--i': k })}>
                  <span className="rl-agent-body"><i /><i /></span>
                  <span className="rl-agent-name">{r}</span>
                </span>
              ))}
            </div>

            <div className="rl-progress" aria-hidden="true">
              <motion.i style={{ scaleX: scrollYProgress }} />
              {SCENES.map((s, k) => <span key={s.k} style={{ left: `${(k / SCENES.length) * 100}%` }} />)}
            </div>
            <div className="rl-hint" aria-hidden="true"><span>Scroll</span><i /></div>
          </div>
        </div>
      </section>
    </div>
  )
}

function Finale({ shown, title, onAgain }: { shown: boolean; title: string; onAgain: (t: string) => void }) {
  const [draft, setDraft] = useState(title === DEFAULT_TITLE ? '' : title)
  const submit = (e: FormEvent) => { e.preventDefault(); onAgain(draft) }
  return (
    <form className="rl-final" onSubmit={submit} aria-hidden={!shown} inert={!shown}>
      <b>Your turn.</b>
      <p>Name a bug of your own and send it down the line.</p>
      <div className="rl-final-row">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={64} placeholder={DEFAULT_TITLE} aria-label="A bug to send down the line" />
        <button className="btn btn-dark" type="submit">Run it ↑</button>
      </div>
    </form>
  )
}
