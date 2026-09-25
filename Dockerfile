# The Swarm worker: runs anywhere that can stay on (a VM, Fly.io, Railway, Render, a spare laptop).
# It makes outbound calls only (Firestore, Storage, GitHub, model APIs), so no ports are exposed.
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml README.md ./
COPY swarm ./swarm
COPY demo_repo ./demo_repo
COPY demo_issues.json ./
RUN pip install --no-cache-dir ".[cloud]"

# Set secrets as environment variables on your host (see .env.example); FIREBASE_SERVICE_ACCOUNT_JSON
# is the simplest when you can't mount a file. Models: point OLLAMA_HOST at an Ollama server, or use a key.
ENV SWARM_HOME=/data PYTHONUNBUFFERED=1
VOLUME /data
USER 1000:1000
CMD ["swarm", "-v", "worker"]
