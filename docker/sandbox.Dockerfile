# The image every sandboxed test run uses: Python and pytest, nothing else.
# Swarm builds it on first use as swarm-sandbox:1 (or set SWARM_DOCKER_IMAGE to your own).
FROM python:3.12-slim
RUN pip install --no-cache-dir "pytest>=8" && useradd --uid 1000 --create-home runner
USER 1000:1000
