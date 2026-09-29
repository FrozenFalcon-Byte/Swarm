import { motion } from 'motion/react'
import { Link } from 'react-router-dom'
import { Roll } from '../../components/Roll'
import { PageHead } from './Overview'
import { useWinHeight } from '../../lib/winHeight'
import './fun.css'

/* Just for fun: the dashboard's toys, one big card each. Each card plays a little loop of what's inside. */

const CARDS = [
  { to: '/app/fun/liftoff', title: 'Liftoff', tag: 'Scroll film', tint: 'var(--coder)', art: <LiftoffArt />,
    text: 'Your swarm, launched. Scroll your repos into orbit past every fix they shipped, then light your favourites as stars and high-five the crew.' },
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

/** Three, two, one: the rocket shakes, lifts off past the clouds and the stars come out. */
function LiftoffArt() {
  const loop = { repeat: Infinity, duration: 5.2, repeatDelay: 0.3 } as const
  const stars = [[40, 30], [90, 60], [250, 40], [280, 90], [60, 120], [230, 140], [150, 22], [300, 30]]
  return (
    <svg viewBox="0 0 320 220" className="fun-svg">
      {stars.map(([x, y], k) => (
        <motion.path key={k} d={`M${x} ${y - 6}l2 4 4 2-4 2-2 4-2-4-4-2 4-2z`} fill="var(--triager)" stroke="var(--ink)" strokeWidth="1.5"
          animate={{ scale: [0, 0, 1.2, 1, 1, 0], opacity: [0, 0, 1, 1, 1, 0] }} transition={{ ...loop, times: [0, 0.45 + k * 0.03, 0.5 + k * 0.03, 0.55 + k * 0.03, 0.92, 1] }}
          style={{ originX: `${x}px`, originY: `${y}px` }} />
      ))}
      <motion.path d="M20 200 C 90 186, 230 190, 300 200" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round"
        animate={{ y: [0, 0, 60, 60, 0] }} transition={{ ...loop, times: [0, 0.35, 0.6, 0.95, 1] }} />
      {[[110, 190], [210, 190], [135, 196], [185, 196]].map(([x, y], k) => (
        <motion.circle key={k} cx={x} cy={y} r="14" fill="var(--white)" stroke="var(--ink)" strokeWidth="2.5"
          animate={{ scale: [0, 0, 1.3, 1.6, 0], opacity: [0, 0, 1, 1, 0] }} transition={{ ...loop, times: [0, 0.18, 0.3, 0.5, 0.62] }} style={{ originX: `${x}px`, originY: `${y}px` }} />
      ))}
      <motion.g animate={{ y: [0, 0, 0, -150, -150, 0], x: [0, 1.5, -1.5, 0, 0, 0] }} transition={{ ...loop, times: [0, 0.2, 0.3, 0.62, 0.95, 1], ease: 'easeIn' }}>
        <motion.path d="M150 176 Q160 222 170 176z" fill="#ffb347" stroke="var(--ink)" strokeWidth="2.5" animate={{ scaleY: [0.2, 0.5, 1.2, 1] }}
          transition={{ repeat: Infinity, duration: 0.25, repeatType: 'mirror' }} style={{ originX: '160px', originY: '176px' }} />
        <path d="M144 150l-14 22h14z M176 150l14 22h-14z" fill="var(--tester)" stroke="var(--ink)" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M160 86c14 14 18 38 16 90h-32c-2-52 2-76 16-90z" fill="var(--white)" stroke="var(--ink)" strokeWidth="3" />
        <path d="M144 146h32v14h-32z" fill="var(--reviewer)" stroke="var(--ink)" strokeWidth="2.5" />
        <circle cx="160" cy="118" r="9" fill="var(--coder)" stroke="var(--ink)" strokeWidth="2.5" />
      </motion.g>
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
