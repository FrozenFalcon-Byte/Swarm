import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CodeWindow } from '../../components/CodeWindow'
import { useAuth } from '../../lib/auth'
import { useBootHold } from '../../lib/boot'
import { useAllTasks, useRepos } from '../../lib/data'
import { easeOut } from '../../lib/motion'
import type { Task } from '../../lib/types'
import { PageHead } from './Overview'
import { rise } from './repoDraft'

/*
 * Whodunit: a test failed at random, and you get the case file (the code as it was before the fix). Four
 * suspects, the same four kinds of random failure the agents look for. Accuse one, then see what the agents
 * found: the cause, the runs before and after, and the fix. Cases come from your own solved tasks, with
 * training cases for when you have few. Your record stays in this browser.
 */

type Kind = 'hash-order' | 'rng' | 'time' | 'shared-state'
type Case = {
  id: string; file: string; test: string; title: string; scene: string; kind: Kind; why: string; fix: string
  real?: { repoId: string; taskId: string; repo: string }; runs?: { before: string; after: string }
}
type Record_ = { results: Record<string, 'hit' | 'miss'>; streak: number; best: number }

const SUSPECTS: { id: Kind; name: string; alias: string; tell: string; c: string }[] = [
  { id: 'hash-order', name: 'Order from a set', alias: 'the shuffler', tell: 'Sets and dicts of hashes don’t promise an order.', c: 'var(--triager)' },
  { id: 'rng', name: 'Randomness', alias: 'the gambler', tell: 'A random draw that’s usually fine, until it isn’t.', c: 'var(--coder)' },
  { id: 'time', name: 'The clock', alias: 'the timekeeper', tell: 'Two calls in the same second, or a deadline too tight.', c: 'var(--tester)' },
  { id: 'shared-state', name: 'Leftover state', alias: 'the lodger', tell: 'Something one test left behind for the next.', c: 'var(--reviewer)' },
]
const RANKS: [number, string][] = [[0, 'Rookie'], [3, 'Sleuth'], [8, 'Inspector'], [15, 'Chief inspector'], [25, 'Legend']]
const KEY = 'swarm.whodunit'

const TRAINING: Case[] = [
  { id: 't1', file: 'tags.py', test: 'test_unique_tags', title: 'Tag list comes back in the wrong order sometimes', kind: 'hash-order',
    scene: 'def unique_tags(post):\n    return list(set(post.tags))\n\n\ndef test_unique_tags():\n    post = Post(tags=["b", "a", "c", "a"])\n    assert unique_tags(post) == ["a", "b", "c"]',
    why: 'A set of strings has no fixed order, and string hashing changes between runs. The test only passes when the set happens to come out sorted.',
    fix: '-    return list(set(post.tags))\n+    return sorted(set(post.tags))' },
  { id: 't2', file: 'retry.py', test: 'test_backoff_stays_short', title: 'Backoff test fails about one run in six', kind: 'rng',
    scene: 'def backoff(attempt, base=0.6):\n    return base * attempt + random.uniform(0, 1)\n\n\ndef test_backoff_stays_short():\n    assert backoff(1) < 1.5',
    why: 'The jitter can be anything up to a whole second, so whenever the draw lands above 0.9 the delay goes past the limit.',
    fix: '-    return base * attempt + random.uniform(0, 1)\n+    return base * attempt + random.uniform(0, base / 2)' },
  { id: 't3', file: 'tokens.py', test: 'test_tokens_are_unique', title: 'Two tokens came out the same', kind: 'time',
    scene: 'def make_token(user):\n    return f"{user}-{int(time.time())}"\n\n\ndef test_tokens_are_unique():\n    assert make_token("ada") != make_token("ada")',
    why: 'Both calls usually land inside the same second, so the timestamp is identical. It only passes when the clock ticks over between them.',
    fix: '-    return f"{user}-{int(time.time())}"\n+    return f"{user}-{uuid.uuid4().hex}"' },
  { id: 't4', file: 'cache.py', test: 'test_cache_starts_empty', title: 'Cache test fails when the whole suite runs', kind: 'shared-state',
    scene: '_CACHE = {}\n\n\ndef remember(key, value):\n    _CACHE[key] = value\n\n\ndef test_remember():\n    remember("a", 1)\n    assert _CACHE["a"] == 1\n\n\ndef test_cache_starts_empty():\n    assert _CACHE == {}',
    why: 'The cache lives at module level. When test_remember runs first, it leaves an entry behind, and the next test finds it.',
    fix: '+@pytest.fixture(autouse=True)\n+def clean_cache():\n+    _CACHE.clear()' },
  { id: 't5', file: 'report.py', test: 'test_header', title: 'Report header columns swap places', kind: 'hash-order',
    scene: 'COLUMNS = {"name", "email", "role"}\n\n\ndef header():\n    return ", ".join(COLUMNS)\n\n\ndef test_header():\n    assert header() == "name, email, role"',
    why: 'Joining a set gives its items in hash order, which differs between runs.',
    fix: '-COLUMNS = {"name", "email", "role"}\n+COLUMNS = ("name", "email", "role")' },
  { id: 't6', file: 'timer.py', test: 'test_quick_job', title: 'Timing test fails on a busy machine', kind: 'time',
    scene: 'def test_quick_job():\n    start = time.monotonic()\n    run_job(sleep=0.05)\n    assert time.monotonic() - start < 0.06',
    why: 'A 10 ms margin is nothing on a loaded CI box. Any hiccup in scheduling pushes it over.',
    fix: '-    assert time.monotonic() - start < 0.06\n+    assert job_calls == 1  # check what it did, not how fast' },
  { id: 't7', file: 'pool.py', test: 'test_picks_primary', title: 'Sometimes it talks to the wrong server', kind: 'rng',
    scene: 'SERVERS = ["primary", "replica"]\n\n\ndef pick():\n    return random.choice(SERVERS)\n\n\ndef test_picks_primary():\n    assert pick() == "primary"',
    why: 'random.choice picks either server; the test assumes it always picks the first. Half the runs fail.',
    fix: '-def pick():\n-    return random.choice(SERVERS)\n+def pick(rng=random):\n+    return rng.choice(SERVERS)' },
  { id: 't8', file: 'settings.py', test: 'test_default_mode', title: 'Default mode is wrong after other tests', kind: 'shared-state',
    scene: 'def test_debug_mode():\n    os.environ["MODE"] = "debug"\n    assert load().debug\n\n\ndef test_default_mode():\n    assert load().mode == "production"',
    why: 'The first test sets an environment variable and never puts it back, so the second one only passes if it runs first.',
    fix: '-def test_debug_mode():\n-    os.environ["MODE"] = "debug"\n+def test_debug_mode(monkeypatch):\n+    monkeypatch.setenv("MODE", "debug")' },
]

/** The code as it was before the fix: the diff without its added lines. */
function sceneOf(diff: string) {
  const lines = diff.split('\n')
  const file = lines.find((l) => l.startsWith('+++ '))?.replace(/^\+\+\+ (b\/)?/, '') || 'test.py'
  const scene = lines.filter((l) => !/^(\+\+\+|---|@@|diff |index |\\)/.test(l) && !l.startsWith('+')).map((l) => l.slice(1)).join('\n').trim()
  const fix = lines.filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l)).join('\n')
  return { file, scene, fix }
}

function fromTasks(tasks: (Task & { repoId: string })[], repoName: (id: string) => string): Case[] {
  return tasks.flatMap((t) => {
    const kind = t.artifacts.flakiness_source as Kind | undefined
    if (!kind || !SUSPECTS.some((s) => s.id === kind) || !t.artifacts.diff_text) return []
    const { file, scene, fix } = sceneOf(t.artifacts.diff_text)
    if (!scene) return []
    const ev = Object.values(t.artifacts.test_summary?.harness?.evidence || {})[0]
    return [{
      id: `${t.repoId}:${t.task_id}`, file, scene, fix, kind, title: t.title,
      test: (t.artifacts.test_ids?.[0] || t.task_id).split('::').pop() || t.task_id,
      why: t.artifacts.root_cause || t.artifacts.strategy || 'The agents found the cause and fixed it.',
      real: { repoId: t.repoId, taskId: t.task_id, repo: repoName(t.repoId) },
      runs: ev?.before?.runs ? { before: `${ev.before.failures ?? '?'}/${ev.before.runs}`, after: `${ev.after?.failures ?? '?'}/${ev.after?.runs ?? '?'}` } : undefined,
    }]
  })
}

function load(): Record_ {
  try { return { results: {}, streak: 0, best: 0, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { results: {}, streak: 0, best: 0 } }
}

export default function Whodunit() {
  const { user } = useAuth()
  const { data: repos, loading } = useRepos(user?.uid)
  useBootHold(loading)
  const tasks = useAllTasks(repos.map((r) => r.id))
  const cases = useMemo(() => [...fromTasks(tasks, (id) => repos.find((r) => r.id === id)?.displayName || 'your repo'), ...TRAINING], [tasks, repos])
  const [rec, setRec] = useState<Record_>(load)
  const [pick, setPick] = useState<string | null>(null)
  const open = cases.find((c) => c.id === pick) || cases.find((c) => !rec.results[c.id]) || cases[0]
  const [accused, setAccused] = useState<Kind | null>(null)

  const solved = Object.values(rec.results).filter((r) => r === 'hit').length
  const rank = [...RANKS].reverse().find(([n]) => solved >= n)![1]
  const next = RANKS.find(([n]) => n > solved)
  const done = rec.results[open.id]
  const verdict = accused ?? (done ? (done === 'hit' ? open.kind : null) : null)

  const save = (r: Record_) => { setRec(r); try { localStorage.setItem(KEY, JSON.stringify(r)) } catch { /* private window: this visit only */ } }
  const accuse = (k: Kind) => {
    if (accused || done) return
    setAccused(k)
    const hit = k === open.kind
    const streak = hit ? rec.streak + 1 : 0
    save({ results: { ...rec.results, [open.id]: hit ? 'hit' : 'miss' }, streak, best: Math.max(rec.best, streak) })
  }
  const goTo = (id: string) => { setPick(id); setAccused(null) }
  const nextCase = () => {
    const i = cases.findIndex((c) => c.id === open.id)
    const after = [...cases.slice(i + 1), ...cases.slice(0, i)]
    goTo((after.find((c) => !rec.results[c.id] && c.id !== open.id) || after[0] || open).id)
  }
  const revealed = !!(accused || done)
  const guessed = accused || null

  return (
    <div className="page wd-page">
      <PageHead title="Whodunit" sub="A test failed at random. You have the case file and four suspects. The agents already know who did it." />

      <motion.div className="wd-board" {...rise(0)}>
        <div className="wd-rank"><span className="wd-badge">{rank.slice(0, 1)}</span><div><b>{rank}</b><span>{next ? `${next[0] - solved} more solved to ${next[1]}` : 'Top rank'}</span></div></div>
        <div className="wd-num"><b>{solved}</b><span>solved</span></div>
        <div className="wd-num"><b>{rec.streak}</b><span>in a row</span></div>
        <div className="wd-num"><b>{rec.best}</b><span>best streak</span></div>
        <div className="wd-num"><b>{cases.length - Object.keys(rec.results).filter((id) => cases.some((c) => c.id === id)).length}</b><span>cases open</span></div>
      </motion.div>

      <div className="wd-stage">
        <motion.section className="wd-file" {...rise(1)}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={open.id} className="wd-file-in" initial={{ opacity: 0, x: 24, rotate: 0.6 }} animate={{ opacity: 1, x: 0, rotate: 0 }} exit={{ opacity: 0, x: -24, rotate: -0.6 }} transition={{ duration: 0.4, ease: easeOut }}>
              <header>
                <span className="wd-tag">{open.real ? `Case from ${open.real.repo}` : 'Training case'}</span>
                <span className="wd-caseno mono">No. {String(cases.findIndex((c) => c.id === open.id) + 1).padStart(3, '0')}</span>
              </header>
              <h2>{open.title}</h2>
              <p className="wd-test mono">{open.test}{open.runs && <span> · failed {open.runs.before} runs</span>}</p>
              <CodeWindow title={open.file} code={open.scene} lang={open.file.endsWith('.py') ? 'python' : undefined} maxHeight="300px" />
            </motion.div>
          </AnimatePresence>
        </motion.section>

        <motion.section className="wd-suspects" {...rise(2)}>
          <header><h2>{revealed ? (verdict === open.kind || done === 'hit' ? 'Case closed.' : 'Not quite.') : 'Who did it?'}</h2><span className="muted">{revealed ? 'Here is what the agents found.' : 'Pick the suspect you think broke the test.'}</span></header>
          <ul>
            {SUSPECTS.map((s, i) => {
              const guilty = revealed && s.id === open.kind
              const wrong = revealed && guessed === s.id && s.id !== open.kind
              return (
                <motion.li key={`${open.id}-${s.id}`} initial={{ opacity: 0, y: 10 }} animate={wrong ? { opacity: 1, y: 0, x: [0, -8, 8, -5, 5, 0] } : { opacity: 1, y: 0 }}
                  transition={wrong ? { duration: 0.45 } : { duration: 0.4, ease: easeOut, delay: 0.05 + i * 0.05 }}>
                  <button type="button" className={`wd-suspect ${guilty ? 'is-guilty' : ''} ${wrong ? 'is-wrong' : ''} ${revealed && !guilty && !wrong ? 'is-cleared' : ''}`}
                    style={{ ['--c' as string]: s.c }} onClick={() => accuse(s.id)} disabled={revealed} aria-pressed={guessed === s.id}>
                    <span className="wd-mug" aria-hidden="true"><i /><i /><em /></span>
                    <span className="wd-who"><b>{s.name}</b><small>{s.alias}</small><span>{s.tell}</span></span>
                    <AnimatePresence>
                      {(guilty || wrong) && (
                        <motion.span className={`wd-stamp ${guilty ? 'is-guilty' : ''}`} initial={{ scale: 2.2, opacity: 0, rotate: -24 }} animate={{ scale: 1, opacity: 1, rotate: -10 }}
                          transition={{ type: 'spring', stiffness: 420, damping: 18, delay: guilty && guessed && guessed !== s.id ? 0.35 : 0 }}>
                          {guilty ? 'Guilty' : 'Alibi'}
                        </motion.span>
                      )}
                    </AnimatePresence>
                    {guilty && guessed === s.id && <span className="wd-burst" aria-hidden="true">{SUSPECTS.concat(SUSPECTS).map((x, k) => <i key={k} style={{ background: x.c, ['--a' as string]: `${k * 45 + 10}deg` }} />)}</span>}
                  </button>
                </motion.li>
              )
            })}
          </ul>

          <AnimatePresence initial={false}>
            {revealed && (
              <motion.div key={open.id} className="wd-reveal" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.5, ease: easeOut }}>
                <div className="wd-reveal-in">
                  <p>{open.why}</p>
                  {open.runs && <p className="wd-runs mono">Failing runs: {open.runs.before} before the fix → {open.runs.after} after</p>}
                  <CodeWindow title="The fix" code={open.fix} lang="diff" maxHeight="220px" />
                  <div className="wd-reveal-foot">
                    {open.real && <Link className="btn btn-line btn-sm" to={`/app/repos/${open.real.repoId}/tasks/${open.real.taskId}`}>Open {open.real.taskId}</Link>}
                    <button className="btn btn-dark btn-sm" onClick={nextCase}>Next case</button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>
      </div>

      <motion.section className="wd-archive" {...rise(3)}>
        <h2>Case archive</h2>
        <div className="wd-chips">
          {cases.map((c, i) => (
            <button key={c.id} type="button" className={`wd-chip ${c.id === open.id ? 'on' : ''} ${rec.results[c.id] ? `is-${rec.results[c.id]}` : ''}`} onClick={() => goTo(c.id)}
              data-tip={c.title}>
              <span className="mono">{String(i + 1).padStart(3, '0')}</span>{rec.results[c.id] === 'hit' ? '✓' : rec.results[c.id] === 'miss' ? '✗' : ''}
            </button>
          ))}
        </div>
      </motion.section>
    </div>
  )
}
