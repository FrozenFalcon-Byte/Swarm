import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { TOAST_LOOK, useToast, type ToastLook } from '../../components/Island'
import { Select } from '../../components/Select'
import { useAuth } from '../../lib/auth'
import { savePrefs, usePrefs, useRepos } from '../../lib/data'
import type { Prefs } from '../../lib/types'
import { pop } from '../../lib/sound'
import { LookFx } from '../../components/LookFx'
import { morph, setMode, useMode, type Mode } from '../../lib/theme'
import { FONTS, THEMES } from '../../lib/looks'
import { NAV } from './nav'
import { PrefRow, Seg } from './ProfileExtras'
import { Section } from './ui'

/* How the dashboard looks and what's on it, for you. Every choice applies the moment you pick it (Firestore
   shows your own write straight away) and follows you to every device you sign in on. */

const ACCENTS: [NonNullable<Prefs['accent']>, string, string][] = [
  ['green', 'Mint', 'var(--green)'], ['sky', 'Sky', 'var(--coder)'], ['pink', 'Blush', 'var(--lab)'],
  ['yellow', 'Sun', 'var(--triager)'], ['coral', 'Coral', 'var(--tester)'], ['ink', 'Ink', 'var(--ink)'],
]
const exampleTime = (clock?: string) => new Date(2026, 0, 1, 14, 32).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: clock === '12h' })
const DEFAULTS: Prefs = {
  look: 'plain', accent: 'green', canvas: 'white', font: 'grotesk', corners: 'round', textSize: 'default', density: 'comfortable',
  sidebar: 'full', logo: 'alive', toasts: 'br', cursor: 'swarm', sounds: 'off', confirm: 'ask', times: 'relative', pins: [], motion: 'system', clock: '24h', weekStart: 'mon',
}

export function Appearance() {
  const { user } = useAuth()
  const toast = useToast()
  const prefs = usePrefs(user?.uid) ?? {}
  const { data: repos } = useRepos(user?.uid)
  const save = (patch: Prefs) => { if (user) savePrefs(user.uid, patch).catch(() => toast.error('Couldn’t save that', 'Check your connection and try again.')) }
  const accent = prefs.accent ?? 'green'
  const { mode } = useMode()
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
          <PrefRow title="Mode" text="Light or dark, for the whole site. Auto follows your device as it changes.">
            <Seg id="ap-mode" value={mode} onPick={(v) => setMode(v as Mode)} options={[['light', 'Light'], ['dark', 'Dark'], ['system', 'Auto']]} />
          </PrefRow>
          <div className="pref pref--stack">
            <div className="pref-copy"><b>Themes</b><span>A whole look in one click, each with a backdrop of its own. Fine-tune any part of it below.</span></div>
            <div className="ap-themes" role="radiogroup" aria-label="Theme">
              {THEMES.map((t) => {
                const on = (prefs.look ?? 'plain') === t.id
                return (
                  <motion.button key={t.id} role="radio" aria-checked={on} className={`ap-theme look-${t.id} canvas-${t.look.canvas} ${on ? 'on' : ''}`} data-accent={t.look.accent} whileTap={{ scale: 0.96 }}
                    onClick={(e) => {
                      if (on) return
                      // painted synchronously inside the transition (the save shows before Firestore answers)
                      morph(() => flushSync(() => save(t.look)), { x: e.clientX, y: e.clientY })
                      toast.ok(`${t.name} it is`, t.says + '.')
                    }}>
                    <span className="ap-theme-face">
                      <LookFx look={t.id} mini />
                      <span className="ap-theme-ui" style={{ fontFamily: `var(--ff-${t.look.font})` }}>
                        <b>Aa</b>
                        <em /><em />
                      </span>
                      <span className="ap-theme-swatch">{t.swatch.map((c, k) => <i key={k} style={{ background: c }} />)}</span>
                      <AnimatePresence>{on && <motion.span className="ap-theme-tick" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 20 }}>✓</motion.span>}</AnimatePresence>
                    </span>
                    <span className="ap-theme-name"><b>{t.name}</b><small>{t.says}</small></span>
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
          <PrefRow title="Typeface" text="The letters everything is set in. Each theme brings its own; pick another any time." stack>
            <div className="ap-fonts" role="radiogroup" aria-label="Typeface">
              {FONTS.map(([id, name]) => (
                <button key={id} role="radio" aria-checked={(prefs.font ?? 'grotesk') === id} className={`ap-font ${(prefs.font ?? 'grotesk') === id ? 'on' : ''}`}
                  onClick={() => save({ font: id })} style={{ fontFamily: id === 'mono' ? 'var(--font-mono)' : `var(--ff-${id})` }}>
                  <b>Ag</b><span>{name}</span>
                </button>
              ))}
            </div>
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

      <Notifications prefs={prefs} save={save} />

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
      style={custom ? { ['--accent' as string]: prefs.accentHex, ['--accent-soft' as string]: `color-mix(in srgb, ${prefs.accentHex} 22%, var(--white))`, ['--accent-line' as string]: `color-mix(in srgb, ${prefs.accentHex} 55%, transparent)` } : undefined}>
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

/* ------------------------------------------------------------------ notifications */

const SPOTS: [NonNullable<Prefs['toasts']>, string][] = [['tl', 'Top left'], ['top', 'Top'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['bottom', 'Bottom'], ['br', 'Bottom right']]
const STYLES: [ToastLook['style'], string, string][] = [
  ['sticker', 'Sticker', 'Ink outline, hard shadow'], ['glass', 'Glass', 'Frosted, soft shadow'],
  ['solid', 'Solid', 'Painted in its colour'], ['minimal', 'Minimal', 'One slim line'],
]
const SAMPLES = [
  (t: ReturnType<typeof useToast>) => t.ok('Fix merged', 'task-031 is on main.'),
  (t: ReturnType<typeof useToast>) => t.error('Couldn’t open the PR', 'GitHub said the branch is protected.'),
  (t: ReturnType<typeof useToast>) => t.info('Quiet hours start at 22:00', 'The agents pause until morning.'),
]

/** Everything about notifications: where, what they look like, how they arrive, how long they stay, and the extras. */
function Notifications({ prefs, save }: { prefs: Prefs; save: (p: Prefs) => void }) {
  const toast = useToast()
  const look: ToastLook = { ...TOAST_LOOK, ...prefs.toastLook }
  const set = (patch: Partial<ToastLook>, show = true) => {
    save({ toastLook: { ...look, ...patch } })
    // show it the way it'll look now (after the new choice reaches the toasts)
    if (show) window.setTimeout(() => SAMPLES[Math.floor(Math.random() * 2) * 2](toast), 60)
  }
  const at = prefs.toasts ?? 'br'
  const working = () => { toast.work('Asking the reviewer…', 'This one turns into the answer.'); window.setTimeout(() => toast.ok('Approved', 'Five checks passed.'), 2200) }
  return (
    <Section title="Notifications" action={<button className="link" onClick={() => { save({ toastLook: TOAST_LOOK, toasts: 'br' }); toast.ok('Notifications reset', 'Back to stickers in the corner.') }}>Reset</button>}>
      <div className="prefs">
        <div className="pref pref--stack">
          <div className="pref-copy"><b>Try them</b><span>Send yourself one of each and see how they arrive.</span></div>
          <div className="nt-try">
            <button className="btn btn-line btn-sm nt-t nt-ok" onClick={() => SAMPLES[0](toast)}><i />Success</button>
            <button className="btn btn-line btn-sm nt-t nt-bad" onClick={() => SAMPLES[1](toast)}><i />Error</button>
            <button className="btn btn-line btn-sm nt-t nt-info" onClick={() => SAMPLES[2](toast)}><i />Info</button>
            <button className="btn btn-line btn-sm nt-t nt-work" onClick={working}><i />Working → done</button>
          </div>
        </div>
        <PrefRow title="Where" text="The corner or edge they arrive at. Pick a spot on the little screen.">
          <div className="nt-screen" role="radiogroup" aria-label="Where notifications arrive">
            {SPOTS.map(([id, label]) => (
              <button key={id} role="radio" aria-checked={at === id} className={`nt-spot nt-${id} ${at === id ? 'on' : ''}`} aria-label={label} data-tip={label}
                onClick={() => { if (at === id) return; save({ toasts: id }); window.setTimeout(() => toast.info(`${label} it is`, 'Notifications land here now.'), 80) }}>
                {at === id && <motion.span layoutId="nt-spot" className="nt-dot" transition={{ type: 'spring', stiffness: 420, damping: 26 }} />}
              </button>
            ))}
          </div>
        </PrefRow>
        <div className="pref pref--stack">
          <div className="pref-copy"><b>Style</b><span>What the card looks like.</span></div>
          <div className="nt-styles" role="radiogroup" aria-label="Notification style">
            {STYLES.map(([id, name, says]) => (
              <motion.button key={id} role="radio" aria-checked={look.style === id} className={`nt-style ${look.style === id ? 'on' : ''}`} whileTap={{ scale: 0.96 }} onClick={() => look.style !== id && set({ style: id })}>
                <span className={`nt-mini nt-mini--${id}`}><i /><b /><em /></span>
                <span className="nt-style-name"><b>{name}</b><small>{says}</small></span>
                <AnimatePresence>{look.style === id && <motion.span className="ap-theme-tick" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 20 }}>✓</motion.span>}</AnimatePresence>
              </motion.button>
            ))}
          </div>
        </div>
        <PrefRow title="Arrival" text="How they come in and leave. Roll is the dot that bursts open into a card.">
          <Seg id="nt-motion" value={look.motion} onPick={(v) => set({ motion: v })} options={[['roll', 'Roll'], ['slide', 'Slide'], ['pop', 'Pop'], ['drop', 'Drop'], ['fade', 'Fade']]} />
        </PrefRow>
        <PrefRow title="Time on screen" text="How long one stays before it goes. Errors stay about twice as long as the rest.">
          <Seg id="nt-time" value={look.time} onPick={(v) => set({ time: v })} options={[['short', 'Short'], ['normal', 'Normal'], ['long', 'Long'], ['stay', 'Until I close it']]} />
        </PrefRow>
        <PrefRow title="Size" text="Compact fits more on screen; large is easier to read from across the room.">
          <Seg id="nt-size" value={look.size} onPick={(v) => set({ size: v })} options={[['compact', 'Compact'], ['regular', 'Regular'], ['large', 'Large']]} />
        </PrefRow>
        <PrefRow title="At most on screen" text="When another arrives, the oldest makes room.">
          <Seg id="nt-stack" value={String(look.stack) as '1' | '3' | '5'} onPick={(v) => set({ stack: Number(v) as 1 | 3 | 5 }, false)} options={[['1', 'One'], ['3', 'Three'], ['5', 'Five']]} />
        </PrefRow>
        <div className="nt-toggles">
          <Toggle on={look.fuse} onFlip={(v) => set({ fuse: v })} title="Countdown bar" text="A thin bar that burns down while it's up." />
          <Toggle on={look.hold} onFlip={(v) => set({ hold: v }, false)} title="Hold while hovering" text="Pointing at one stops its clock." />
          <Toggle on={look.confetti} onFlip={(v) => set({ confetti: v })} title="Confetti" text="A little burst of agent colours on good news." />
          <Toggle on={look.sound} onFlip={(v) => set({ sound: v })} title="Sound" text="A soft chime, pitched by kind." />
          <Toggle on={look.quietOk} onFlip={(v) => { set({ quietOk: v }, false); if (!v) window.setTimeout(() => SAMPLES[0](toast), 60) }} title="Only what needs me" text="Skip the good-news notes; errors and updates still show." />
        </div>
      </div>
    </Section>
  )
}

function Toggle({ on, onFlip, title, text }: { on: boolean; onFlip: (v: boolean) => void; title: string; text: string }) {
  return (
    <label className={`nt-toggle ${on ? 'on' : ''}`}>
      <span className="nt-toggle-copy"><b>{title}</b><span>{text}</span></span>
      <span className="toggle"><input type="checkbox" checked={on} onChange={(e) => onFlip(e.target.checked)} /><span className="toggle-track"><span className="toggle-thumb" /></span></span>
    </label>
  )
}
