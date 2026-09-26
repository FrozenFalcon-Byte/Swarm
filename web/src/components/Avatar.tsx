import { AnimatePresence, motion } from 'motion/react'
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
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, background: image ? 'var(--white)' : hue, transition: 'background 0.4s' }} aria-hidden="true">
      <AnimatePresence initial={false}>
        {image
          ? <motion.img key={image.length + image.slice(-16)} src={image} alt="" width={size} height={size} draggable={false} className="avatar-img"
              initial={{ opacity: 0, scale: 1.25, filter: 'blur(4px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0 }} transition={{ duration: 0.6, ease: [0.165, 0.84, 0.44, 1] }} />
          : <motion.span key="initial" className="avatar-initial" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>{label.slice(0, 1).toUpperCase()}</motion.span>}
      </AnimatePresence>
    </span>
  )
}
