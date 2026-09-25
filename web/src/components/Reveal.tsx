import { motion, useScroll, useTransform, type MotionValue } from 'motion/react'
import { Fragment, useRef, type ReactNode } from 'react'
import { easeOut } from '../lib/motion'

/** Fades and lifts children into place the first time they scroll into view. */
export function Reveal({ children, delay = 0, y = 28, className, as = 'div' }:
  { children: ReactNode; delay?: number; y?: number; className?: string; as?: 'div' | 'section' | 'li' | 'span' }) {
  const M = motion[as]
  return (
    <M className={className} initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }} transition={{ duration: 0.9, ease: easeOut, delay }}>
      {children}
    </M>
  )
}

/** Headline whose words rise out of a mask one after another. The heading itself is
 *  observed: the words start clipped by their masks, so observing them would never fire. */
export function SplitWords({ text, className, delay = 0, stagger = 0.06, as = 'h2' }:
  { text: string; className?: string; delay?: number; stagger?: number; as?: 'h1' | 'h2' | 'h3' | 'p' }) {
  const Tag = motion[as]
  return (
    <Tag className={className} aria-label={text} initial="hidden" whileInView="show"
      viewport={{ once: true, margin: '0px 0px -8% 0px' }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: stagger, delayChildren: delay } } }}>
      {text.split(' ').map((w, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          <span className="word-mask" aria-hidden="true">
            <motion.span className="word" variants={{ hidden: { y: '110%' }, show: { y: '0%', transition: { duration: 0.9, ease: easeOut } } }}>
              {w}
            </motion.span>
          </span>
        </Fragment>
      ))}
    </Tag>
  )
}

/** Paragraph that "reads itself": each word brightens as scroll passes it (Ctrl's title lists). */
export function ScrollText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 85%', 'end 45%'] })
  const words = text.split(' ')
  return (
    <p ref={ref} className={className}>
      {words.map((w, i) => <Word key={i} progress={scrollYProgress} range={[i / words.length, (i + 1) / words.length]}>{w}</Word>)}
    </p>
  )
}

function Word({ children, progress, range }: { children: string; progress: MotionValue<number>; range: [number, number] }) {
  const opacity = useTransform(progress, range, [0.16, 1])
  return <motion.span style={{ opacity }}>{children} </motion.span>
}
