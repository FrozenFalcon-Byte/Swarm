import { motion, useReducedMotion, type Variants } from 'motion/react'
import type { ReactNode } from 'react'
import { easeInOut, easeOut } from '../lib/motion'
import { Mark } from './Logo'

/*
 * Accordion-style page change, in Swarm's light theme.
 *   leave: the page folds down into a rounded card while pleats close in from both edges,
 *          outermost first, like bellows being squeezed shut.
 *   swap:  the closed bellows show where you're going.
 *   enter: the pleats open again from the middle out and the new page settles into place.
 * Used for whole-page changes ("viewport") and, inside the dashboard, for the content pane ("pane").
 */

const PER_SIDE = 6
// The two pleats nearest the middle carry the agents' colours; the rest are paper and grey.
const INNER = ['var(--triager)', 'var(--coder)', 'var(--reviewer)', 'var(--tester)'] // reads triager, coder | tester, reviewer across the middle

type Scope = 'viewport' | 'pane'

const timing = {
  viewport: { close: 0.62, open: 0.72, stagger: 0.05, hold: 0.34 },
  pane: { close: 0.46, open: 0.54, stagger: 0.035, hold: 0.2 },
}

// the page scales about the middle of what's on screen, not the middle of the whole document
function setOrigin() {
  document.documentElement.style.setProperty('--pt-origin', `${window.scrollY + window.innerHeight / 2}px`)
}

function contentVariants(scope: Scope): Variants {
  const t = timing[scope]
  return {
    initial: { scale: 1.035, opacity: 0.4 },
    enter: () => {
      setOrigin()
      return { scale: 1, opacity: 1, transition: { delay: t.hold + t.open * 0.3, duration: t.open, ease: easeOut } }
    },
    exit: () => {
      setOrigin()
      const leave = { duration: t.close + t.stagger * PER_SIDE, ease: easeInOut }
      if (scope === 'pane') return { scale: 0.96, opacity: 0.5, transition: leave }
      // fold what's on screen into a rounded card (the rest of the document is clipped away)
      const sy = window.scrollY, vh = window.innerHeight
      const bottom = Math.max(0, document.documentElement.scrollHeight - sy - vh)
      return {
        scale: 0.92, opacity: 0.55, transition: leave,
        clipPath: [`inset(${sy}px 0px ${bottom}px 0px round 0px)`, `inset(${sy + vh * 0.09}px 6% ${bottom + vh * 0.09}px 6% round 48px)`],
      }
    },
  }
}

function pleatVariants(scope: Scope, side: 'l' | 'r'): Variants {
  const t = timing[scope]
  // Folded away, every pleat is squeezed flat against its own edge of the screen; closed, they sit
  // side by side across it. Moving and squeezing together is what makes it read as bellows.
  const folded = (i: number) => ({ scaleX: 0, x: `${side === 'l' ? -i * 100 : i * 100}%` })
  return {
    initial: { scaleX: 1, x: '0%' },
    // a fresh page arrives behind closed bellows, then they fold out to the edges (inner pleats lead)
    enter: (i: number) => ({
      ...folded(i),
      transition: { delay: t.hold + (PER_SIDE - 1 - i) * t.stagger, duration: t.open, ease: easeInOut },
    }),
    // leaving: the bellows stretch in from both edges (outer pleats lead)
    exit: (i: number) => ({
      scaleX: [0, 1], x: [folded(i).x, '0%'],
      transition: { delay: i * t.stagger, duration: t.close, ease: easeInOut },
    }),
  }
}

function labelVariants(scope: Scope): Variants {
  const t = timing[scope]
  return {
    initial: { opacity: 0, y: 12 },
    // rises in on the closed bellows, then leaves as they open
    enter: { opacity: [0, 1, 1, 0], y: [12, 0, 0, -12], transition: { duration: t.hold + 0.45, times: [0, 0.32, 0.62, 1], ease: easeOut } },
    exit: { opacity: 0, transition: { duration: 0 } },
  }
}

function Bellows({ scope, label }: { scope: Scope; label: string }) {
  const pleats = (side: 'l' | 'r') => Array.from({ length: PER_SIDE }, (_, i) => {
    const inner = i >= PER_SIDE - 2
    const colour = inner ? INNER[(side === 'l' ? 0 : 2) + (i - (PER_SIDE - 2))] : undefined
    return (
      <motion.span key={`${side}${i}`} custom={i} variants={pleatVariants(scope, side)}
        className={`pleat pleat-${side} ${i % 2 ? 'pleat-b' : 'pleat-a'}`}
        style={{ [side === 'l' ? 'left' : 'right']: `${(i * 50) / PER_SIDE}%`, ...(colour ? { background: colour } : {}) }} />
    )
  })
  return (
    <div className={`bellows bellows--${scope}`} aria-hidden="true">
      {pleats('l')}
      {pleats('r')}
      <motion.div className="bellows-label" variants={labelVariants(scope)}>
        <Mark size={scope === 'viewport' ? 34 : 26} />
        <span>{label}</span>
      </motion.div>
    </div>
  )
}

/** Wrap one routed page. Give it a `key` in an <AnimatePresence mode="wait" initial={false}>. */
export function PageTransition({ scope = 'viewport', label, children, style = 'bellows' }: { scope?: Scope; label: string; children: ReactNode; style?: 'bellows' | 'fade' | 'none' }) {
  const reduced = useReducedMotion()
  if (style === 'none') return <div>{children}</div>
  if (style === 'fade' && !reduced) {
    // the old page sinks and fades, the new one rises out of a soft blur
    return (
      <motion.div initial={{ opacity: 0, y: 18, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.5, ease: easeOut } }}
        exit={{ opacity: 0, y: -10, filter: 'blur(4px)', transition: { duration: 0.22, ease: easeInOut } }}>{children}</motion.div>
    )
  }
  if (reduced) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>{children}</motion.div>
    )
  }
  const t = timing[scope]
  return (
    <motion.div className={`pt pt--${scope}`} initial="initial" animate="enter" exit="exit"
      // the wrapper itself only has to outlast its children so AnimatePresence waits for the bellows
      variants={{ initial: {}, enter: {}, exit: { transition: { duration: t.close + t.stagger * PER_SIDE } } }}>
      <motion.div className="pt-content" variants={contentVariants(scope)}>{children}</motion.div>
      <Bellows scope={scope} label={label} />
    </motion.div>
  )
}

/** A readable name for where a path leads, shown on the closed bellows. */
export function routeLabel(path: string, repoName?: (id: string) => string | undefined): string {
  if (path === '/') return 'Home'
  if (path.startsWith('/signin')) return 'Sign in'
  if (path.startsWith('/signup')) return 'Create account'
  const m = path.match(/^\/app\/repos\/([^/]+)/)
  if (m) return repoName?.(m[1]) || 'Repository'
  if (path.startsWith('/app/repos')) return 'Repositories'
  if (path.startsWith('/app/tools')) return 'Tools'
  if (path.startsWith('/app/settings')) return 'Settings'
  if (path.startsWith('/app/profile')) return 'Your profile'
  if (path.startsWith('/app/help')) return 'Help'
  if (path.startsWith('/app/agents')) return 'Agents'
  if (path.startsWith('/app/lab')) return 'Test lab'
  if (path.startsWith('/onboarding')) return 'Welcome'
  if (path.startsWith('/docs')) return 'MCP docs'
  if (path.startsWith('/jam')) return 'The Jam'
  if (path.startsWith('/maker')) return 'Agent maker'
  if (path.startsWith('/island')) return 'The Island'
  if (path.startsWith('/app/rules')) return 'House rules'
  if (path.startsWith('/app/quiet-hours')) return 'Quiet hours'
  if (path.startsWith('/app/hive')) return 'The Hive'
  if (path.startsWith('/app')) return 'Overview'
  return 'Swarm'
}
