---
title: Swarm
emoji: 🐝
colorFrom: yellow
colorTo: green
sdk: docker
app_port: 7860
pinned: false
short_description: Swarm's server - MCP, A2A, passkeys, and the worker trigger
---

# Swarm hub

Swarm's whole server in one FastAPI app (`swarm hub`): MCP over HTTP, the A2A gateway, passkey sign-in for
the web app, and a dispatcher that starts the sandboxed worker on GitHub Actions as soon as there's work.

This Space is deployed from the Swarm repository by `scripts/space.py` and `.github/workflows/space.yml`;
edits made here are overwritten on the next deploy.
