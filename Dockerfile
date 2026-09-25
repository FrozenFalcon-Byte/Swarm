# One image, two commands:
#   swarm -v worker   runs the agents (outbound calls only: Firestore, GitHub, model APIs)
#   swarm server      MCP over HTTP and passkey sign-in, on $PORT (default 8787)
FROM python:3.12-slim

# docker.io gives the worker a docker CLI, so it can start sandbox containers on the host's
# daemon when /var/run/docker.sock is mounted (see docker-compose.yml)
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates docker.io \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml README.md ./
COPY swarm ./swarm
COPY docker ./docker
COPY demo_repo ./demo_repo
COPY demo_issues.json ./
RUN pip install --no-cache-dir ".[server]"

# Secrets come from the environment (see .env.example). FIREBASE_SERVICE_ACCOUNT_JSON is the
# simplest where you can't mount a file.
ENV SWARM_HOME=/data PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=8787
VOLUME /data
EXPOSE 8787
CMD ["swarm", "-v", "worker"]
