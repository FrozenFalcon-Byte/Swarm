import { Link } from 'react-router-dom'

/** The Swarm mark: four agents in a tile. */
export function Mark({ size = 28, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={animated ? 'mark mark--live' : 'mark'}>
      <rect width="32" height="32" rx="8" fill="var(--ink)" />
      <circle cx="11" cy="11" r="4" fill="var(--triager)" />
      <circle cx="21" cy="11" r="4" fill="var(--coder)" />
      <circle cx="11" cy="21" r="4" fill="var(--tester)" />
      <circle cx="21" cy="21" r="4" fill="var(--reviewer)" />
    </svg>
  )
}

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="logo" aria-label="Swarm home">
      <Mark />
      <span>Swarm</span>
    </Link>
  )
}
