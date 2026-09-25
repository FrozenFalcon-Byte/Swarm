import { useEffect, useState } from 'react'
import {
  addDoc, collection, deleteDoc, doc, getDoc, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where,
  type DocumentData, type Query,
} from 'firebase/firestore'
import { getBytes, ref } from 'firebase/storage'
import { db, storage } from './firebase'
import type { GhRepo } from './github'
import type { Activity, GithubLink, Repo, Run, Task, Tool, WorkerInfo } from './types'

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

/** A worker counts as online if it checked in within the last minute. */
export function onlineWorker(workers: WorkerInfo[]): WorkerInfo | undefined {
  const now = Date.now()
  return workers.find((w) => w.lastSeen && now - w.lastSeen.toDate().getTime() < 60_000)
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
  return addDoc(collection(db, 'repos', repoId, 'runs'), { status: 'queued', trigger, requestedBy: uid, createdAt: serverTimestamp() })
}

export function requestAction(uid: string, userName: string, repoId: string, type: 'merge' | 'approve' | 'reject' | 'reopen' | 'close', taskId: string, comment = '') {
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
  return updateDoc(doc(db, 'repos', repoId), { settings: { autoSync: on } })
}

export function removeRepo(repoId: string) {
  return deleteDoc(doc(db, 'repos', repoId))
}

