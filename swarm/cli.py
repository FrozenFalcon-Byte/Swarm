"""Command line: `swarm demo`, `lab`, `run`, `serve`, `agents`, `worker`, `server`, `hub`, `admin`, `doctor`, `mcp`, `board`,
`tools`."""

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
    lb = sub.add_parser("lab", help="make up a new project full of bugs and issues, then run the swarm on it")
    lb.add_argument("--size", choices=["small", "medium", "large"], default="medium")
    lb.add_argument("--kinds", default="", help="comma-separated: hash-order,jitter,clock,shared-state (default: all)")
    lb.add_argument("--seed", type=int, default=0, help="for the built-in makers; the model is never the same twice")
    lb.add_argument("--no-run", action="store_true", help="only make the project, print where it is")
    ad = sub.add_parser("admin", help="give or take test-lab access in the web app (needs Firebase)")
    ad.add_argument("action", choices=["add", "remove", "list"])
    ad.add_argument("who", nargs="?", help="an email address or a uid")
    r = sub.add_parser("run", help="ingest issues and run agents until idle")
    r.add_argument("--issues", default="demo_issues.json")
    s = sub.add_parser("serve", help="start the live dashboard + API")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8000)
    s.add_argument("--demo", action="store_true", help="reset to a fresh demo workspace first")
    ag = sub.add_parser("agents", help="serve the four agents over A2A on the local board, for any A2A client")
    ag.add_argument("--host", default="127.0.0.1")
    ag.add_argument("--port", type=int, default=9100)
    w = sub.add_parser("worker", help="service mode: process runs and actions from Firebase")
    w.add_argument("--once", action="store_true", help="do everything that's waiting, then exit (for cron or CI schedules)")
    sv = sub.add_parser("server", help="MCP over HTTP for many clients, plus passkey sign-in for the web app")
    sv.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    sv.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8787")))
    hb = sub.add_parser("hub", help="everything in one FastAPI app for one free host (MCP, A2A, passkeys, and starting the worker)")
    hb.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"))
    hb.add_argument("--port", type=int, default=int(os.environ.get("PORT", "7860")))
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

    if args.cmd == "admin":
        return _admin(args.action, args.who)

    if args.cmd == "lab":
        return _lab(settings, args)

    if args.cmd in ("demo",) or (args.cmd == "serve" and args.demo):
        if settings.home.exists():
            shutil.rmtree(settings.home)
        settings.ensure_dirs()
        prepare_demo_workspace(settings)
    elif args.cmd in ("serve", "run", "board", "tools", "agents") and (settings.home / "workspace" / "tagkit").exists() \
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

    if args.cmd == "hub":
        from .hub import serve as serve_hub

        serve_hub(settings, args.host, args.port)
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
    if args.cmd == "agents":
        swarm.network.serve(args.host, args.port)
        return 0
    if args.cmd in ("demo", "run"):
        print(f"repo: {settings.repo_path}\nsandbox: {swarm.sandbox.backend} | LLM: {swarm.llm.describe()['active'] or 'off (heuristics)'}")
        swarm.ingest(swarm.load_issues(getattr(args, "issues", None)))
        sent = swarm.run_until_idle()
        print(f"agents exchanged {sent} A2A messages")
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


def _lab(settings: Settings, args) -> int:
    import json

    from . import lab
    from .issues import Issue
    from .llm import LLM

    if settings.home.exists():
        shutil.rmtree(settings.home)
    settings.ensure_dirs()
    spec = {"seed": args.seed or lab.new_seed(), "size": args.size,
            "kinds": [k.strip() for k in args.kinds.split(",") if k.strip()] or None}
    rec = lab.make_wave(spec, lab.LabState(), LLM(settings), settings, say=lambda m: print(f"  lab: {m}"))
    dest = settings.home / "workspace" / rec["package"]
    lab.materialize(rec["files"], dest)
    (settings.home / "workspace" / "issues.json").write_text(json.dumps(rec["issues"], indent=1))
    (settings.home / "workspace" / "answers.json").write_text(json.dumps(rec["bugs"], indent=1))
    print(f"\n{rec['package']}: {rec['description']}\n  {dest}\n  {len(rec['issues'])} issues, made by {rec['via']}")
    for b in rec["bugs"]:
        print(f"  #{b['issue']:<3} {b['kind']:<13} {b['test']}")
    if args.no_run:
        return 0
    settings.repo_path = dest.resolve()
    swarm = Swarm(settings)
    swarm.ingest([Issue(i["number"], i["title"], i["body"], i.get("labels", [])) for i in rec["issues"]])
    print(f"\nagents exchanged {swarm.run_until_idle()} A2A messages")
    print_board(swarm)
    print("\n== Tool registry")
    print_tools(swarm)
    return 0


def _admin(action: str, who: str | None) -> int:
    from firebase_admin import auth
    from google.cloud import firestore as gfs

    from .cloud import firebase

    firebase.app()
    admins = firebase.db().collection("admins")
    if action == "list":
        for snap in admins.stream():
            print(f"  {snap.id}  {(snap.to_dict() or {}).get('email', '')}")
        return 0
    if not who:
        print("say who: an email address or a uid")
        return 2
    user = auth.get_user_by_email(who) if "@" in who else auth.get_user(who)
    if action == "add":
        admins.document(user.uid).set({"email": user.email, "addedAt": gfs.SERVER_TIMESTAMP})
        print(f"{user.email} ({user.uid}) can now use the test lab")
    else:
        admins.document(user.uid).delete()
        print(f"{user.email} ({user.uid}) no longer has test-lab access")
    return 0


if __name__ == "__main__":
    sys.exit(main())
