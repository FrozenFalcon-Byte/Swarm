import { motion } from 'motion/react'
import { Mark } from './Logo'

export function Splash() {
  return (
    <div className="splash" aria-label="Loading">
      <motion.div animate={{ rotate: [0, 90, 90, 180] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}><Mark size={40} /></motion.div>
    </div>
  )
}
