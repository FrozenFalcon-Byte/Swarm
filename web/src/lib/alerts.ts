import type { Prefs, TaskState } from './types'
import { pop } from './sound'

/* What can alert you, and how: shared by the alerts hook in AppShell and Settings → Notifications. */

export type AlertKind = 'ready' | 'needsYou' | 'merged' | 'rejected'

export const ALERT_KINDS: { id: AlertKind; state: TaskState; label: string; text: string; agent: string; tone: 'ok' | 'info' | 'error' }[] = [
  { id: 'ready', state: 'Approved', label: 'Ready to merge', text: 'A fix passed review and is waiting for you', agent: 'reviewer', tone: 'ok' },
  { id: 'needsYou', state: 'Needs Human', label: 'Needs you', text: 'A task stopped and asked for a person', agent: 'triager', tone: 'info' },
  { id: 'merged', state: 'Merged', label: 'Merged', text: 'A fix landed in the repository', agent: 'coder', tone: 'ok' },
  { id: 'rejected', state: 'Rejected', label: 'Sent back', text: 'The reviewer turned a fix down for another try', agent: 'tester', tone: 'error' },
]

const DEFAULT_ON: Record<AlertKind, boolean> = { ready: true, needsYou: true, merged: false, rejected: false }

export const alertWanted = (prefs: Prefs | undefined, kind: AlertKind) => prefs?.alertOn?.[kind] ?? DEFAULT_ON[kind]
export const inAppOn = (prefs: Prefs | undefined) => prefs?.alertInApp !== false
export const titleCountOn = (prefs: Prefs | undefined) => prefs?.titleCount !== false
export const kindOf = (state: TaskState) => ALERT_KINDS.find((k) => k.state === state)

export const HEADLINE: Record<AlertKind, string> = {
  ready: 'A fix is ready to merge', needsYou: 'A task needs you', merged: 'A fix was merged', rejected: 'A fix was sent back',
}

export type Toaster = { ok(t: string, b?: string): number; info(t: string, b?: string): number; error(t: string, b?: string): number }

/** Deliver one alert the way the settings ask: a browser notification while Swarm is in the background,
 *  a note in the app while it's in front, and a pop with either if sounds are on. */
export function deliver(prefs: Prefs | undefined, toast: Toaster, kind: AlertKind, body: string, href?: string) {
  const meta = ALERT_KINDS.find((k) => k.id === kind)!
  let shown = false
  if (document.hidden) {
    if (prefs?.notify && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const n = new Notification(HEADLINE[kind], { body, icon: '/favicon.svg', tag: href || kind })
      if (href) n.onclick = () => { window.focus(); window.location.assign(href) }
      shown = true
    }
  } else if (inAppOn(prefs)) {
    toast[meta.tone](HEADLINE[kind], body)
    shown = true
  }
  if (shown && prefs?.alertSound) pop(kind === 'rejected' ? 0.8 : 1.2)
  return shown
}
