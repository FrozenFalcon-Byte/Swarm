# Deploying Swarm for free

Swarm is three pieces. The website is already free on Firebase Hosting. The other two need somewhere to run:

| Piece | What it does | Needs |
|---|---|---|
| Website | Landing page and dashboard | Firebase Hosting (done: `scripts/deploy.sh`) |
| **Worker** (`swarm worker`) | Runs the agents and the tests | To stay on, or to run on a schedule. Docker, for the strong sandbox |
| **Server** (`swarm server`, or `swarm hub`) | MCP for Claude and other tools, passkey sign-in | A public HTTPS address |

Free tiers change often. Check each provider's current terms before relying on one.

## Option 0: Render + GitHub Actions (free, no card)

`swarm hub` is the whole server in one FastAPI app: MCP, the A2A gateway, passkey sign-in, and a
dispatcher. The dispatcher watches Firestore and starts the GitHub Actions worker as soon as a run or an
action is waiting, so work starts in about a minute instead of waiting for the 15-minute schedule. The
worker itself stays on GitHub's runners, which have Docker, so every test still runs in the sandbox.

1. **A GitHub token for the dispatcher:** Settings → Developer settings → Fine-grained tokens. Give it access
   to this repository only, with the permission *Actions: Read and write*. The hub uses it only to start the worker.
2. **The hub on Render:** render.com → New → Blueprint → pick this repository. `render.yaml` creates
   `swarm-hub` on the free plan. When asked, paste `FIREBASE_SERVICE_ACCOUNT_JSON` (the whole JSON on one
   line) and `SWARM_DISPATCH_TOKEN` (the token from step 1).
3. **The worker's secrets on GitHub,** plus the keep-alive address. From the project folder, with the `gh` CLI signed in:

   ```bash
   .venv/bin/python scripts/space.py --actions-only --hub-url https://swarm-hub-xxxx.onrender.com
   ```

   This sets `FIREBASE_SERVICE_ACCOUNT_JSON` and any model keys from `.env` as Actions secrets, and
   `SWARM_HUB_URL` as a variable.
4. **The website:** set `VITE_SWARM_API_URL=https://swarm-hub-xxxx.onrender.com` in `web/.env` and run `scripts/deploy.sh`.

Render's free plan sleeps after 15 minutes without a visit. `.github/workflows/keepalive.yml` visits every
10 minutes, and the dashboard wakes the hub whenever you open it or queue something, so a sleeping hub
still starts the worker within a minute or so. Free instances get 750 hours a month, enough for one
always-on service.

`SWARM_HUB_WORKER=on` runs the worker inside the hub instead of on GitHub. Render has no Docker, though,
so tests then run without the sandbox. Only use that for repositories you trust.

A Hugging Face Space works the same way (`space/`, `scripts/space.py --space you/swarm`), but free Docker
Spaces now need a PRO subscription.

## Option 1: one free VM runs everything

A small always-free virtual machine runs the worker and the server with Docker, so every test gets the full locked-down sandbox.

- **Oracle Cloud Always Free:** Arm VMs with up to 4 cores and 24 GB of memory. The most room of any free option. A card is needed to verify the account.
- **Google Cloud free tier:** one `e2-micro` in some US regions. It has 1 GB of memory, which is tight but workable for small repos. A billing account is needed.

On the VM:

```bash
git clone <your repo> swarm && cd swarm
# copy .env and secrets/service-account.json over (never commit them)
docker compose up -d --build
```

For HTTPS without opening ports, create a free **Cloudflare Tunnel** that points at `http://server:8787`, put its token in `.env` as `CLOUDFLARE_TUNNEL_TOKEN`, and run `docker compose --profile tunnel up -d`. Then:

- set `SWARM_PUBLIC_URL=https://<your tunnel host>` in `.env`
- set `VITE_SWARM_API_URL=https://<your tunnel host>` in `web/.env.local`, then run `scripts/deploy.sh`

## Option 2: no server at all (GitHub Actions)

`.github/workflows/worker.yml` runs one worker pass every 15 minutes on GitHub's runners. They have Docker, so tests still run in the sandbox. This is free for public repositories; private ones get a monthly allowance of minutes.

1. Push this project to GitHub.
2. Go to Settings → Secrets and variables → Actions, and add `FIREBASE_SERVICE_ACCOUNT_JSON` (the whole JSON file) and `GROQ_API_KEY` and/or `GEMINI_API_KEY`.
3. Go to Actions → swarm worker → Run workflow, to test it once.

Trade-offs:
- Runs start within about 15 minutes, not seconds.
- GitHub pauses schedules on repositories with no activity for 60 days.
- There's no always-on server, so MCP and passkeys need Option 1 or 3 as well.

## Option 3: the server on a free web host

`swarm server` is a normal web app, so any Docker host with a free tier can run it. The repo ships a Render blueprint (`render.yaml`):

1. Push this repo to GitHub.
2. Render → New → Blueprint → pick the repo. It creates `swarm-server` on the free plan.
3. Paste `FIREBASE_SERVICE_ACCOUNT_JSON` (the whole JSON) when asked. After the first deploy, set `SWARM_PUBLIC_URL` to the service's `https://…onrender.com` URL and redeploy.
4. Build the web app with `VITE_SWARM_API_URL` set to that URL and `firebase deploy --only hosting`.

It serves MCP at `/mcp`, the A2A gateway at `/a2a` (card at `/.well-known/agent-card.json`), the agents' cards at `/agents`, and passkey sign-in.

- Most free web hosts sleep when idle, so the first MCP call after a quiet spell takes a few seconds.
- They don't allow Docker inside the container, so don't run the worker there. It would fall back to the weaker local sandbox. Pair this option with Option 2 for the worker.

## How the sandbox works, locally and in the cloud

Every test run happens in a **throwaway copy** of the repository, never the real checkout. Swarm picks one of two modes:

- **Docker:** used when Docker is available. Each run gets its own container, which has:
  - no network at all
  - 1 CPU, 1 GB of memory and 256 processes at most
  - no Linux capabilities, and no way to gain privileges
  - a read-only system, with only the repository copy and a small `/tmp` writable
  - a non-root user

  The container is deleted when the run ends. Setting `SWARM_DOCKER_RUNTIME=runsc` adds gVisor, a user-space kernel between the test and the host, where it's installed.
- **Local:** the fallback without Docker. It's a separate process with CPU-time, file-size and wall-clock limits, a stripped environment, and proxies pointed at a dead port. That blocks well-behaved network calls, but not a determined program. Use it only for repositories you trust.

Where it runs after deployment:

- **VM (Option 1):** the worker starts sandbox containers on the VM's own Docker, through the mounted socket. This is the same strong isolation as on your laptop.
- **GitHub Actions (Option 2):** every pass runs on a fresh virtual machine that GitHub throws away afterwards, and each test runs in a Docker container inside it. This is the strongest isolation of the three options.
- **Web hosts (Option 3):** no Docker inside the container, so only the local sandbox is available. That's why the worker shouldn't run there.

Not handled yet: the sandbox doesn't install your repository's own dependencies. Repos that need packages beyond pytest fail to import in the sandbox until that's added.
