# Setting up Swarm for real

Swarm has three parts, and each reads its keys from its own file:

| Part | Runs where | Its keys live in | Secret? |
|---|---|---|---|
| Web app (landing page, sign-in, dashboard) | Firebase Hosting, or `npm run dev` | `web/.env.local` | No. These are public identifiers; the security rules protect the data |
| Worker (runs the agents) | Any machine that stays on | `.env` in the project root | **Yes.** Never commit it |
| Your GitHub connection | Saved per user, in Firestore | Entered in the app: Settings → Connections | **Yes.** Only you can read yours |

After filling things in, run `swarm doctor`. It checks every connection and tells you what's still missing.

---

## 1. Firebase project (about 10 minutes)

1. Go to **console.firebase.google.com** → **Create a project**. Google Analytics is optional.
2. **Build → Authentication → Get started.** Enable the sign-in methods you want:
   - **Email/Password**: toggle it on.
   - **Google**: toggle it on and pick a support email.
   - **GitHub**: see step 3.
3. **GitHub sign-in** (lets users sign in with GitHub and connect repos in one step):
   1. In Firebase, turn on the GitHub provider and copy the **callback URL** it shows (`https://<project>.firebaseapp.com/__/auth/handler`).
   2. Open **github.com/settings/developers → OAuth Apps → New OAuth App**. Set the homepage to your site and the *Authorization callback URL* to the callback URL from Firebase.
   3. Copy the new app's **Client ID**, click **Generate a new client secret**, and paste both into the Firebase GitHub provider. Save.
4. **Build → Firestore Database → Create database.** Choose *production mode* and a region close to you.
5. **Storage is optional.** New projects need the Blaze (pay-as-you-go) plan for it. On the free Spark plan, leave `FIREBASE_STORAGE_BUCKET` empty: Swarm keeps agent-written tools in Firestore and the diffs and evidence on each task. If you upgrade later, enable Storage and set the bucket in both env files.
6. **Authentication → Settings → Authorized domains.** `localhost` and `<project>.web.app` are there already. Add your own domain if you use one.

### Web config → `web/.env.local`

**Project settings (gear icon) → General → Your apps → Add app → Web (`</>`)**. Register it; you don't need Firebase Hosting setup here. Copy the values from the `firebaseConfig` it shows:

```bash
cp web/.env.example web/.env.local
```

```ini
VITE_FIREBASE_API_KEY=AIza...                              # apiKey
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com     # authDomain
VITE_FIREBASE_PROJECT_ID=your-project                      # projectId
VITE_FIREBASE_STORAGE_BUCKET=                              # empty on the Spark plan
VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890               # messagingSenderId
VITE_FIREBASE_APP_ID=1:1234567890:web:abc123               # appId
VITE_USE_EMULATORS=false
```

If a value is missing, sign-in shows a "Connect a Firebase project" screen that lists what's absent.

### Service account → `.env` (the worker)

**Project settings → Service accounts → Generate new private key.** This downloads a JSON file. It gives full admin access to your project, so keep it out of git:

```bash
mkdir -p secrets && mv ~/Downloads/your-project-*.json secrets/service-account.json
cp .env.example .env
```

```ini
FIREBASE_PROJECT_ID=your-project
FIREBASE_STORAGE_BUCKET=                       # empty on the Spark plan
GOOGLE_APPLICATION_CREDENTIALS=./secrets/service-account.json
```

On a host that only takes environment variables (Railway, Fly, Render), paste the whole JSON into `FIREBASE_SERVICE_ACCOUNT_JSON` instead.

### Deploy the rules and the site

```bash
npx firebase-tools login          # once
scripts/deploy.sh                 # builds web/, deploys Firestore rules, indexes and Hosting (Storage rules too if you set a bucket)
```

Your dashboard is then at `https://your-project.web.app`. `scripts/deploy.sh rules` deploys only the rules.

---

## 2. Models: where the agents get their brains

They're tried in this order, and with none at all the agents use built-in heuristics. One free key is enough; two gives a fallback when a rate limit hits. Put the keys in `.env`:

| Provider | Cost | Get a key | Variable |
|---|---|---|---|
| Groq | Free tier, very fast | **console.groq.com/keys** → Create API key | `GROQ_API_KEY` |
| Google Gemini | Free tier | **aistudio.google.com/apikey** → Create API key | `GEMINI_API_KEY` |
| OpenRouter | Free models (`:free`) | **openrouter.ai/settings/keys** → Create key | `OPENROUTER_API_KEY` |
| Anthropic | Paid | **console.anthropic.com** → API keys | `ANTHROPIC_API_KEY` |

A local Ollama model still works: add `ollama` to `SWARM_LLM_PROVIDERS`.

---

## 3. GitHub

Users connect their own GitHub, so the worker needs no GitHub key.

- **Sign in with GitHub**, or **Settings → Connections → Connect GitHub** for accounts made with email or Google. This asks for the `repo` scope, which lets the worker read issues, clone private repos and open pull requests.
- **Or use a token:** Settings → *Use a token instead*. Create a fine-grained token at **github.com/settings/personal-access-tokens/new**, limited to the repos you want, with **Contents: read and write**, **Issues: read** and **Pull requests: read and write**.

Optionally, set `GITHUB_TOKEN` in the worker's `.env`. It's a fallback for repos whose owner hasn't connected GitHub, and it raises the rate limit for public repos.

The worker checks connected repos for new or edited issues every `SWARM_SYNC_MINUTES` (default 10) and runs the swarm when it finds some. Each repo has a *Watch for new issues* switch to turn this off.

---

## 4. Run the worker

```bash
python3 -m venv .venv && .venv/bin/pip install -e ".[cloud]"
.venv/bin/swarm doctor      # all green?
.venv/bin/swarm -v worker   # leave it running
```

Or in Docker, on any server:

```bash
docker build -t swarm-worker .
docker run -d --restart unless-stopped --env-file .env -v "$PWD/secrets:/app/secrets:ro" -v swarm-data:/data swarm-worker
```

The dashboard's sidebar shows **Agents online** once the worker checks in.

---

## 5. Use Swarm from Claude (MCP)

`swarm mcp` is an MCP server, so Claude Desktop, Claude Code or any MCP client can read your board, look up tasks and harnesses, start a run and send a patch back with feedback. Merging stays in the dashboard. See Settings → *Use from Claude* for copy-paste config.

---

## Local testing without any of the above

```bash
npx firebase-tools emulators:start --project demo-swarm      # needs Java 21+
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 \
  GCLOUD_PROJECT=demo-swarm .venv/bin/swarm -v worker
cd web && VITE_USE_EMULATORS=true npm run dev
```
