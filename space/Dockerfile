# Swarm hub on a Hugging Face Space (Docker SDK). Built from a copy of the Swarm repository that
# scripts/space.py and .github/workflows/space.yml push here. Secrets come from the Space's settings.
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# Spaces run the container as uid 1000
RUN useradd -m -u 1000 user
WORKDIR /home/user/app
COPY --chown=user pyproject.toml README.md ./
COPY --chown=user swarm ./swarm
COPY --chown=user demo_repo ./demo_repo
COPY --chown=user demo_issues.json ./
RUN pip install --no-cache-dir ".[server,cloud]"

USER user
ENV HOME=/home/user SWARM_HOME=/tmp/swarm PORT=7860 HOST=0.0.0.0 PYTHONUNBUFFERED=1
EXPOSE 7860
CMD ["swarm", "hub"]
