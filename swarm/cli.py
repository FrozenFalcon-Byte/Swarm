"""Command line: `swarm demo`, `run`, `serve`, `worker`, `server`, `doctor`, `mcp`, `board`, `tools`."""

from __future__ import annotations

import os

# gRPC (used by Firestore) logs fork warnings from every sandbox subprocess otherwise.
os.environ.setdefault("GRPC_VERBOSITY", "ERROR")
os.environ.setdefault("GRPC_ENABLE_FORK_SUPPORT", "false")

import argparse
import logging
import shutil
import sys

from . import env
from .config import Settings
from .orchestrator import Swarm, prepare_demo_workspace

STATE_ORDER = ["New Issue", "Triaged", "In Progress", "Awaiting Tests", "In Review", "Rejected",
               "Approved", "Needs Human", "Merged", "Closed"]


def print_board(swarm: Swarm) -> None:
    for state in STATE_ORDER:
        tasks = [t for t in swarm.board.list() if t.state.value == state]
        if not tasks:
            continue
        print(f"\n== {state} ({len(tasks)})")
        for t in tasks:
            note = f" — {t.note}" if t.note else ""
            print(f"  {t.task_id} {t.source_issue:>5} [{t.kind}/{t.priority}] {t.title}{note}")


def print_tools(swarm: Swarm) -> None:
    for r in swarm.registry.all():
        print(f"  {r.tool_id}: validated={r.validated} used={r.usage_count}x by {', '.join(r.used_by_tasks)}\n    {r.description}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="swarm")
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("demo", help="reset state, run the whole pipeline on the demo repo, print the board")
    d.add_argument("--merge", action="store_true", help="also merge approved tasks (as the human)")
    r = sub.add_parser("run", help="ingest issues and run agents until idle")
    r.add_argument("--issues", default="demo_issues.json")
    s = sub.add_parser("serve", help="start the live dashboard + API")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8000)
    s.add_argument("--demo", action="store_true", help="reset to a fresh demo workspace first")
    w = sub.add_parser("worker", help="service mode: process runs and actions from Firebase")
    w.add_argument("--once", action="store_true", help="do everything that's waiting, then exit (for cron or CI schedules)")
    sv = sub.add_parser("server", help="MCP over HTTP for many clients, plus passkey sign-in for the web app")
    sv.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    sv.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8787")))
    sub.add_parser("doctor", help="check Firebase, GitHub and model connections, and say how to fix gaps")
    m = sub.add_parser("mcp", help="serve the board over MCP (stdio) for Claude and other MCP clients")
    m.add_argument("--cloud", action="store_true", help="use repositories in Firebase instead of the local board")
    sub.add_parser("board", help="print the board")
    sub.add_parser("tools", help="print the tool registry")
    args = ap.parse_args(argv)
    env_file = env.load()

    logging.basicConfig(level=logging.INFO if args.verbose or args.cmd == "demo" else logging.WARNING,
                        format="%(name)-16s %(message)s")
    for noisy in ("httpx", "httpcore", "google", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    settings = Settings()

    if args.cmd == "doctor":
        from . import doctor

        checks = doctor.run(settings, str(env_file) if env_file else None)
        print(doctor.render(checks))
        return 1 if any(c.status == "fail" for c in checks) else 0

    if args.cmd in ("demo",) or (args.cmd == "serve" and args.demo):
        if settings.home.exists():
            shutil.rmtree(settings.home)
        settings.ensure_dirs()
        prepare_demo_workspace(settings)
    elif args.cmd in ("serve", "run", "board", "tools") and (settings.home / "workspace" / "tagkit").exists() \
            and "SWARM_REPO" not in os.environ:
        settings.repo_path = (settings.home / "workspace" / "tagkit").resolve()

    if args.cmd == "mcp":
        from .mcp_server import serve

        serve(settings, cloud=args.cloud)  # stdout belongs to the protocol from here on
        return 0

    if args.cmd == "worker":
        from .cloud.worker import Worker

        worker = Worker(settings)
        if args.once:
            worker.run_once()
        else:
            worker.run_forever()
        return 0

    if args.cmd == "server":
        from .server import serve as serve_http

        serve_http(settings, args.host, args.port)
        return 0

    if args.cmd == "serve":
        import uvicorn

        from .api import create_app

        uvicorn.run(create_app(settings), host=args.host, port=args.port, log_level="warning")
        return 0

    swarm = Swarm(settings)
    if args.cmd in ("demo", "run"):
        print(f"repo: {settings.repo_path}\nsandbox: {swarm.sandbox.backend} | LLM: {swarm.llm.describe()['active'] or 'off (heuristics)'}")
        swarm.ingest(swarm.load_issues(getattr(args, "issues", None)))
        swarm.run_until_idle()
        if getattr(args, "merge", False):
            for t in swarm.board.list():
                if t.state.value == "Approved":
                    swarm.merge(t.task_id)
    if args.cmd in ("demo", "run", "board"):
        print_board(swarm)
    if args.cmd in ("demo", "tools"):
        print("\n== Tool registry")
        print_tools(swarm)
    return 0


if __name__ == "__main__":
    sys.exit(main())
