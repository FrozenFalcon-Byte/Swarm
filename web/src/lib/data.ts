import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  addDoc, collection, deleteDoc, deleteField, doc, getDoc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where,
  type DocumentData, type Query,
} from 'firebase/firestore'
import { getBytes, ref } from 'firebase/storage'
import { wakeHub } from './api'
import { db, storage } from './firebase'
import type { GhRepo } from './github'
import type { A2AEvent, Activity, GithubLink, HouseRule, Schedule, LabSpec, LabWave, McpToken, Onboarding, Passkey, Prefs, Profile, Repo, Run, Task, Tool, WorkerInfo } from './types'

type Live<T> = { data: T; loading: boolean; error: string | null }

function useLiveQuery<T>(build: () => Query<DocumentData> | null, map: (id: string, d: DocumentData) => T, deps: unknown[]): Live<T[]> {
  const [state, setState] = useState<Live<T[]>>({ data: [], loading: true, error: null })
  useEffect(() => {
    const q = build()
    if (!q) { setState({ data: [], loading: false, error: null }); return }
    setState((s) => ({ ...s, loading: true }))
    return onSnapshot(q,
      (snap) => setState({ data: snap.docs.map((d) => map(d.id, d.data())), loading: false, error: null }),
      (err) => setState({ data: [], loading: false, error: err.message }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}

export function useRepos(uid: string | undefined) {
  return useLiveQuery<Repo>(() => uid ? query(collection(db, 'repos'), where('members', 'array-contains', uid)) : null,
    (id, d) => ({ id, ...d }) as Repo, [uid])
}

export function useRepo(repoId: string | undefined) {
  const [repo, setRepo] = useState<Repo | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!repoId) return
    return onSnapshot(doc(db, 'repos', repoId), (s) => { setRepo(s.exists() ? ({ id: s.id, ...s.data() } as Repo) : null); setLoading(false) },
      () => { setRepo(null); setLoading(false) })
  }, [repoId])
  return { repo, loading }
}

export function useTasks(repoId: string | undefined) {
  return useLiveQuery<Task>(() => repoId ? collection(db, 'repos', repoId, 'tasks') : null, (_id, d) => d as Task, [repoId])
}

export function useActivity(repoId: string | undefined, n = 40) {
  return useLiveQuery<Activity>(() => repoId ? query(collection(db, 'repos', repoId, 'activity'), orderBy('createdAt', 'desc'), limit(n)) : null,
    (id, d) => ({ id, ...d }) as Activity, [repoId, n])
}

/** The agents' A2A traffic for one repository, oldest first. */
export function useA2A(repoId: string | undefined, n = 400) {
  const live = useLiveQuery<A2AEvent>(() => repoId ? query(collection(db, 'repos', repoId, 'a2a'), orderBy('createdAt', 'desc'), limit(n)) : null,
    (id, d) => ({ id, ...d }) as A2AEvent, [repoId, n])
  return { ...live, data: live.data.slice().reverse() }
}

export function useTools(repoId: string | undefined) {
  return useLiveQuery<Tool>(() => repoId ? collection(db, 'repos', repoId, 'tools') : null, (_id, d) => ({ ...d, repoId }) as Tool, [repoId])
}

export function useRuns(repoId: string | undefined, n = 20) {
  return useLiveQuery<Run>(() => repoId ? query(collection(db, 'repos', repoId, 'runs'), orderBy('createdAt', 'desc'), limit(n)) : null,
    (id, d) => ({ id, ...d }) as Run, [repoId, n])
}

/** Tasks across several repos, for the overview. */
export function useAllTasks(repoIds: string[]) {
  const key = repoIds.slice().sort().join(',')
  const [byRepo, setByRepo] = useState<Record<string, Task[]>>({})
  useEffect(() => {
    setByRepo({})
    const unsubs = repoIds.map((id) => onSnapshot(collection(db, 'repos', id, 'tasks'),
      (s) => setByRepo((prev) => ({ ...prev, [id]: s.docs.map((d) => ({ ...(d.data() as Task), repoId: id })) }))))
    return () => unsubs.forEach((u) => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return Object.values(byRepo).flat() as (Task & { repoId: string })[]
}

export function useWorkers() {
  return useLiveQuery<WorkerInfo>(() => collection(db, 'workers'), (id, d) => ({ id, ...d }) as WorkerInfo, [])
}

/** A worker counts as online if it checked in within the last minute, or, for one that runs on a
 *  schedule (GitHub Actions, cron), within the last 30 minutes. */
export function onlineWorker(workers: WorkerInfo[]): WorkerInfo | undefined {
  const now = Date.now()
  const age = (w: WorkerInfo) => (w.lastSeen ? now - w.lastSeen.toDate().getTime() : Infinity)
  return workers.find((w) => age(w) < 60_000) || workers.find((w) => w.mode === 'scheduled' && age(w) < 30 * 60_000)
}

/** A scheduled worker (GitHub Actions) between passes: nothing's running, but queued work starts a pass through
 *  the hub within a minute or two. Counts while its last pass was within the last day. */
export function onCallWorker(workers: WorkerInfo[]): WorkerInfo | undefined {
  const now = Date.now()
  return workers.filter((w) => w.mode === 'scheduled' && w.lastSeen && now - w.lastSeen.toDate().getTime() < 24 * 3600_000)
    .sort((a, b) => b.lastSeen!.toDate().getTime() - a.lastSeen!.toDate().getTime())[0]
}

export function useActionStatus(repoId: string | undefined) {
  return useLiveQuery<{ id: string; status: string; type: string; taskId: string; error?: string; result?: string }>(
    () => repoId ? query(collection(db, 'repos', repoId, 'actions'), orderBy('createdAt', 'desc'), limit(10)) : null,
    (id, d) => ({ id, ...d }) as never, [repoId])
}

// -- commands: the client only ever *requests* work -------------------------

/** The user's GitHub link, live. `undefined` while loading. */
export function useGithubLink(uid: string | undefined) {
  const [link, setLink] = useState<GithubLink | null | undefined>(undefined)
  useEffect(() => {
    if (!uid) { setLink(null); return }
    return onSnapshot(doc(db, 'users', uid, 'private', 'github'), (s) => setLink(s.exists() ? (s.data() as GithubLink) : null), () => setLink(null))
  }, [uid])
  return link
}

/** Add a repository. `gh` is the GitHub lookup for real repos: it records the branch and visibility. */
export async function connectRepo(uid: string, source: 'github' | 'demo', gh?: GhRepo) {
  const meta = source === 'demo' || !gh
    ? { fullName: 'swarm-demo/tagkit', displayName: 'tagkit (demo)' }
    : { fullName: gh.full_name, displayName: gh.name, defaultBranch: gh.default_branch, private: gh.private,
        htmlUrl: gh.html_url, description: (gh.description || '').slice(0, 200), settings: { autoSync: true } }
  const repoRef = await addDoc(collection(db, 'repos'), {
    ...meta, source, ownerUid: uid, members: [uid], status: 'queued', createdAt: serverTimestamp(),
  })
  await queueRun(uid, repoRef.id, 'connect')
  return repoRef.id
}

export function queueRun(uid: string, repoId: string, trigger = 'manual') {
  wakeHub()
  return addDoc(collection(db, 'repos', repoId, 'runs'), { status: 'queued', trigger, requestedBy: uid, createdAt: serverTimestamp() })
}

/** Stop a run that's waiting or going. The page shows it stopped at once; a worker that's on it sees
 *  stopRequested within a few seconds, lets the agents finish what they're on, and starts nothing new. */
export function stopRun(uid: string, repoId: string, runId: string) {
  return updateDoc(doc(db, 'repos', repoId, 'runs', runId), { status: 'stopped', stopRequested: true, stopRequestedBy: uid, finishedAt: serverTimestamp() })
}

export function requestAction(uid: string, userName: string, repoId: string, type: 'merge' | 'approve' | 'reject' | 'reopen' | 'close', taskId: string, comment = '') {
  wakeHub()
  return addDoc(collection(db, 'repos', repoId, 'actions'), {
    status: 'pending', type, taskId, comment, uid, userName, createdAt: serverTimestamp(),
  })
}

export async function readToolCode(repoId: string, toolId: string) {
  // Without a Storage bucket (free Spark plan) the worker keeps the code on the tool's own document.
  const snap = await getDoc(doc(db, 'repos', repoId, 'tools', toolId))
  const inline = snap.data()?.code
  if (typeof inline === 'string') return inline
  const bytes = await getBytes(ref(storage, `repos/${repoId}/tools/${toolId}.py`))
  return new TextDecoder().decode(bytes)
}

export function setAutoSync(repoId: string, on: boolean) {
  return updateDoc(doc(db, 'repos', repoId), { 'settings.autoSync': on })
}

/** Outside A2A agents the reviewer asks for a second opinion (at most three). */
export function setSecondOpinionAgents(repoId: string, urls: string[]) {
  return updateDoc(doc(db, 'repos', repoId), { 'settings.secondOpinionAgents': urls.slice(0, 3) })
}

/** The repository's house rules, which the reviewer checks every fix against. */
export function setHouseRules(repoId: string, rules: HouseRule[]) {
  return updateDoc(doc(db, 'repos', repoId), { 'settings.rules': JSON.parse(JSON.stringify(rules.slice(0, 30))) })
}

/** Quiet hours for automatic runs; null means any time. */
export function setSchedule(repoId: string, schedule: Schedule | null) {
  return updateDoc(doc(db, 'repos', repoId), { 'settings.schedule': schedule ?? deleteField() })
}

export function removeRepo(repoId: string) {
  return deleteDoc(doc(db, 'repos', repoId))
}


// -- profile, passkeys and MCP tokens ------------------------------------------

/** users/{uid}: name and profile picture as the app shows them. `undefined` while loading. */
export function useProfile(uid: string | undefined) {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined)
  useEffect(() => {
    if (!uid) { setProfile(null); return }
    return onSnapshot(doc(db, 'users', uid), (s) => setProfile(s.exists() ? (s.data({ serverTimestamps: 'estimate' }) as Profile) : null), () => setProfile(null))
  }, [uid])
  return profile
}

/** A cropped picture as a data URL (a small WebP), or null to remove it. */
export function setAvatar(uid: string, dataUrl: string | null) {
  return setDoc(doc(db, 'users', uid), { avatar: dataUrl, avatarUpdatedAt: serverTimestamp() }, { merge: true })
}

export function usePasskeys(uid: string | undefined) {
  return useLiveQuery<Passkey>(() => uid ? query(collection(db, 'passkeys'), where('uid', '==', uid)) : null,
    (id, d) => ({ id, ...d }) as Passkey, [uid])
}
export const renamePasskey = (id: string, name: string) => updateDoc(doc(db, 'passkeys', id), { name })
export const removePasskey = (id: string) => deleteDoc(doc(db, 'passkeys', id))

export function useMcpTokens(uid: string | undefined) {
  return useLiveQuery<McpToken>(() => uid ? query(collection(db, 'mcpTokens'), where('uid', '==', uid)) : null,
    (id, d) => ({ id, ...d }) as McpToken, [uid])
}

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Make a personal access token. Only its hash is stored; the token itself is returned once, for the user to copy. */
export async function createMcpToken(uid: string, name: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = 'swm_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  await setDoc(doc(db, 'mcpTokens', await sha256Hex(token)), { uid, name: name.trim().slice(0, 60) || 'Token', prefix: token.slice(0, 10), createdAt: serverTimestamp() })
  return token
}
export const revokeMcpToken = (id: string) => deleteDoc(doc(db, 'mcpTokens', id))


// -- admins and the test lab ----------------------------------------------------

/** Whether this account can use the test lab (admins/{uid} exists). `undefined` while loading. */
export function useIsAdmin(uid: string | undefined) {
  const [admin, setAdmin] = useState<boolean | undefined>(undefined)
  useEffect(() => {
    if (!uid) { setAdmin(false); return }
    return onSnapshot(doc(db, 'admins', uid), (s) => setAdmin(s.exists()), () => setAdmin(false))
  }, [uid])
  return admin
}

export function useLabWaves(repoId: string | undefined) {
  return useLiveQuery<LabWave>(() => repoId ? query(collection(db, 'repos', repoId, 'lab'), orderBy('index', 'asc')) : null,
    (_id, d) => d as LabWave, [repoId])
}

export function newLabSpec(size: LabSpec['size'], kinds: LabSpec['kinds']): LabSpec {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] % 2147483646 + 1
  return { seed, size, kinds: kinds && kinds.length ? kinds : null, requestedAt: new Date().toISOString() }
}

/** A brand-new made-up project. The worker invents it on its first run and names the repo after it. */
export async function createLabProject(uid: string, spec: LabSpec) {
  const repoRef = await addDoc(collection(db, 'repos'), {
    fullName: 'lab/new-project', displayName: 'New test project', source: 'lab', ownerUid: uid, members: [uid],
    status: 'queued', createdAt: serverTimestamp(), lab: { waves: [spec] },
  })
  await queueRun(uid, repoRef.id, 'lab')
  return repoRef.id
}

/** Another wave of made-up bugs and issues on an existing lab project. */
export async function addLabWave(uid: string, repo: Repo, spec: LabSpec) {
  const waves = [...(repo.lab?.waves || []), spec].slice(0, 20)
  await updateDoc(doc(db, 'repos', repo.id), { lab: { waves } })
  await queueRun(uid, repo.id, 'lab')
}

// -- onboarding -------------------------------------------------------------------

/** Save where someone is in onboarding, so leaving and coming back resumes there. */
export function saveOnboarding(uid: string, patch: Onboarding, displayName?: string) {
  const data: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) data[`onboarding.${k}`] = v
  if (displayName !== undefined) data.displayName = displayName
  return setDoc(doc(db, 'users', uid), unflatten(data), { merge: true })
}

/* Prefs you just changed show at once: they wait here while the write goes to Firestore, and drop out as soon
   as the saved profile agrees (or the write fails). So a new theme can be painted inside a view transition
   without waiting on the network, and nothing flickers back to the old value on the way. */
let pending: Prefs = {}
const pendingSubs = new Set<() => void>()
const setPending = (p: Prefs) => { pending = p; pendingSubs.forEach((f) => f()) }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function savePrefs(uid: string, patch: Prefs) {
  setPending({ ...pending, ...patch })
  return setDoc(doc(db, 'users', uid), { prefs: patch }, { merge: true }).catch((e) => {
    setPending(Object.fromEntries(Object.entries(pending).filter(([k]) => !(k in patch))) as Prefs)
    throw e
  })
}

/** Your prefs as saved, with anything you just changed already applied. */
export function usePrefs(uid: string | undefined): Prefs | undefined {
  const profile = useProfile(uid)
  const draft = useSyncExternalStore((f) => { pendingSubs.add(f); return () => { pendingSubs.delete(f) } }, () => pending)
  const saved = profile?.prefs
  useEffect(() => {
    if (!saved) return
    const left = Object.entries(pending).filter(([k, v]) => !same((saved as Record<string, unknown>)[k], v))
    if (left.length !== Object.keys(pending).length) setPending(Object.fromEntries(left) as Prefs)
  }, [saved, draft])
  if (profile === undefined && !Object.keys(draft).length) return undefined
  return { ...(saved ?? {}), ...draft }
}

export function finishOnboarding(uid: string) {
  return setDoc(doc(db, 'users', uid), { onboardedAt: serverTimestamp() }, { merge: true })
}

function unflatten(d: Record<string, unknown>) {
  const out: Record<string, Record<string, unknown> | unknown> = {}
  for (const [k, v] of Object.entries(d)) {
    const [a, b] = k.split('.')
    if (b) out[a] = { ...((out[a] as Record<string, unknown>) || {}), [b]: v }
    else out[a] = v
  }
  return out
}
