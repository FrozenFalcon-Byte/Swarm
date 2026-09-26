import type { HouseRule } from './types'

/* The same matcher as swarm/houserules.py, so what you try on the House rules page is what the reviewer
   does: `*` stays inside a folder, `**` crosses folders, a bare name matches at any depth, a trailing slash
   means everything under that folder, and a leading slash pins the pattern to the repository root. */

const cache = new Map<string, RegExp>()
export function globRegex(pattern: string): RegExp {
  const hit = cache.get(pattern)
  if (hit) return hit
  let p = pattern.trim().replace(/\\/g, '/')
  const anchored = p.startsWith('/')
  p = p.replace(/^\/+/, '')
  if (p.endsWith('/')) p += '**'
  let out = ''
  for (let i = 0; i < p.length;) {
    if (p.startsWith('**/', i)) { out += '(?:.*/)?'; i += 3 }
    else if (p.startsWith('**', i)) { out += '.*'; i += 2 }
    else if (p[i] === '*') { out += '[^/]*'; i += 1 }
    else if (p[i] === '?') { out += '[^/]'; i += 1 }
    else { out += p[i].replace(/[.+^${}()|[\]\\]/g, '\\$&'); i += 1 }
  }
  if (!anchored && !p.replace(/\*+$/, '').includes('/')) out = '(?:.*/)?' + out
  const rx = new RegExp(`^${out}$`)
  cache.set(pattern, rx)
  return rx
}

export const matches = (pattern: string, path: string) => !!pattern.trim() && globRegex(pattern).test(path.replace(/^\.?\/+/, ''))

/** Files a unified diff touches, and how many lines it adds or removes. */
export function diffShape(diff: string) {
  const files: string[] = []
  let lines = 0
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) { const f = l.slice(4).replace(/^b\//, '').trim(); if (f !== '/dev/null') files.push(f) }
    else if (l.startsWith('--- ')) continue
    else if (l.startsWith('+') || l.startsWith('-')) lines++
  }
  return { files, lines }
}

export type Outcome = 'pass' | 'ask' | 'stop'
export interface Judgement { outcome: Outcome; by: { rule: HouseRule; files: string[] }[] }

/** What the reviewer would say about a fix under these rules. */
export function judge(rules: HouseRule[], files: string[], lines: number): Judgement {
  const by: Judgement['by'] = []
  for (const rule of rules) {
    if (!rule.on) continue
    if (rule.kind === 'size') { if (rule.max && lines > rule.max) by.push({ rule, files: [] }); continue }
    const hit = files.filter((f) => matches(rule.glob || '', f))
    if (hit.length) by.push({ rule, files: hit })
  }
  const outcome: Outcome = by.some((b) => b.rule.kind !== 'ask') ? 'stop' : by.length ? 'ask' : 'pass'
  return { outcome, by }
}

export const RULE_KINDS: Record<HouseRule['kind'], { label: string; verb: string; color: string; soft: string; says: string }> = {
  never: { label: 'Never touch', verb: 'never touch', color: 'var(--tester)', soft: 'var(--coral-soft)', says: 'The reviewer sends the fix back and the coder tries another way.' },
  ask: { label: 'Ask me first', verb: 'ask me first', color: 'var(--triager)', soft: 'var(--yellow-soft)', says: 'The fix can pass every check and still waits for you.' },
  size: { label: 'Keep it under', verb: 'keep fixes under', color: 'var(--coder)', soft: 'var(--sky-soft)', says: 'Bigger fixes go back to the coder to be made smaller.' },
}

/** Monday-first hour of the week (0–167) and minutes past the hour, right now, in a time zone. */
export function weekHour(tz: string, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at)
  const get = (t: string) => parts.find((p) => p.type === t)?.value || ''
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday'))
  return { index: Math.max(0, day) * 24 + (Number(get('hour')) % 24), minute: Number(get('minute')) || 0 }
}
