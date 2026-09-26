/* A small, honest in-browser version of what the triager looks for: the handful of patterns that make a
   Python test pass on one run and fail on the next. It reads the code line by line, names each cause,
   explains it, and where the fix is mechanical, writes it. What it can't fix safely it hands to a person. */

export type Cause = 'randomness' | 'hash-order' | 'timing' | 'clock' | 'shared-state' | 'network' | 'masking'

export interface Finding { line: number; cause: Cause; text: string; fix?: string }
export interface Scan { findings: Finding[]; risk: number; fixable: number }

export const CAUSES: Record<Cause, { label: string; color: string; odds: number; why: string }> = {
  randomness: { label: 'Unseeded randomness', color: 'var(--triager)', odds: 0.45, why: 'Random values differ on every run, so the test checks a different case each time.' },
  'hash-order': { label: 'Set or hash order', color: 'var(--coder)', odds: 0.4, why: 'Python randomises string hashing per process, so a set’s order changes between runs.' },
  timing: { label: 'Sleeping and hoping', color: 'var(--tester)', odds: 0.3, why: 'A fixed sleep guesses how long the work takes. On a busy CI machine it takes longer.' },
  clock: { label: 'Real clock', color: 'var(--lab)', odds: 0.15, why: 'The wall clock moves: tests near midnight, month ends or DST see different answers.' },
  'shared-state': { label: 'Shared state', color: 'var(--reviewer)', odds: 0.3, why: 'Module-level data is shared across tests, so results depend on which tests ran first.' },
  network: { label: 'Real network', color: 'var(--sky-card)', odds: 0.2, why: 'Real requests time out, get rate limited and change. The test should not need the internet.' },
  masking: { label: 'Hides the failure', color: 'var(--grey-6)', odds: 0, why: 'Retrying or skipping makes CI green without fixing anything. Swarm rejects patches like this.' },
}

const RULES: { cause: Cause; test: RegExp; text: string }[] = [
  { cause: 'masking', test: /@(pytest\.mark\.flaky|flaky|retry|pytest\.mark\.skip|skip_on_ci)\b/, text: 'Retrying or skipping hides the failure instead of fixing it.' },
  { cause: 'randomness', test: /\brandom\.(random|choice|choices|shuffle|randint|sample|uniform|randrange)\(/, text: 'Draws from the global random generator, which nobody seeded.' },
  { cause: 'randomness', test: /\buuid\.uuid4\(\)/, text: 'A fresh UUID every run; any ordering or comparison on it varies.' },
  { cause: 'hash-order', test: /\b(list|tuple)\(\s*(set\(|\{[^:}]*\}|\w*_?set\b|\w+\.keys\(\))/, text: 'Turns a set into a list, which keeps the set’s run-to-run order.' },
  { cause: 'hash-order', test: /\bnext\(iter\(\s*(set\(|\{)/, text: 'Picks the “first” element of a set, which isn’t fixed.' },
  { cause: 'timing', test: /\b(time\.)?sleep\(\s*[\d.]+\s*\)/, text: 'Waits a fixed time and assumes the work is done.' },
  { cause: 'clock', test: /\b(datetime\.(now|utcnow|today)|date\.today|time\.time)\(\)/, text: 'Reads the real clock, so the answer depends on when the test runs.' },
  { cause: 'network', test: /\b(requests|httpx)\.(get|post|put|delete)\(|\burlopen\(|\bsocket\.socket\(/, text: 'Talks to a real server from inside a test.' },
]

const TOP_STATE = /^([A-Z_a-z]\w*)\s*(:\s*\w+(\[.*\])?\s*)?=\s*(\[\]|\{\}|set\(\)|dict\(\)|list\(\)|\[.+\]|\{.+\})\s*(#.*)?$/

export function scan(code: string): Scan {
  const lines = code.split('\n')
  const findings: Finding[] = []
  const shared = new Map<string, number>()
  lines.forEach((l, i) => {
    const m = l.match(TOP_STATE)
    if (m && !/^[A-Z_]+$/.test(m[1])) shared.set(m[1], i)
  })
  lines.forEach((l, i) => {
    const code = l.replace(/#.*$/, '')
    for (const r of RULES) {
      if (!r.test.test(code)) continue
      if (r.cause === 'randomness' && /random\.Random\(|rng\./.test(code)) continue
      findings.push({ line: i, cause: r.cause, text: r.text, fix: fixLine(r.cause, l, lines.slice(i + 1).find((n) => n.trim())) })
      break
    }
    // a module-level list or dict that a test mutates
    if (/^\s+/.test(l)) for (const [name, at] of shared) {
      if (new RegExp(`\\b${name}\\s*(\\.(append|extend|update|add|pop|clear|setdefault)\\(|\\[[^\\]]+\\]\\s*=)`).test(code) && !findings.some((f) => f.line === at))
        findings.push({ line: at, cause: 'shared-state', text: `${name} lives at module level and a test changes it (line ${i + 1}).` })
    }
  })
  findings.sort((a, b) => a.line - b.line)
  const causes = new Set(findings.map((f) => f.cause))
  const risk = 1 - [...causes].reduce((p, c) => p * (1 - CAUSES[c].odds), 1)
  return { findings, risk, fixable: findings.filter((f) => f.fix !== undefined).length }
}

function fixLine(cause: Cause, line: string, next = ''): string | undefined {
  const indent = line.match(/^\s*/)![0]
  switch (cause) {
    case 'randomness': return line.includes('uuid4') ? undefined : line.replace(/\brandom\.(?=\w+\()/g, 'rng.')
    case 'hash-order': return line.replace(/\b(list|tuple)\(\s*(?=set\(|\{|\w*_?set\b|\w+\.keys\(\))/, 'sorted(').replace(/next\(iter\(\s*(set\(|\{)/, 'min(($1')
    case 'timing': {
      // wait for exactly what the next assert checks, if there is one
      const want = next.match(/^\s*assert\s+(.+?)\s*(#.*)?$/)?.[1]
      return `${indent}wait_until(lambda: ${want || 'done()'}, timeout=5)  # poll instead of guessing how long it takes`
    }
    case 'clock': return line.replace(/\b(datetime\.(now|utcnow|today)|date\.today|time\.time)\(\)/, 'FROZEN_NOW')
    case 'masking': return ''
    default: return undefined
  }
}

/** Apply every mechanical fix, adding the imports and setup lines the fixes need. Returns the new code and the lines it changed. */
export function applyFixes(code: string, s: Scan): { code: string; changed: number[] } {
  const lines = code.split('\n')
  const out: string[] = []
  const changed: number[] = []
  const has = (c: Cause) => s.findings.some((f) => f.cause === c && f.fix !== undefined)
  const byLine = new Map(s.findings.filter((f) => f.fix !== undefined).map((f) => [f.line, f]))
  const header: string[] = []
  if (has('randomness') && !/rng\s*=\s*random\.Random/.test(code)) header.push('rng = random.Random(20240611)  # one seeded generator the tests own')
  if (has('clock') && !code.includes('FROZEN_NOW =')) header.push('FROZEN_NOW = datetime(2026, 1, 15, 12, 0)  # tests see a fixed moment')
  if (has('timing') && !code.includes('def wait_until')) header.push('', 'def wait_until(ready, timeout=5.0, step=0.01):', '    end = time.monotonic() + timeout', '    while not ready():', '        assert time.monotonic() < end, "timed out"', '        time.sleep(step)')
  // setup lines go right after the imports at the top of the file
  const firstCode = lines.findIndex((l) => /^(def|class|@|\w+\s*=)/.test(l))
  let lastImport = -1
  lines.forEach((l, i) => { if (/^(import|from)\s/.test(l) && (firstCode === -1 || i < firstCode)) lastImport = i })
  const put = (l: string, fresh: boolean) => { out.push(l); if (fresh) changed.push(out.length - 1) }
  if (lastImport === -1 && header.length) { header.forEach((h) => put(h, true)); put('', false) }
  lines.forEach((l, i) => {
    const f = byLine.get(i)
    if (!f) put(l, false)
    else if (f.fix !== '') put(f.fix!, true)
    if (i === lastImport && header.length) { put('', false); header.filter((h, k) => h || k).forEach((h) => put(h, !!h)) }
  })
  return { code: out.join('\n'), changed }
}

export const SAMPLES: { id: string; label: string; code: string }[] = [
  { id: 'mixed', label: 'A bit of everything', code: `import random
import time
from datetime import datetime

from shop.cart import Cart, checkout

seen_orders = []


def test_discount_applies():
    cart = Cart()
    for sku in random.sample(["A1", "B2", "C3", "D4"], 2):
        cart.add(sku)
    assert cart.total() > 0


def test_tags_are_listed_in_order():
    tags = list(set(["fast", "cheap", "good"]))
    assert tags == ["cheap", "fast", "good"]


def test_checkout_sends_receipt():
    order = checkout(Cart(), when=datetime.now())
    seen_orders.append(order.id)
    time.sleep(0.5)
    assert order.receipt_sent
` },
  { id: 'order', label: 'Set order', code: `from tagkit import normalise


def test_normalise_dedupes():
    tags = normalise(["b", "a", "b", "c"])
    assert list(set(tags)) == ["a", "b", "c"]


def test_first_tag_is_primary():
    primary = next(iter({"python", "testing"}))
    assert primary == "python"
` },
  { id: 'timing', label: 'Sleeps', code: `import time

from jobs import Queue


def test_job_finishes():
    q = Queue()
    job = q.submit(lambda: 2 + 2)
    time.sleep(0.2)
    assert job.result == 4
` },
  { id: 'masked', label: 'Retried', code: `import random
import pytest


@pytest.mark.flaky(reruns=3)
def test_pick_winner():
    winner = random.choice(["ana", "bo", "cy"])
    assert winner in {"ana", "bo"}
` },
  { id: 'clean', label: 'Already solid', code: `import random

from tagkit import normalise


def test_normalise_is_sorted():
    rng = random.Random(7)
    tags = [rng.choice("abc") for _ in range(20)]
    assert normalise(tags) == sorted(set(tags))
` },
]

/** A small seeded generator for the simulated runs. */
export function seeded(seed: number) {
  let h = seed >>> 0 || 1
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000 }
}
export function hashText(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
