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
    review?: { checks: ReviewCheck[]; sensitive: boolean }
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
  source: 'github' | 'demo'
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
  settings?: { autoSync?: boolean }
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
  syncMinutes?: number; githubFallbackToken?: boolean
}

/** users/{uid}/private/github: readable and writable only by that user. */
export interface GithubLink { token: string; login?: string; avatarUrl?: string; source?: 'oauth' | 'pat'; scopes?: string }

export const AGENTS = ['triager', 'coder', 'tester', 'reviewer'] as const
export type AgentName = (typeof AGENTS)[number]
