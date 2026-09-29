import { motion } from 'motion/react'
import { Link } from 'react-router-dom'
import { Roll } from '../../components/Roll'
import { PageHead } from './Overview'
import { useWinHeight } from '../../lib/winHeight'
import './fun.css'

/* Just for fun: the dashboard's toys, one big card each. Each card plays a little loop of what's inside. */

const CARDS = [
  { to: '/app/fun/clock', title: 'The Clock Shop', tag: 'Scroll tour', tint: 'var(--coder)', art: <ClockArt />,
    text: 'A wall of clocks, each one a part of your Swarm and every one running. Scroll along it: world time, a cuckoo that calls what needs you, gears, an hourglass and your Rewind.' },
  { to: '/app/fun/hive', title: 'The Hive', tag: 'Game', tint: 'var(--triager)', art: <HiveArt />,
    text: 'Your agents, off the clock. Drop bugs and watch the swarm fix each one in order: read, patch, test, sign off.' },
]

export default function Fun() {
  const winH = useWinHeight()
  return (
    <div className="page fun-page" style={winH}>
      <PageHead title="Just for fun" sub="For when the agents have it handled. Pick one." />
      <div className="fun-grid">
        {CARDS.map((c, i) => (
          <motion.div key={c.to} initial={{ opacity: 0, y: 30, rotate: i ? 1.5 : -1.5 }} animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 120, damping: 16, delay: 0.08 + i * 0.1 }}>
            <Link to={c.to} className="fun-card" style={{ ['--tint' as string]: c.tint }}>
              <div className="fun-art" aria-hidden="true">{c.art}</div>
              <div className="fun-body">
                <span className="fun-tag">{c.tag}</span>
                <h2>{c.title}</h2>
                <p>{c.text}</p>
                <span className="btn btn-dark btn-sm fun-open"><Roll>{`Open ${c.title}`}</Roll></span>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

/** A wall clock whose hands race round, its four agent dots bobbing, next to a little hourglass that flips. */
function ClockArt() {
  const AG = ['var(--triager)', 'var(--coder)', 'var(--tester)', 'var(--reviewer)']
  return (
    <svg viewBox="0 0 320 220" className="fun-svg">
      <circle cx="140" cy="110" r="74" fill="var(--ink)" />
      <circle cx="140" cy="110" r="64" fill="var(--white)" stroke="var(--ink)" strokeWidth="3" />
      {AG.map((c, k) => {
        const a = (k / 4) * Math.PI * 2
        return <motion.circle key={k} cx={140 + Math.sin(a) * 44} cy={110 - Math.cos(a) * 44} r="10" fill={c} stroke="var(--ink)" strokeWidth="2.5"
          animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 1.6, delay: k * 0.2, ease: 'easeInOut' }} />
      })}
      {/* Each spinner sits at the local origin with a clear circle round it, so its box is centred on the pivot. */}
      <g transform="translate(140 110)">
        <motion.g animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 12, ease: 'linear' }}>
          <circle r="60" fill="none" />
          <line x1="0" y1="0" x2="0" y2="-30" stroke="var(--ink)" strokeWidth="7" strokeLinecap="round" />
        </motion.g>
        <motion.g animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}>
          <circle r="60" fill="none" />
          <line x1="0" y1="0" x2="0" y2="-48" stroke="var(--ink)" strokeWidth="4.5" strokeLinecap="round" />
        </motion.g>
      </g>
      <circle cx="140" cy="110" r="5" fill="var(--ink)" />
      <g transform="translate(262 130)"><motion.g animate={{ rotate: [0, 0, 180, 180] }} transition={{ repeat: Infinity, duration: 4, times: [0, 0.8, 0.95, 1], ease: 'easeInOut' }}>
        <circle r="56" fill="none" /><g transform="translate(-262 -130)">
        <path d="M240 88h44M240 172h44M244 90c0 26 16 30 16 40s-16 14 -16 40h36c0-26-16-30-16-40s16-14 16-40z" fill="var(--white)" stroke="var(--ink)" strokeWidth="3" strokeLinejoin="round" />
        <motion.path d="M250 170c2-14 8-18 12-18s10 4 12 18z" fill="var(--tester)" style={{ originY: 1 }} animate={{ scaleY: [0.2, 1, 1, 0.2] }} transition={{ repeat: Infinity, duration: 4, times: [0, 0.8, 0.95, 1] }} />
        </g>
      </motion.g></g>
    </svg>
  )
}

/** Four agents circling a bug whose ring fills a quarter at a time, then pops. */
function HiveArt() {
  return (
    <svg viewBox="0 0 320 220" className="fun-svg">
      <path d="M160 30l72 41.5v83L160 196l-72-41.5v-83z" fill="none" stroke="var(--ink)" strokeWidth="3" strokeDasharray="7 8" opacity="0.35" />
      <motion.circle cx="160" cy="113" r="30" fill="none" stroke="var(--reviewer)" strokeWidth="8" strokeLinecap="round" transform="rotate(-90 160 113)"
        initial={{ pathLength: 0 }} animate={{ pathLength: [0, 0.25, 0.5, 0.75, 1, 1, 0] }} transition={{ repeat: Infinity, duration: 5, times: [0, 0.2, 0.4, 0.6, 0.8, 0.9, 1] }} />
      <g transform="translate(160 113)"><motion.g animate={{ scale: [1, 1, 1.3, 0, 0, 1] }} transition={{ repeat: Infinity, duration: 5, times: [0, 0.8, 0.85, 0.9, 0.97, 1] }}>
        <circle r="26" fill="none" /><g transform="translate(-160 -113)">
        <ellipse cx="160" cy="113" rx="14" ry="17" fill="var(--ink)" />
        <path d="M150 100l-8-8M170 100l8-8M146 113h-10M174 113h10M148 124l-8 6M172 124l8 6" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
        <circle cx="155" cy="106" r="2.5" fill="var(--white)" /><circle cx="165" cy="106" r="2.5" fill="var(--white)" />
        </g>
      </motion.g></g>
      <g transform="translate(160 113)"><motion.g animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 10, ease: 'linear' }}>
        <circle r="100" fill="none" /><g transform="translate(-160 -113)">
        {['triager', 'coder', 'tester', 'reviewer'].map((a, k) => {
          const ang = (k / 4) * Math.PI * 2, x = 160 + Math.cos(ang) * 72, y = 113 + Math.sin(ang) * 60
          return (
            <g key={a}>
              <circle cx={x + 2} cy={y + 3} r="15" fill="var(--ink)" />
              <circle cx={x} cy={y} r="15" fill={`var(--${a})`} stroke="var(--ink)" strokeWidth="2.5" />
              <circle cx={x - 4.5} cy={y - 2} r="2.2" fill="#0f0f0f" /><circle cx={x + 4.5} cy={y - 2} r="2.2" fill="#0f0f0f" />
            </g>
          )
        })}
        </g>
      </motion.g></g>
    </svg>
  )
}
