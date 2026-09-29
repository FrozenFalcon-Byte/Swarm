import { motion } from 'motion/react'
import { useState } from 'react'
import { useToast } from '../../components/Island'
import { ALERT_KINDS, alertWanted, HEADLINE, inAppOn, titleCountOn, type AlertKind } from '../../lib/alerts'
import { useAuth } from '../../lib/auth'
import { savePrefs, usePrefs, useRepos } from '../../lib/data'
import { pop } from '../../lib/sound'
import type { Prefs } from '../../lib/types'
import { PrefRow } from './ProfileExtras'
import { Section } from './ui'

/* Settings → Notifications: what alerts you, how it reaches you, and which repositories stay quiet. */

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
  const kinds = ALERT_KINDS.filter((k) => alertWanted(prefs, k.id))

  const test = () => {
    const k = kinds[0]?.id ?? 'ready'
    const body = 'This is a test. Real alerts name the repository and the task.'
    if (inAppOn(prefs)) toast[ALERT_KINDS.find((a) => a.id === k)!.tone](HEADLINE[k], body)
    if (browserOn) new Notification(HEADLINE[k], { body, icon: '/favicon.svg' })
    if (prefs.alertSound) pop(1.2)
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
          <PrefRow title="Play a sound" text="A soft pop with each alert.">
            <Toggle on={!!prefs.alertSound} onChange={(v) => { if (v) pop(1.2); void save({ alertSound: v }) }} />
          </PrefRow>
          <PrefRow title="Count in the tab title" text="Shows how many things need you, like (3) Overview · Swarm.">
            <Toggle on={titleCountOn(prefs)} onChange={(v) => void save({ titleCount: v })} />
          </PrefRow>
        </div>
      </Section>

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
