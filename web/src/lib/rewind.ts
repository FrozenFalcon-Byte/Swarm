import { useSyncExternalStore } from 'react'
import type { Prefs } from './types'

/* The weekly Rewind: when it's due, and a tiny store that opens it from anywhere (the schedule in the shell,
   Settings, the command bar). Days count from Monday (0) to Sunday (6); times are minutes after midnight,
   in the viewer's own time zone. */

export type RewindWhen = { on: boolean; day: number; minutes: number }
export const REWIND_DEFAULT: RewindWhen = { on: true, day: 4, minutes: 17 * 60 }
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export function rewindWhen(prefs: Prefs | undefined): RewindWhen {
  return { ...REWIND_DEFAULT, ...(prefs?.rewind || {}) }
}

/** The latest time the Rewind was due, at or before `now`. */
export function lastSlot(w: RewindWhen, now = new Date()): Date {
  const d = new Date(now)
  d.setHours(Math.floor(w.minutes / 60), w.minutes % 60, 0, 0)
  const jsDay = (w.day + 1) % 7
  d.setDate(d.getDate() - ((d.getDay() - jsDay + 7) % 7))
  if (d > now) d.setDate(d.getDate() - 7)
  return d
}

export function nextSlot(w: RewindWhen, now = new Date()): Date {
  const d = lastSlot(w, now)
  d.setDate(d.getDate() + 7)
  return d
}

export function clockWords(minutes: number) {
  const h = Math.floor(minutes / 60), m = minutes % 60
  const h12 = h % 12 || 12
  return { h12, m: String(m).padStart(2, '0'), ampm: h < 12 ? 'am' : 'pm', text: `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}` }
}

/* -- who's watching: `slot` is set when the schedule opened it, so closing marks that week as seen */
type State = { open: boolean; slot: string | null }
let state: State = { open: false, slot: null }
const subs = new Set<() => void>()
const set = (s: State) => { state = s; subs.forEach((f) => f()) }
const dismissed = new Set<string>()

export function openRewind(slot: string | null = null) {
  if (state.open || (slot && dismissed.has(slot))) return
  set({ open: true, slot })
}
export function closeRewind() {
  if (state.slot) dismissed.add(state.slot)
  set({ open: false, slot: state.slot })
}
export function useRewind(): State {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => state)
}
