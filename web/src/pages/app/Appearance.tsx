import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useToast } from '../../components/Island'
import { Select } from '../../components/Select'
import { useAuth } from '../../lib/auth'
import { savePrefs, useProfile, useRepos } from '../../lib/data'
import type { Prefs } from '../../lib/types'
import { pop } from '../../lib/sound'
import { NAV } from './nav'
import { PrefRow, Seg } from './ProfileExtras'
import { Section } from './ui'

/* How the dashboard looks and what's on it, for you. Every choice applies the moment you pick it (Firestore
   shows your own write straight away) and follows you to every device you sign in on. */

const ACCENTS: [NonNullable<Prefs['accent']>, string, string][] = [
  ['green', 'Mint', 'var(--green)'], ['sky', 'Sky', 'var(--coder)'], ['pink', 'Blush', 'var(--lab)'],
  ['yellow', 'Sun', 'var(--triager)'], ['coral', 'Coral', 'var(--tester)'], ['ink', 'Ink', 'var(--ink)'],
]
// whole looks in one click: each sets the colour, canvas, typeface and corners together
const THEMES: { id: string; name: string; look: Prefs; bg: string; dot: string; font: string; r: number }[] = [
  { id: 'swarm', name: 'Swarm', look: { accent: 'green', canvas: 'white', font: 'grotesk', corners: 'round' }, bg: '#ffffff', dot: 'var(--green)', font: 'var(--font-sans)', r: 14 },
  { id: 'studio', name: 'Studio', look: { accent: 'ink', canvas: 'mist', font: 'mono', corners: 'sharp' }, bg: '#f6f8fa', dot: 'var(--ink)', font: 'var(--font-mono)', r: 4 },
  { id: 'paper', name: 'Paper', look: { accent: 'coral', canvas: 'paper', font: 'grotesk', corners: 'soft' }, bg: '#fbf8f1', dot: 'var(--tester)', font: 'var(--font-sans)', r: 9 },
  { id: 'candy', name: 'Candy', look: { accent: 'pink', canvas: 'white', font: 'rounded', corners: 'round' }, bg: '#ffffff', dot: 'var(--lab)', font: 'ui-rounded, "SF Pro Rounded", system-ui', r: 14 },
  { id: 'harbour', name: 'Harbour', look: { accent: 'sky', canvas: 'mist', font: 'system', corners: 'soft' }, bg: '#f6f8fa', dot: 'var(--coder)', font: 'system-ui', r: 9 },
  { id: 'sunny', name: 'Sunny', look: { accent: 'yellow', canvas: 'paper', font: 'rounded', corners: 'round' }, bg: '#fbf8f1', dot: 'var(--triager)', font: 'ui-rounded, "SF Pro Rounded", system-ui', r: 14 },
]
const exampleTime = (clock?: string) => new Date(2026, 0, 1, 14, 32).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: clock === '12h' })
const DEFAULTS: Prefs = {
  accent: 'green', canvas: 'white', font: 'grotesk', corners: 'round', textSize: 'default', density: 'comfortable',
  sidebar: 'full', logo: 'alive', toasts: 'br', cursor: 'swarm', sounds: 'off', confirm: 'ask', times: 'relative', pins: [], motion: 'system', clock: '24h', weekStart: 'mon',
}

export function Appearance() {
  const { user } = useAuth()
  const toast = useToast()
  const prefs = useProfile(user?.uid)?.prefs ?? {}
  const { data: repos } = useRepos(user?.uid)
  const save = (patch: Prefs) => { if (user) savePrefs(user.uid, patch).catch(() => toast.error('Couldn’t save that', 'Check your connection and try again.')) }
  const accent = prefs.accent ?? 'green'
  // the colour well updates the preview as you drag, and saves once you let go
  const [hex, setHex] = useState(prefs.accentHex || '#7c5cff')
  useEffect(() => { if (prefs.accentHex) setHex(prefs.accentHex) }, [prefs.accentHex])
  const pins = prefs.pins ?? []
  const pinnable = [
    ...NAV.filter((n) => !n.admin).map((n) => ({ value: n.to, label: n.label, hint: 'Page' })),
    ...repos.map((r) => ({ value: `/app/repos/${r.id}`, label: r.displayName || r.fullName, hint: 'Repository' })),
  ].filter((o) => !pins.includes(o.value))
  const labelOf = (to: string) => NAV.find((n) => n.to === to)?.label ?? repos.find((r) => `/app/repos/${r.id}` === to)?.displayName ?? to
  const reset = () => { save(DEFAULTS); toast.ok('Back to how it started', 'Every look and layout choice is reset.') }

  return (
    <div className="pl-grid">
      <Section title="Look" action={<button className="link" onClick={reset}>Reset everything</button>}>
        <Preview prefs={{ ...prefs, accentHex: accent === 'custom' ? hex : prefs.accentHex }} />
        <div className="prefs">
          <div className="pref pref--stack">
            <div className="pref-copy"><b>Themes</b><span>A whole look in one click. Fine-tune any part of it below.</span></div>
            <div className="ap-themes" role="radiogroup" aria-label="Theme">
              {THEMES.map((t) => {
                const on = (Object.keys(t.look) as (keyof Prefs)[]).every((k) => (prefs[k] ?? DEFAULTS[k]) === t.look[k])
                return (
                  <motion.button key={t.id} role="radio" aria-checked={on} className={`ap-theme ${on ? 'on' : ''}`} whileTap={{ scale: 0.95 }}
                    onClick={() => { save(t.look); if (!on) toast.ok(`${t.name} it is`, 'Colour, canvas, type and corners changed together.') }}>
                    <span className="ap-theme-face" style={{ background: t.bg, borderRadius: t.r + 4 }}>
                      <b style={{ fontFamily: t.font }}>Aa</b>
                      <i style={{ background: t.dot, borderRadius: t.r > 6 ? '50%' : 3 }} />
                      <em style={{ borderRadius: t.r / 2 }} /><em style={{ borderRadius: t.r / 2, width: '44%' }} />
                    </span>
                    <span className="ap-theme-name">{on && <motion.span layoutId="theme-tick" className="ap-theme-tick">✓</motion.span>}{t.name}</span>
                  </motion.button>
                )
              })}
            </div>
          </div>
          <PrefRow title="Highlight colour" text="Marks where you are in the sidebar, the Overview card’s shadow and selected text. Or pick your own.">
            <div className="swatches" role="radiogroup" aria-label="Highlight colour">
              {ACCENTS.map(([id, label, color]) => (
                <button key={id} role="radio" aria-checked={accent === id} className={`swatch ${accent === id ? 'on' : ''}`} onClick={() => save({ accent: id })} title={label} style={{ ['--sw' as string]: color }}>
                  {accent === id && <motion.span layoutId="swatch-ring" className="swatch-ring" transition={{ type: 'spring', stiffness: 420, damping: 30 }} />}
                  <i /><span className="sr-only">{label}</span>
                </button>
              ))}
              <label className={`swatch swatch--own ${accent === 'custom' ? 'on' : ''}`} title="Your own colour" style={{ ['--sw' as string]: hex }}>
                {accent === 'custom' && <motion.span layoutId="swatch-ring" className="swatch-ring" transition={{ type: 'spring', stiffness: 420, damping: 30 }} />}
                <i />
                <input type="color" value={hex} onChange={(e) => setHex(e.target.value)} onBlur={() => save({ accent: 'custom', accentHex: hex })}
                  onClick={() => accent !== 'custom' && save({ accent: 'custom', accentHex: hex })} aria-label="Pick your own colour" />
              </label>
            </div>
          </PrefRow>
          <PrefRow title="Canvas" text="The ground behind every page. Paper is warmer, Mist is cooler and makes the cards stand out.">
            <Seg id="ap-canvas" value={prefs.canvas ?? 'white'} onPick={(v) => save({ canvas: v })} options={[['white', 'White'], ['paper', 'Paper'], ['mist', 'Mist']]} />
          </PrefRow>
          <PrefRow title="Typeface" text="The letters everything is set in. Mono is for people who live in a terminal.">
            <Seg id="ap-font" value={prefs.font ?? 'grotesk'} onPick={(v) => save({ font: v })} options={[['grotesk', 'Grotesk'], ['system', 'System'], ['rounded', 'Rounded'], ['mono', 'Mono']]} />
          </PrefRow>
          <PrefRow title="Corners" text="How round the cards and buttons are.">
            <Seg id="ap-corners" value={prefs.corners ?? 'round'} onPick={(v) => save({ corners: v })} options={[['round', 'Round'], ['soft', 'Soft'], ['sharp', 'Sharp']]} />
          </PrefRow>
          <PrefRow title="Text size" text="Scales every page of the dashboard. The sidebar stays as it is.">
            <Seg id="ap-size" value={prefs.textSize ?? 'default'} onPick={(v) => save({ textSize: v })} options={[['small', 'Smaller'], ['default', 'Default'], ['large', 'Larger']]} />
          </PrefRow>
        </div>
      </Section>

      <Section title="Layout" action={<span className="muted">what’s where</span>}>
        <div className="prefs">
          <PrefRow title="Sidebar" text="Icons only gives the pages more room. Point at an icon to see its name.">
            <Seg id="ap-side" value={prefs.sidebar ?? 'full'} onPick={(v) => save({ sidebar: v })} options={[['full', 'Full'], ['icons', 'Icons only']]} />
          </PrefRow>
          <PrefRow title="Notifications" text="Where they drop in: bottom right, bottom left, or the top.">
            <div className="ap-inline">
              <Seg id="ap-toasts" value={prefs.toasts ?? 'br'} onPick={(v) => save({ toasts: v })} options={[['br', 'Right'], ['bl', 'Left'], ['top', 'Top']]} />
              <button className="btn btn-line btn-sm" onClick={() => toast.ok('Looking good', 'This is how notifications arrive.')}>Try one</button>
            </div>
          </PrefRow>
          <div className="pref pref--stack">
            <div className="pref-copy"><b>Pinned</b><span>Pages and repositories you want first, at the top of the sidebar.</span></div>
            <div className="ap-pins">
              <AnimatePresence initial={false} mode="popLayout">
                {pins.map((to) => (
                  <motion.span key={to} layout className="ap-pin" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} transition={{ type: 'spring', stiffness: 460, damping: 30 }}>
                    {labelOf(to)}
                    <button onClick={() => save({ pins: pins.filter((p) => p !== to) })} aria-label={`Unpin ${labelOf(to)}`}>×</button>
                  </motion.span>
                ))}
              </AnimatePresence>
              {pinnable.length > 0 && pins.length < 8 && (
                <Select key={pins.join()} value={'' as string} label="Pin something" options={[{ value: '', label: '+ Pin something' }, ...pinnable]}
                  onChange={(v) => v && save({ pins: [...pins, v] })} className="ap-pin-add" />
              )}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Handy touches" action={<span className="muted">small things that help</span>}>
        <div className="prefs">
          <PrefRow title="Confirm before merging" text="Merge and Close ask for a second click, so a stray click never ships a fix or drops a task.">
            <Seg id="ap-confirm" value={prefs.confirm ?? 'ask'} onPick={(v) => save({ confirm: v })} options={[['ask', 'Ask me'], ['off', 'One click']]} />
          </PrefRow>
          <PrefRow title="Times" text="How times read across the dashboard: how long ago, or the time itself (in your clock format).">
            <Seg id="ap-times" value={prefs.times ?? 'relative'} onPick={(v) => save({ times: v })} options={[['relative', '5m ago'], ['exact', exampleTime(prefs.clock)]]} />
          </PrefRow>
          <PrefRow title="Pointer" text="Swarm’s own sticker arrow: it leans as you move, fills with your colour over anything clickable, and pops when you click.">
            <Seg id="ap-cursor" value={prefs.cursor === 'system' ? 'system' : 'swarm'} onPick={(v) => save({ cursor: v })} options={[['swarm', 'Swarm'], ['system', 'System']]} />
          </PrefRow>
          <PrefRow title="Click sounds" text="A soft pop when you press a button. Quiet enough for an office.">
            <Seg id="ap-sounds" value={prefs.sounds ?? 'off'} onPick={(v) => { save({ sounds: v }); if (v === 'pops') pop(1.2) }} options={[['off', 'Silent'], ['pops', 'Pops']]} />
          </PrefRow>
        </div>
      </Section>

      <Section title="Motion & time" action={<span className="muted">how it moves, when it is</span>}>
        <div className="prefs">
          <PrefRow title="Motion" text="How much the interface animates. “Match my device” follows your system’s reduce-motion setting.">
            <Seg id="ap-motion" value={prefs.motion ?? 'system'} onPick={(v) => save({ motion: v })} options={[['system', 'Match my device'], ['less', 'Less'], ['full', 'Full']]} />
          </PrefRow>
          <PrefRow title="Logo" text="The four agents in the sidebar logo chase round their tile, faster while one is working.">
            <Seg id="ap-logo" value={prefs.logo ?? 'alive'} onPick={(v) => save({ logo: v })} options={[['alive', 'Alive'], ['still', 'Still']]} />
          </PrefRow>
          <PrefRow title="Clock" text="How hours are written on Quiet hours.">
            <Seg id="ap-clock" value={prefs.clock ?? '24h'} onPick={(v) => save({ clock: v })} options={[['24h', '24-hour'], ['12h', '12-hour']]} />
          </PrefRow>
          <PrefRow title="Week starts on" text="The first row of the week you paint.">
            <Seg id="ap-week" value={prefs.weekStart ?? 'mon'} onPick={(v) => save({ weekStart: v })} options={[['mon', 'Monday'], ['sun', 'Sunday']]} />
          </PrefRow>
        </div>
      </Section>
    </div>
  )
}

/** A small dashboard drawn with your choices, so you see them before you leave this page. */
function Preview({ prefs }: { prefs: Prefs }) {
  const rail = prefs.sidebar === 'icons'
  const scale = prefs.textSize === 'small' ? 0.9 : prefs.textSize === 'large' ? 1.1 : 1
  const custom = prefs.accent === 'custom' && prefs.accentHex
  return (
    <div className={`ap-preview ${rail ? 'ap-rail' : ''} ${prefs.density === 'compact' ? 'compact' : ''} canvas-${prefs.canvas ?? 'white'} corners-${prefs.corners ?? 'round'} font-${prefs.font ?? 'grotesk'}`}
      data-accent={prefs.accent ?? 'green'} aria-hidden="true"
      style={custom ? { ['--accent' as string]: prefs.accentHex, ['--accent-soft' as string]: `color-mix(in srgb, ${prefs.accentHex} 22%, white)`, ['--accent-line' as string]: `color-mix(in srgb, ${prefs.accentHex} 55%, transparent)` } : undefined}>
      <motion.div className="ap-side" layout transition={{ duration: 0.45, ease: [0.65, 0, 0.35, 1] }}>
        <span className="ap-logo" />
        {[0, 1, 2, 3].map((k) => (
          <span key={k} className={`ap-link ${k === 1 ? 'on' : ''}`}><i />{!rail && <b style={{ width: `${[46, 62, 38, 54][k]}%` }} />}</span>
        ))}
      </motion.div>
      <div className="ap-main">
        <motion.div className="ap-scale" animate={{ scale }} style={{ originX: 0, originY: 0, width: `${100 / scale}%` }} transition={{ type: 'spring', stiffness: 260, damping: 26 }}>
          <span className="ap-title">Hi there.</span>
          <div className="ap-cards">{[0, 1, 2].map((k) => <span key={k} className="ap-card"><i /><b /><b /></span>)}</div>
        </motion.div>
      </div>
    </div>
  )
}
