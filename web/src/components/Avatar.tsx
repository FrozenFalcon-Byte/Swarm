import { useAuth } from '../lib/auth'
import { useProfile } from '../lib/data'

/** The signed-in person's picture, or their initial on their agent colour. */
export function Avatar({ size = 38, src, name }: { size?: number; src?: string | null; name?: string | null }) {
  const { user } = useAuth()
  const profile = useProfile(src === undefined ? user?.uid : undefined)
  const image = src !== undefined ? src : profile?.avatar
  const label = name ?? profile?.displayName ?? user?.displayName ?? user?.email ?? '?'
  const hue = ['var(--coder)', 'var(--triager)', 'var(--tester)', 'var(--reviewer)'][(label.charCodeAt(0) || 0) % 4]
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, background: image ? 'var(--white)' : hue }} aria-hidden="true">
      {image ? <img src={image} alt="" width={size} height={size} draggable={false} /> : label.slice(0, 1).toUpperCase()}
    </span>
  )
}
