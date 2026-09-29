import { motion } from 'motion/react'
import { Link } from 'react-router-dom'
import { Roll } from '../../components/Roll'
import { easeOut } from '../../lib/motion'
import { PageHead } from './Overview'
import './fun.css'

/* Just for fun: the dashboard's toys, one big card each. Each card plays a little loop of what's inside. */

const CARDS = [
  { to: '/app/fun/garden', title: 'The Garden', tag: 'Film + game', tint: 'var(--reviewer)', art: <GardenArt />,
    text: 'Your swarm, grown. Every repo is a plant: scroll and watch it grow from your first issue, then keep the bugs off it.' },
  { to: '/app/fun/hive', title: 'The Hive', tag: 'Game', tint: 'var(--triager)', art: <HiveArt />,
    text: 'Your agents, off the clock. Drop bugs and watch the swarm fix each one in order: read, patch, test, sign off.' },
]

export default function Fun() {
  return (
    <div className="page fun-page">
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

/** A stem grows, three flowers pop open and a bee does a lap. */
function GardenArt() {
  const loop = { repeat: Infinity, duration: 6, repeatDelay: 0.4 } as const
  const blooms = [{ x: 118, y: 96, c: 'triager' }, { x: 206, y: 74, c: 'coder' }, { x: 160, y: 40, c: 'tester' }]
  return (
    <svg viewBox="0 0 320 220" className="fun-svg">
      <path d="M20 186 C 90 172, 220 176, 300 186" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
      <motion.path d="M160 186 Q 140 120 160 48" fill="none" stroke="var(--ink)" strokeWidth="6" strokeLinecap="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: [0, 1, 1, 0] }} transition={{ ...loop, times: [0, 0.25, 0.92, 1], ease: easeOut }} />
      <motion.path d="M152 128 Q 135 104 120 98 M154 100 Q 180 80 204 76" fill="none" stroke="var(--ink)" strokeWidth="4" strokeLinecap="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: [0, 0, 1, 1, 0] }} transition={{ ...loop, times: [0, 0.2, 0.35, 0.92, 1] }} />
      {blooms.map((b, k) => (
        <motion.g key={k} initial={{ scale: 0 }} animate={{ scale: [0, 0, 1.2, 1, 1, 0], rotate: [0, -90, 0, 0, 0, 0] }}
          transition={{ ...loop, times: [0, 0.35 + k * 0.08, 0.43 + k * 0.08, 0.48 + k * 0.08, 0.92, 1] }} style={{ originX: `${b.x}px`, originY: `${b.y}px` }}>
          {Array.from({ length: 6 }, (_, p) => { const a = (p / 6) * Math.PI * 2; return <circle key={p} cx={b.x + Math.cos(a) * 11} cy={b.y + Math.sin(a) * 11} r="8" fill={`var(--${b.c})`} stroke="var(--ink)" strokeWidth="2.5" /> })}
          <circle cx={b.x} cy={b.y} r="7" fill="#ffd85a" stroke="var(--ink)" strokeWidth="2.5" />
        </motion.g>
      ))}
      <motion.g animate={{ x: [40, 250, 200, 60, 40], y: [60, 40, 130, 120, 60] }} transition={{ repeat: Infinity, duration: 7, ease: 'easeInOut' }}>
        <ellipse cx="0" cy="-8" rx="5" ry="7" fill="var(--white)" stroke="var(--ink)" strokeWidth="2" />
        <ellipse cx="0" cy="0" rx="11" ry="8" fill="var(--reviewer)" stroke="var(--ink)" strokeWidth="2.5" />
        <path d="M-3 -7.5v15M3 -7.5v15" stroke="var(--ink)" strokeWidth="2.4" />
      </motion.g>
      <g transform="translate(236 176)">
        <ellipse rx="8" ry="6" fill="var(--ink)" /><circle cx="7" cy="-3" r="4" fill="var(--ink)" />
      </g>
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
      <motion.g animate={{ scale: [1, 1, 1.3, 0, 0, 1] }} transition={{ repeat: Infinity, duration: 5, times: [0, 0.8, 0.85, 0.9, 0.97, 1] }} style={{ originX: '160px', originY: '113px' }}>
        <ellipse cx="160" cy="113" rx="14" ry="17" fill="var(--ink)" />
        <path d="M150 100l-8-8M170 100l8-8M146 113h-10M174 113h10M148 124l-8 6M172 124l8 6" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
        <circle cx="155" cy="106" r="2.5" fill="var(--white)" /><circle cx="165" cy="106" r="2.5" fill="var(--white)" />
      </motion.g>
      <motion.g animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 10, ease: 'linear' }} style={{ originX: '160px', originY: '113px' }}>
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
      </motion.g>
    </svg>
  )
}
