import { MCP_URL } from './api'

export const TOKEN_PLACEHOLDER = 'swm_your_token'

export interface McpClient { id: string; label: string; where: string; snippet: (token: string) => string }

/** How to connect each client to Swarm's MCP server over HTTP. Used by Settings and the docs page. */
export const MCP_CLIENTS: McpClient[] = [
  {
    id: 'claude-code', label: 'Claude Code', where: 'Run once in a terminal:',
    snippet: (t) => `claude mcp add --transport http swarm ${MCP_URL} \\\n  --header "Authorization: Bearer ${t}"`,
  },
  {
    id: 'claude-desktop', label: 'Claude Desktop', where: 'Settings → Developer → Edit config, add this, then restart Claude:',
    snippet: (t) => JSON.stringify({ mcpServers: { swarm: { command: 'npx', args: ['-y', 'mcp-remote', MCP_URL, '--header', 'Authorization:${SWARM_AUTH}'], env: { SWARM_AUTH: `Bearer ${t}` } } } }, null, 2),
  },
  {
    id: 'cursor', label: 'Cursor', where: 'Add to ~/.cursor/mcp.json (or .cursor/mcp.json in a project):',
    snippet: (t) => JSON.stringify({ mcpServers: { swarm: { url: MCP_URL, headers: { Authorization: `Bearer ${t}` } } } }, null, 2),
  },
  {
    id: 'vscode', label: 'VS Code', where: 'Add to .vscode/mcp.json in your workspace:',
    snippet: (t) => JSON.stringify({ servers: { swarm: { type: 'http', url: MCP_URL, headers: { Authorization: `Bearer ${t}` } } } }, null, 2),
  },
  {
    id: 'http', label: 'Any client', where: 'Streamable HTTP, bearer token:',
    snippet: (t) => `URL     ${MCP_URL}\nHeader  Authorization: Bearer ${t}`,
  },
]

export const MCP_TOOLS: { name: string; kind: 'read' | 'act'; text: string; args?: string }[] = [
  { name: 'list_repos', kind: 'read', text: 'Your connected repositories, with how many tasks wait on you.' },
  { name: 'board_summary', kind: 'read', text: 'How many tasks are in each column, and the ones waiting for you.', args: 'repo?' },
  { name: 'list_tasks', kind: 'read', text: 'Tasks, optionally only one column such as “Approved”.', args: 'state?, repo?' },
  { name: 'get_task', kind: 'read', text: 'One task in full: the issue, the diff, before and after runs, the review checks and history.', args: 'task_id, repo?' },
  { name: 'search_harnesses', kind: 'read', text: 'Search the test harnesses the tester has written.', args: 'query, repo?' },
  { name: 'read_harness', kind: 'read', text: 'The Python source of one harness.', args: 'tool_id, repo?' },
  { name: 'run_swarm', kind: 'act', text: 'Queue a run: pick up new issues and let the agents work until idle.', args: 'repo?' },
  { name: 'request_changes', kind: 'act', text: 'Send a patch back to the coder with your feedback.', args: 'task_id, comment, repo?' },
]
