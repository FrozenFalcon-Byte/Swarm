# Swarm

Four narrow AI agents (**Triager, Coder, Tester, Reviewer**) that maintain a GitHub
repository by moving cards across a shared task board, the way a real dev team works.
They never talk to each other directly. Each agent reads cards from its own column
and writes them to the next. Every change is validated by a state machine and
recorded in the card's history. Nothing merges without a human.

**v1 niche: flaky tests.** When a single green run can't prove a fix (it never can
for a flaky test), the Tester **writes a harness**. It checks that the harness catches
the bug on the old code and passes on the new code, then **saves it** so later tasks
reuse it.

```
New Issue → Triaged → In Progress → Awaiting Tests → In Review → Approved ──(you)──▶ Merged
                          ▲                 │              │
                          └──── Rejected ◀──┴──────────────┘
Needs Human  (low-confidence triage, security-sensitive diffs, coder out of attempts, out of scope)
Closed       (duplicates, questions)
```

## It's a service for your repo

```
 Browser (web/)                    Firebase                           Worker (python -m swarm.cli worker)
 ─────────────────                 ─────────────────────              ──────────────────────────────────
 landing, sign-in, dashboard  ◀──▶ Auth: email, Google, GitHub        polls runs + actions
 connect repo  ───────────────────▶ repos/{id}                        clones repo (owner's GitHub token)
 "Run" / "Merge" / "Approve" ─────▶ repos/{id}/runs, /actions   ────▶ runs the 4 agents in a sandbox
 live board, charts  ◀──────────── repos/{id}/tasks, /activity  ◀──── writes cards, stats, activity
 tool code viewer   ◀───────────── Storage: patches, results, tools ◀─ uploads artifacts
                                                                      Merge → opens a GitHub PR
```

**Going live:** [SETUP.md](SETUP.md) lists every key: where to get it and which file it goes in. Then `swarm doctor` checks each connection.

The browser can only **request** work (create a run or an action). Tasks, tools and
stats are written only by the worker, and the security rules
([firestore.rules](firestore.rules), [storage.rules](storage.rules)) enforce this. A
browser can never push a card through the state machine itself.

## Models: local first, free fallbacks

Providers are tried in order, and a failing call falls through to the next one
([swarm/llm.py](swarm/llm.py)):

| Provider | Setup | Default model |
|---|---|---|
| Ollama (local) | `ollama pull qwen2.5-coder:7b` | `qwen2.5-coder:7b` (else any installed model) |
| Groq (free tier) | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| Gemini (free tier) | `GEMINI_API_KEY` | `gemini-2.5-flash` |
| OpenRouter (free models) | `OPENROUTER_API_KEY` | `meta-llama/llama-3.3-70b-instruct:free` |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-5` |

With no model at all, the agents use built-in heuristics and fix strategies.

Small local models are treated with care:

- **Triage** combines the model's verdict with keyword heuristics. When they agree, confidence goes up. When they disagree, the issue goes to a human.
- **The LLM review** is advisory unless `SWARM_LLM_REVIEW_BLOCKING=1`. The deterministic checks always block.
- **The Coder** never resubmits a diff that was already rejected.

## Run it locally (Firebase emulators, no credentials needed)

Needs Python 3.11+, Node 20+, Java 21+ (for the emulators) and optionally Ollama.

```bash
python3 -m venv .venv && .venv/bin/pip install -e ".[cloud,mcp]"
(cd web && npm install)

# 1. Firebase emulators (auth :9099, firestore :8080, storage :9199, UI :4000)
npx firebase-tools emulators:start --project demo-swarm

# 2. the worker
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 \
GCLOUD_PROJECT=demo-swarm SWARM_HOME=.swarm-service .venv/bin/python -m swarm.cli -v worker

# 3. the web app → http://localhost:5173, create an account, "Try the demo repo"
(cd web && printf 'VITE_USE_EMULATORS=true\n' > .env.local && npm run dev)
```

## Switch to your Firebase project

Step by step in [SETUP.md](SETUP.md). In short:

1. `web/.env.local` gets the Firebase web config (public identifiers).
2. `.env` gets the service account and model keys (secrets, never committed).
3. `scripts/deploy.sh` deploys the rules and the site.
4. `swarm doctor`, then `swarm worker`. The worker also runs from the included `Dockerfile`.

## GitHub

- Users connect GitHub in **Settings → Connections**: OAuth with the `repo` scope, or a fine-grained token. The dashboard then offers a searchable picker of their repositories, private ones included.
- The worker refreshes each repo's default branch and visibility on every run. It checks for new or edited issues every `SWARM_SYNC_MINUTES` and queues a run when it finds some; each repo has a switch to turn this off.
- **Merge** opens a pull request from a `swarm/<task>` branch. Errors from GitHub (expired token, no access, rate limit) are shown in words, with a link to Settings.

## Use it from Claude (MCP)

`swarm mcp` is an MCP server over stdio. `swarm mcp --cloud` serves the repositories in Firebase instead of the local board.

```bash
claude mcp add swarm -- "$PWD/.venv/bin/swarm" mcp --cloud
```

| Tool | Does |
|---|---|
| `board_summary`, `list_tasks`, `get_task` | Read the board, a column, or one task with its diff, evidence and review |
| `search_harnesses`, `read_harness` | Find and read the tools the tester wrote |
| `run_swarm` | Ingest new issues and let the agents work |
| `request_changes` | Send a patch back to the coder with feedback |
| `list_repos` | Connected repositories (cloud mode) |

It also offers a `standup` prompt and a `swarm://board` resource. There is no approve or merge tool on purpose: merging stays a human click in the dashboard.

## Without Firebase

The original single-machine mode still works:

- `swarm demo --merge` runs the whole pipeline in the terminal.
- `swarm serve --demo` serves a simple local board at http://127.0.0.1:8000.

## Layout

| Path | What it is |
|---|---|
| `swarm/board/` | Task model, state machine with human-only transitions, SQLite store |
| `swarm/agents/` | Triager, Coder, Tester, Reviewer |
| `swarm/sandbox.py` | Throwaway repo copies. Docker (`--network none`, resource limits) or local rlimits |
| `swarm/toolgen.py`, `swarm/registry.py` | Agent-written harnesses and the searchable tool registry |
| `swarm/llm.py` | Provider chain (Ollama → Groq → Gemini → OpenRouter → Anthropic) |
| `swarm/cloud/` | Firestore board, Storage-backed registry, worker (with GitHub issue sync), GitHub clone + PR |
| `swarm/mcp_server.py` | The MCP server (`swarm mcp`) |
| `swarm/doctor.py`, `swarm/env.py` | `swarm doctor` connection checks; `.env` loading |
| `Dockerfile`, `scripts/deploy.sh` | Worker image; rules + hosting deploy |
| `web/` | React + Vite app: landing page, sign-in, dashboard |
| `demo_repo/`, `demo_issues.json` | A small library with real flaky tests, and 7 issues |
| `tests/` | 35 tests. The Firestore ones run when `FIRESTORE_EMULATOR_HOST` is set |

## Known limits

* The offline Coder knows three fix strategies. Beyond those it relies on the LLM, or hands off to a human.
* The local sandbox can't block the network at the kernel level. Use Docker for untrusted repositories.
* The GitHub token is stored in the user's private Firestore document (owner-only by rules). A GitHub App would be the stronger long-term design.
* Issue sync polls GitHub. Instant pickup needs a webhook, which means a public endpoint (Cloud Functions, on the Blaze plan).
* MCP cloud mode uses the worker's admin credentials, so run it only where the worker's `.env` already lives.
* The font is Schibsted Grotesk, a free stand-in for Ctrl's Tomato Grotesk. To use Tomato Grotesk, add a licensed `@font-face` and change `--font-sans` in `web/src/styles/tokens.css`.
