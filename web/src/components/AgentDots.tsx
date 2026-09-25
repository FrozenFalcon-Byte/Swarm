import { motion } from 'motion/react'
import { AGENTS, type AgentName } from '../lib/types'

/** Overlapping agent circles, like Ctrl's chain avatars on its CTA. */
export function AgentDots({ size = 16, active }: { size?: number; active?: AgentName | null }) {
  return (
    <span className="agent-dots" style={{ height: size }}>
      {AGENTS.map((a, i) => (
        <motion.span
          key={a}
          className="agent-dot"
          title={a}
          style={{ width: size, height: size, background: `var(--${a})`, marginLeft: i ? -size * 0.35 : 0, zIndex: 4 - i }}
          animate={active === a ? { y: [0, -4, 0] } : { y: 0 }}
          transition={active === a ? { duration: 0.9, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
        />
      ))}
    </span>
  )
}

export const agentColor = (a: string) => (AGENTS as readonly string[]).includes(a) ? `var(--${a})` : 'var(--ink)'
