import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { TOAST_LOOK, useToast, type ToastLook } from '../../components/Island'
import { ALERT_KINDS, alertWanted, HEADLINE, inAppOn, titleCountOn, type AlertKind } from '../../lib/alerts'
import { useAuth } from '../../lib/auth'
import { savePrefs, usePrefs, useRepos } from '../../lib/data'
import { pop } from '../../lib/sound'
import type { Prefs } from '../../lib/types'
import { PrefRow, Seg } from './ProfileExtras'
import { Section } from './ui'

/* Settings → Notifications: what alerts you, how it reaches you, how the notes look, and which repositories stay quiet. */

type Perm = NotificationPermission | 'unsupported'
const readPerm = (): Perm => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)

export function Notifications() {
  const { user } = useAuth()
  const prefs = usePrefs(user?.uid) ?? {}
  const { data: repos } = useRepos(user?.uid)
  const toast = useToast()
  const [perm, setPerm] = useState<Perm>(readPerm)
  const save = async (patch: Partial<Prefs>) => {
    if (!user) return
    try { await savePrefs(user.uid, patch) } catch { toast.error('Couldn’t save that', 'Check your connection and try again.') }
  }

  const browserOn = !!prefs.notify && perm === 'granted'
  const toggleBrowser = async (on: boolean) => {
    if (on && perm !== 'granted') {
      if (perm === 'unsupported') return void toast.error('Not available here', 'This browser can’t show notifications.')
      const p = await Notification.requestPermission()
      setPerm(p)
      if (p !== 'granted') return void toast.error('Notifications are blocked', 'Allow them for this site in your browser settings.')
    }
    await save({ notify: on })
  }
  const toggleKind = (k: AlertKind) => save({ alertOn: { ...prefs.alertOn, [k]: !alertWanted(prefs, k) } })
  const mute = new Set(prefs.alertMute ?? [])
  const toggleMute = (id: string) => {
    const next = new Set(mute)
    if (next.has(id)) next.delete(id); else next.add(id)
    void save({ alertMute: [...next] })
  }
  const soundOn = !!prefs.alertSound || !!prefs.toastLook?.sound
  const kinds = ALERT_KINDS.filter((k) => alertWanted(prefs, k.id))

  const test = () => {
    const k = kinds[0]?.id ?? 'ready'
    const body = 'This is a test. Real alerts name the repository and the task.'
    if (inAppOn(prefs)) toast[ALERT_KINDS.find((a) => a.id === k)!.tone](HEADLINE[k], body)
    if (browserOn) new Notification(HEADLINE[k], { body, icon: '/favicon.svg' })
    if (browserOn && soundOn && !inAppOn(prefs)) pop(1.2)
    if (!inAppOn(prefs) && !browserOn) toast.info('Nothing would reach you', 'Turn on notes in Swarm or browser notifications first.')
  }

  return (
    <div className="nt">
      <Section title="Tell me when" action={<span className="muted">{kinds.length} of {ALERT_KINDS.length} on</span>}>
        <div className="nt-kinds">
          {ALERT_KINDS.map((k, i) => {
            const on = alertWanted(prefs, k.id)
            return (
              <motion.button key={k.id} className={`nt-kind ${on ? 'on' : ''}`} style={{ '--c': `var(--${k.agent})` } as React.CSSProperties} aria-pressed={on}
                onClick={() => void toggleKind(k.id)} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, duration: 0.4 }}
                whileTap={{ scale: 0.97 }}>
                <span className="nt-kind-dot" aria-hidden="true">
                  <motion.svg viewBox="0 0 24 24" initial={false} animate={{ scale: on ? 1 : 0, opacity: on ? 1 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 24 }}>
                    <path d="M6 12.5l4 4 8-9" fill="none" stroke="#0f0f0f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </motion.svg>
                </span>
                <span className="nt-kind-copy"><b>{k.label}</b><span>{k.text}</span></span>
              </motion.button>
            )
          })}
        </div>
      </Section>

      <Section title="How it reaches you" action={<button className="btn btn-line btn-sm" onClick={test}>Send a test</button>}>
        <div className="prefs">
          <PrefRow title="A note in Swarm" text="When Swarm is the tab you’re looking at, a note slides in.">
            <Toggle on={inAppOn(prefs)} onChange={(v) => void save({ alertInApp: v })} />
          </PrefRow>
          <PrefRow title="Browser notifications" text={perm === 'denied' ? 'Blocked for this site. Allow notifications in your browser’s site settings, then switch this on.' : 'When Swarm is open in a background tab, your system shows a notification.'}>
            <Toggle on={browserOn} onChange={(v) => void toggleBrowser(v)} />
          </PrefRow>
          <PrefRow title="Play a sound" text="A soft chime with each note, pitched by kind, and a pop with browser notifications.">
            <Toggle on={soundOn} onChange={(v) => { if (v) pop(1.2); void save({ alertSound: v, toastLook: { ...TOAST_LOOK, ...prefs.toastLook, sound: v } }) }} />
          </PrefRow>
          <PrefRow title="Count in the tab title" text="Shows how many things need you, like (3) Overview · Swarm.">
            <Toggle on={titleCountOn(prefs)} onChange={(v) => void save({ titleCount: v })} />
          </PrefRow>
        </div>
      </Section>

      <NoteLook prefs={prefs} save={(p) => void save(p)} />

      <Section title="Repositories" action={<span className="muted">{mute.size ? `${mute.size} muted` : 'all on'}</span>}>
        {!repos.length && <p className="muted-p">Connect a repository and you can choose which ones alert you.</p>}
        <ul className="nt-repos">
          {repos.map((r) => (
            <li key={r.id} className={mute.has(r.id) ? 'is-muted' : ''}>
              <span className="nt-repo-name"><b>{r.displayName || r.fullName}</b><span className="mono">{r.fullName}</span></span>
              <Toggle on={!mute.has(r.id)} onChange={() => toggleMute(r.id)} label={mute.has(r.id) ? 'Muted' : 'Alerts'} />
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track"><span className="toggle-thumb" /></span>
      {label && <span>{label}</span>}
    </label>
  )
}

/* ------------------------------------------------------------------ how notes look (moved here from Appearance) */

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

/** How the notes in Swarm look: where, what they look like, how they arrive, how long they stay, and the extras. */
function NoteLook({ prefs, save }: { prefs: Prefs; save: (p: Partial<Prefs>) => void }) {
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
    <Section title="How notes look" action={<button className="link" onClick={() => { save({ toastLook: TOAST_LOOK, toasts: 'br' }); toast.ok('Notes reset', 'Back to stickers in the corner.') }}>Reset</button>}>
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
          <LookToggle on={look.fuse} onFlip={(v) => set({ fuse: v })} title="Countdown bar" text="A thin bar that burns down while it's up." />
          <LookToggle on={look.hold} onFlip={(v) => set({ hold: v }, false)} title="Hold while hovering" text="Pointing at one stops its clock." />
          <LookToggle on={look.confetti} onFlip={(v) => set({ confetti: v })} title="Confetti" text="A little burst of agent colours on good news." />
          <LookToggle on={look.quietOk} onFlip={(v) => { set({ quietOk: v }, false); if (!v) window.setTimeout(() => SAMPLES[0](toast), 60) }} title="Only what needs me" text="Skip the good-news notes; errors and updates still show." />
        </div>
      </div>
    </Section>
  )
}

function LookToggle({ on, onFlip, title, text }: { on: boolean; onFlip: (v: boolean) => void; title: string; text: string }) {
  return (
    <label className={`nt-toggle ${on ? 'on' : ''}`}>
      <span className="nt-toggle-copy"><b>{title}</b><span>{text}</span></span>
      <span className="toggle"><input type="checkbox" checked={on} onChange={(e) => onFlip(e.target.checked)} /><span className="toggle-track"><span className="toggle-thumb" /></span></span>
    </label>
  )
}
