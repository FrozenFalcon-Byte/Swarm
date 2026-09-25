// Browser-side GitHub calls, made with the signed-in user's own token (never the worker's).
const API = 'https://api.github.com'

export class GithubError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

async function gh<T>(path: string, token?: string | null): Promise<{ data: T; headers: Headers }> {
  const res = await fetch(`${API}${path}`, {
    headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  if (!res.ok) {
    const limited = res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0'
    const msg = res.status === 401 ? 'GitHub rejected the token. It may have expired or been revoked.'
      : limited ? 'GitHub’s hourly limit for anonymous lookups is used up. Connect GitHub to lift it.'
      : res.status === 404 ? 'GitHub can’t find that repository, or this account can’t see it.'
      : `GitHub returned ${res.status}.`
    throw new GithubError(msg, res.status)
  }
  return { data: (await res.json()) as T, headers: res.headers }
}

export interface GhUser { login: string; avatar_url: string; name: string | null }
export interface GhRepo {
  full_name: string; name: string; private: boolean; default_branch: string; html_url: string
  description: string | null; open_issues_count: number; pushed_at: string; owner: { login: string; avatar_url: string }
  permissions?: { admin: boolean; push: boolean; pull: boolean }
}

/** Who a token belongs to, plus its classic scopes (empty for fine-grained tokens). */
export async function whoAmI(token: string) {
  const { data, headers } = await gh<GhUser>('/user', token)
  return { user: data, scopes: headers.get('x-oauth-scopes') || '' }
}

/** Repositories the user can push to, most recently active first. */
export async function listRepos(token: string): Promise<GhRepo[]> {
  const out: GhRepo[] = []
  for (let page = 1; page <= 3; page++) {
    const { data } = await gh<GhRepo[]>(`/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member&page=${page}`, token)
    out.push(...data)
    if (data.length < 100) break
  }
  return out.filter((r) => r.permissions?.push !== false)
}

export async function lookupRepo(fullName: string, token?: string | null) {
  const { data } = await gh<GhRepo>(`/repos/${fullName}`, token)
  return data
}

export function cleanRepoName(input: string) {
  return input.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '')
}
