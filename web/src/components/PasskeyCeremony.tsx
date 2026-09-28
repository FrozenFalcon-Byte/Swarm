import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { PasskeyStep } from '../lib/auth'
import './passkey.css'

/*
 * The passkey moment, made visible. A round vault in the middle of the screen walks through what's actually
 * happening: the agents gather while Swarm asks the server for a challenge, a fingerprint draws itself and a
 * scan line sweeps it while your device asks for your finger, face or PIN, the print turns into a key while
 * the server checks it, and then either the key drops onto your keyring (adding one) or a padlock springs
 * open (signing in). A failure shakes its head and offers another go.
 */

export type CeremonyStep = PasskeyStep | 'error'
type Props = { step: CeremonyStep | null; mode: 'add' | 'signin'; error?: string; onRetry?: () => void; onClose: () => void }

const AGENTS = ['var(--triager)', 'var(--coder)', 'var(--tester)', 'var(--reviewer)']
const RIDGES = [
  'M12 4.5a7.5 7.5 0 017.5 7.5v1.5', 'M4.5 13.5V12A7.5 7.5 0 018.2 5.5', 'M8 19.5c1-1.8 1.5-3.8 1.5-6V12a2.5 2.5 0 015 0v1',
  'M12 12v1.5c0 3-1 5.8-2.8 8', 'M14.5 16c-.3 2-1 3.8-2 5.5', 'M17 14.5c0 2.4-.4 4.6-1.2 6.6', 'M6.5 16.5c.3-1 .5-2 .5-3V12a5 5 0 017-4.6',
]
const COPY: Record<'add' | 'signin', Record<CeremonyStep, [string, string]>> = {
  add: {
    prepare: ['Getting a key ready', 'Asking Swarm for a fresh challenge.'],
    device: ['Over to your device', 'Use your fingerprint, face or PIN when it asks.'],
    verify: ['Forging your key', 'Swarm is checking what your device made.'],
    done: ['Passkey added', 'Next time, sign in with just your finger or face.'],
    error: ['That didn’t go through', ''],
  },
  signin: {
    prepare: ['Finding your key', 'Asking Swarm for a fresh challenge.'],
    device: ['Over to your device', 'Use your fingerprint, face or PIN when it asks.'],
    verify: ['Checking it’s you', 'Swarm is matching your key.'],
    done: ['Welcome back', 'Unlocked. Taking you in.'],
    error: ['Couldn’t sign you in', ''],
  },
}
const STEPS: PasskeyStep[] = ['prepare', 'device', 'verify', 'done']
const LABELS = ['Challenge', 'Your device', 'Check', 'Done']

export function PasskeyCeremony({ step, mode, error, onRetry, onClose }: Props) {
  const at = step === 'error' ? -1 : step === 'done' ? STEPS.length : step ? STEPS.indexOf(step) : 0
  const [title, sub] = step ? COPY[mode][step] : ['', '']
  return createPortal(
    <AnimatePresence>
      {step && (
        <motion.div key="pk" className={`pk-overlay pk--${mode}`} role="dialog" aria-modal="true" aria-label={title}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.35, delay: mode === 'signin' ? 0.2 : 0 } }}
          onClick={() => step === 'error' && onClose()}>
          <motion.div className="pk-card" onClick={(e) => e.stopPropagation()}
            initial={{ y: 50, scale: 0.9, rotate: -2 }} animate={{ y: 0, scale: 1, rotate: 0 }} exit={{ y: 30, scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}>
            <Vault step={step} mode={mode} />
            <div className="pk-copy" aria-live="polite">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={step} initial={{ opacity: 0, y: 14, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -10, filter: 'blur(4px)' }} transition={{ duration: 0.3 }}>
                  <h3>{title}</h3>
                  <p>{step === 'error' ? error || 'Something got in the way.' : sub}</p>
                </motion.div>
              </AnimatePresence>
            </div>
            {step !== 'error' ? (
              <ol className="pk-steps" aria-label="Progress">
                {LABELS.map((l, i) => (
                  <li key={l} className={i < at ? 'is-done' : i === at ? 'is-now' : ''}>
                    <span className="pk-step-dot">{i < at || (i === at && step === 'done') ? <motion.svg initial={{ scale: 0 }} animate={{ scale: 1 }} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></motion.svg> : i + 1}</span>
                    <span>{l}</span>
                    {i < LABELS.length - 1 && <i className="pk-step-line"><motion.b initial={false} animate={{ scaleX: i < at ? 1 : 0 }} transition={{ duration: 0.5, ease: [0.65, 0, 0.35, 1] }} /></i>}
                  </li>
                ))}
              </ol>
            ) : (
              <motion.div className="pk-actions" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <button className="btn btn-line btn-sm" onClick={onClose}>Not now</button>
                {onRetry && <button className="btn btn-dark btn-sm" onClick={onRetry}>Try again</button>}
              </motion.div>
            )}
            {(step === 'prepare' || step === 'device') && <button className="pk-cancel link" onClick={onClose}>Cancel</button>}
          </motion.div>
          {/* signing in: the unlock blooms out of the vault to fill the screen, and the dashboard takes over */}
          {mode === 'signin' && step === 'done' && (
            <motion.div className="pk-bloom" initial={{ clipPath: 'circle(0% at 50% 46%)' }} animate={{ clipPath: 'circle(150% at 50% 46%)' }} transition={{ delay: 0.75, duration: 0.8, ease: [0.76, 0, 0.24, 1] }}>
              <motion.div className="pk-bloom-in" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.1, duration: 0.4 }}>
                {AGENTS.map((c, i) => <motion.i key={i} style={{ background: c }} initial={{ y: 30, opacity: 0 }} animate={{ y: [30, -14, 0], opacity: 1 }} transition={{ delay: 1.15 + i * 0.06, duration: 0.5 }} />)}
              </motion.div>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function Vault({ step, mode }: { step: CeremonyStep; mode: 'add' | 'signin' }) {
  const bad = step === 'error', done = step === 'done'
  const [bits] = useState(() => Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2 + Math.random() * 0.3, d = 110 + Math.random() * 60
    return { x: Math.cos(a) * d, y: Math.sin(a) * d, c: AGENTS[i % 4], r: Math.random() * 360, s: 7 + Math.random() * 6 }
  }))
  return (
    <motion.div className={`pk-vault ${bad ? 'is-bad' : ''} ${done ? 'is-done' : ''}`}
      animate={bad ? { x: [0, -14, 12, -9, 6, -3, 0], rotate: [0, -3, 3, -2, 1, 0] } : done ? { scale: [1, 1.08, 1] } : { x: 0, scale: 1 }}
      transition={{ duration: bad ? 0.55 : 0.5 }}>
      {/* rings pulse out while your device is asking */}
      {step === 'device' && [0, 1, 2].map((i) => <span key={i} className="pk-ring" style={{ animationDelay: `${i * 0.6}s` }} />)}
      {done && <motion.span className="pk-ripple" initial={{ scale: 0.8, opacity: 0.8 }} animate={{ scale: 2.4, opacity: 0 }} transition={{ duration: 0.9, ease: 'easeOut' }} />}
      <span className="pk-fill" />

      {/* the agents gather while the challenge comes back, and orbit while it's checked */}
      <AnimatePresence>
        {(step === 'prepare' || step === 'verify') && (
          <motion.span key={`orbit-${step}`} className={`pk-orbit ${step === 'verify' ? 'is-fast' : ''}`} initial={{ opacity: 0, scale: 1.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.4 }} transition={{ duration: 0.45 }}>
            {AGENTS.map((c, i) => <i key={i} style={{ background: c, ['--k' as string]: i }} />)}
          </motion.span>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {(step === 'device' || step === 'prepare') && (
          <motion.svg key="print" className="pk-print" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
            initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: step === 'prepare' ? 0.25 : 1, scale: 1 }} exit={{ opacity: 0, scale: 0.4, rotate: 90, transition: { duration: 0.35 } }} transition={{ duration: 0.4 }}>
            {RIDGES.map((d, i) => (
              <motion.path key={i} d={d} initial={{ pathLength: 0 }} animate={{ pathLength: step === 'device' ? [0, 1, 1, 0] : 0.15 }}
                transition={step === 'device' ? { duration: 2.4, times: [0, 0.4, 0.8, 1], repeat: Infinity, delay: i * 0.1, ease: 'easeInOut' } : { duration: 0.3 }} />
            ))}
          </motion.svg>
        )}
        {step === 'verify' && (
          <motion.svg key="key" className="pk-key" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            initial={{ opacity: 0, scale: 0.3, rotate: -120 }} animate={{ opacity: 1, scale: 1, rotate: [-120, 10, -45] }} exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 220, damping: 14 }}>
            <circle cx="8" cy="12" r="4.2" /><path d="M12.2 12H21M18 12v3M21 12v2.2" />
          </motion.svg>
        )}
        {done && mode === 'add' && (
          <motion.span key="ring" className="pk-keyring" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pk-ring-loop"><circle cx="12" cy="7" r="4.5" /></svg>
            <motion.svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pk-hung"
              initial={{ y: -90, rotate: -200, opacity: 0 }} animate={{ y: 0, rotate: [0, 18, -10, 5, 0], opacity: 1 }} transition={{ y: { type: 'spring', stiffness: 300, damping: 13 }, rotate: { delay: 0.35, duration: 1.1 }, opacity: { duration: 0.1 } }}>
              <circle cx="12" cy="7.5" r="3.4" /><path d="M12 11v10M12 17h3M12 20h2.4" />
            </motion.svg>
          </motion.span>
        )}
        {done && mode === 'signin' && (
          <motion.svg key="lock" className="pk-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 16 }}>
            <rect x="5" y="11" width="14" height="10" rx="2.5" />
            <motion.path d="M8.5 11V7.5a3.5 3.5 0 017 0V11" initial={{ y: 0, rotate: 0 }} animate={{ y: -3.5, rotate: -28 }} style={{ originX: '15.5px', originY: '11px' }} transition={{ delay: 0.3, type: 'spring', stiffness: 380, damping: 11 }} />
            <motion.circle cx="12" cy="16" r="1.4" fill="currentColor" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.2 }} />
          </motion.svg>
        )}
        {bad && (
          <motion.svg key="bad" className="pk-bad" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
            initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 15 }}>
            <motion.path d="M12 6v8" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.15 }} /><path d="M12 18.5v.01" />
          </motion.svg>
        )}
      </AnimatePresence>

      {/* the scan line, only while your device has the prompt up */}
      {step === 'device' && <span className="pk-scan" />}

      {done && (
        <span className="pk-confetti" aria-hidden="true">
          {bits.map((b, i) => (
            <motion.i key={i} style={{ background: b.c, width: b.s, height: b.s, borderRadius: i % 3 ? '50%' : 3 }}
              initial={{ x: 0, y: 0, scale: 0 }} animate={{ x: [0, b.x, b.x * 1.1], y: [0, b.y, b.y + 50], scale: [0, 1.2, 0], rotate: b.r }}
              transition={{ delay: 0.25, duration: 1.2, times: [0, 0.4, 1], ease: 'easeOut' }} />
          ))}
        </span>
      )}
      {done && (
        <motion.span className="pk-badge" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.45, type: 'spring', stiffness: 500, damping: 16 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </motion.span>
      )}
    </motion.div>
  )
}
