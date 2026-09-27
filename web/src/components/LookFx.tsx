import { memo } from 'react'

/* Each theme's backdrop, behind every dashboard page (and small, inside its card in Settings). They are all
   the same idea kept quiet: a pastel wash plus one slow thing moving at the edge of the page, never over the
   work. Plain has none; Swarm's agents glow, Mint's dots catch a wandering light, Paper warms in a corner,
   Candy's sprinkles bob, Harbour's water glints, and Sunny sends out rings of light. CSS does the moving (styles/looks.css). */

export type Look = 'plain' | 'swarm' | 'studio' | 'paper' | 'candy' | 'harbour' | 'sunny'

// sprinkles scattered through the top-right corner: where each sits, its angle, colour and bob
const SPRINKLES = Array.from({ length: 16 }, (_, i) => ({
  x: 58 + ((i * 37) % 40), y: 4 + ((i * 53) % 34), r: (i * 67) % 180, tint: i % 4, dur: 5 + (i % 5) * 1.3, delay: -((i * 1.7) % 6),
}))
// glints on the water: short lines low on the page that swell and fade as they slide
const GLINTS = Array.from({ length: 12 }, (_, i) => ({
  x: (i * 29 + 7) % 92, y: 72 + ((i * 17) % 24), w: 18 + ((i * 13) % 40), dur: 7 + (i % 4) * 2, delay: -((i * 2.3) % 9),
}))

export const LookFx = memo(function LookFx({ look, mini = false }: { look?: string; mini?: boolean }) {
  const cls = `look-fx look-fx--${look || 'plain'} ${mini ? 'look-fx--mini' : ''}`
  switch (look || 'plain') {
    case 'plain':
      return null
    case 'studio':
      return <div className={cls} aria-hidden="true"><i className="fx-wash" /><i className="fx-dotgrid" /></div>
    case 'paper':
      return <div className={cls} aria-hidden="true"><i className="fx-warm" /><i className="fx-grain" /></div>
    case 'candy':
      return (
        <div className={cls} aria-hidden="true">
          <i className="fx-wash" />
          {SPRINKLES.slice(0, mini ? 9 : 16).map((p, i) => (
            <i key={i} className={`fx-sprinkle t${p.tint}`} style={{ left: `${p.x}%`, top: `${mini ? p.y * 1.6 : p.y}%`, ['--r' as string]: `${p.r}deg`,
              ['--d' as string]: `${p.dur}s`, ['--delay' as string]: `${p.delay}s` }} />
          ))}
        </div>
      )
    case 'harbour':
      return (
        <div className={cls} aria-hidden="true">
          <i className="fx-sea" />
          {GLINTS.slice(0, mini ? 7 : 12).map((g, i) => (
            <i key={i} className="fx-glint" style={{ left: `${g.x}%`, top: `${g.y}%`, width: mini ? g.w / 2 : g.w, ['--d' as string]: `${g.dur}s`, ['--delay' as string]: `${g.delay}s` }} />
          ))}
        </div>
      )
    case 'sunny':
      return <div className={cls} aria-hidden="true"><i className="fx-glow" />{[0, 1, 2].map((k) => <i key={k} className="fx-ring" style={{ ['--k' as string]: k }} />)}</div>
    default: // swarm
      return <div className={cls} aria-hidden="true">{[0, 1, 2, 3].map((k) => <i key={k} className={`fx-orb fx-orb--${k}`} />)}</div>
  }
})
