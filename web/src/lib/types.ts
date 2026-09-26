export type TaskState =
  | 'New Issue' | 'Triaged' | 'In Progress' | 'Awaiting Tests' | 'In Review'
  | 'Rejected' | 'Approved' | 'Merged' | 'Needs Human' | 'Closed'

export interface HistoryEntry { agent: string; action: string; ts: string; from_state?: TaskState | null; to_state?: TaskState | null }

export interface Evidence { failures: number | null; runs: number; failure_rate?: number; failing?: string[] }
export interface ReviewCheck { name: string; ok: boolean; detail: string; blocking: boolean }

export interface Task {
  task_id: string
  source_issue: string
  title: string
  body: string
  state: TaskState
  priority: string
  kind: string
  labels: string[]
  assigned_agent: string | null
  attempts: number
  note: string
  created_at: string
  updated_at: string
  history: HistoryEntry[]
  artifacts: {
    triage?: { confidence: number; rationale: string }
    diff_text?: string
    strategy?: string
    root_cause?: string
    flakiness_source?: string
    test_ids?: string[]
    rejected_strategies?: string[]
    tools_used?: string[]
    delivery?: string
    second_opinions?: SecondOpinion[]
    review?: { checks: ReviewCheck[]; sensitive: boolean; askFirst?: string[] }
    test_summary?: {
      sandbox?: string
      suite_patched?: { passed: number; failed: number; total: number }
      preexisting_failures?: string[]
      harness?: { tool_id: string; reused: boolean; evidence: Record<string, { before: Evidence; after: Evidence }> }
    }
  }
}

export interface RepoStats {
  counts: Record<TaskState, number>
  total: number
  open: number
  needsYou: number
  merged: number
  toolsWritten: number
  toolReuses: number
  flakeRateBefore: number | null
  flakeRateAfter: number | null
}

export interface Repo {
  id: string
  fullName: string
  displayName?: string
  source: 'github' | 'demo' | 'lab'
  ownerUid: string
  members: string[]
  status?: 'idle' | 'queued' | 'running' | 'error'
  lastError?: string | null
  stats?: RepoStats
  createdAt?: { toDate(): Date }
  lastRunAt?: { toDate(): Date }
  defaultBranch?: string
  private?: boolean
  htmlUrl?: string
  description?: string
  settings?: { autoSync?: boolean; secondOpinionAgents?: string[]; rules?: HouseRule[]; schedule?: Schedule | null }
  lab?: { waves: LabSpec[] }
  labStatus?: string | null
}

/** What the owner tells the agents (settings.rules); the reviewer enforces them on every fix. */
export interface HouseRule { id: string; kind: 'never' | 'ask' | 'size'; glob?: string; max?: number; why?: string; on: boolean }
/** Quiet hours (settings.schedule): 168 characters, Monday 00:00 first, '1' where the swarm may start runs on its own. */
export interface Schedule { tz: string; hours: string }

export type LabKind = 'hash-order' | 'jitter' | 'clock' | 'shared-state'
export type LabSize = 'small' | 'medium' | 'large'
export interface LabSpec { seed: number; size: LabSize; kinds: LabKind[] | null; requestedAt?: string }
/** repos/{id}/lab/{index}: one made-up wave, with its answer key. */
export interface LabWave {
  index: number
  seed: number
  package: string
  description: string
  via: string
  files: Record<string, string>
  issues: { number: number; title: string; body: string }[]
  bugs: { kind: LabKind; module: string; test: string; issue: number; root_cause: string; fix: string | null; title: string
    verified: { buggy: { runs: number; failures: number }; fixed: { runs: number; failures: number } } | null; builtIn?: boolean }[]
  noise: { issue: number; type: 'question' | 'vague' | 'bug' | 'feature' | 'duplicate' }[]
  createdAt?: Stamp
}

export interface Tool {
  tool_id: string
  description: string
  created_by_task: string
  validated: boolean
  usage_count: number
  used_by_tasks: string[]
  tags: string[]
  created_at: string
  storage_path?: string
  repoId?: string
}

export interface Activity { id: string; ts: string; agent: string; message: string; task_id: string | null }
export interface Run {
  id: string; status: 'queued' | 'running' | 'done' | 'failed'; trigger?: string; error?: string
  summary?: { ingested: number; tasksMoved: number; llm: string | null; sandbox: string }
  createdAt?: { toDate(): Date }; finishedAt?: { toDate(): Date }
}
export interface WorkerInfo {
  id: string; lastSeen?: { toDate(): Date }; llm?: { active: string | null; fallbacks: string[] }; sandbox?: string
  syncMinutes?: number; githubFallbackToken?: boolean; mode?: 'always-on' | 'scheduled'
  protocol?: 'a2a'; agents?: AgentCard[]
}

/** An A2A agent card, as JSON (see a2a-protocol.org). */
export interface AgentCard {
  name: string; description: string; version?: string
  supportedInterfaces?: { url: string; protocolBinding?: string }[]
  capabilities?: { streaming?: boolean; pushNotifications?: boolean }
  defaultInputModes?: string[]; defaultOutputModes?: string[]
  skills?: { id: string; name: string; description: string; tags?: string[]; examples?: string[] }[]
  securitySchemes?: Record<string, unknown>
  provider?: { organization?: string; url?: string }
}

/** One thing on the wire between agents: a message, a status update, a result, or the final state. */
export interface A2AEvent {
  id: string; ts: string
  kind: 'message' | 'task' | 'status' | 'artifact' | 'reply' | 'error' | 'external'
  from: string; to: string; taskId: string; context?: string; a2aTask?: string
  state?: string; text?: string; name?: string; url?: string; reference?: string | null
  data?: Record<string, unknown> | null
  wire?: unknown
}

export interface SecondOpinion { url: string; agent: string; state: string; verdict: 'approve' | 'reject' | 'comment' | 'no answer'; text: string; at: string }

type Stamp = { toDate(): Date } | null
export interface Onboarding { step?: number; role?: string; goals?: string[]; repoId?: string | null; review?: 'every' | 'batch' }
export const ONB_ROLES = ['I maintain an open-source project', 'I lead a team', 'I work on my own', 'I’m just looking around']
export const ONB_GOALS = ['Fix tests that fail at random', 'Sort and triage issues', 'Review fixes before they merge', 'Connect my own agents over A2A']
/** How the app behaves for this person, saved on their profile so it follows them between devices. */
export interface Prefs {
  motion?: 'system' | 'less' | 'full'; notify?: boolean; startPage?: 'overview' | 'repos' | 'last'
  /** which tab a repository opens on */
  repoTab?: 'board' | 'handoffs' | 'activity'
  /** 'focus' folds empty lanes and Closed; 'all' keeps every lane open */
  lanes?: 'focus' | 'all'
  density?: 'comfortable' | 'compact'
}
export interface Profile { displayName?: string; email?: string; avatar?: string | null; githubLogin?: string | null; createdAt?: Stamp
  onboarding?: Onboarding; onboardedAt?: Stamp | null; prefs?: Prefs }
export interface Passkey { id: string; uid: string; name: string; deviceType?: string; backedUp?: boolean; createdAt?: Stamp; lastUsedAt?: Stamp }
export interface McpToken { id: string; uid: string; name: string; prefix: string; createdAt?: Stamp; lastUsedAt?: Stamp }

/** users/{uid}/private/github: readable and writable only by that user. */
export interface GithubLink { token: string; login?: string; avatarUrl?: string; source?: 'oauth' | 'pat'; scopes?: string }

export const AGENTS = ['triager', 'coder', 'tester', 'reviewer'] as const
export type AgentName = (typeof AGENTS)[number]
