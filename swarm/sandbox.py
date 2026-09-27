"""Isolated execution for patches and agent-written tools.

Every run happens in a throwaway copy of the repository, never the live
checkout. Two backends:

* docker  — one ephemeral container per run: `--network none`, memory/CPU/pid
            limits, every Linux capability dropped, no privilege escalation, a
            read-only root filesystem and an unprivileged user; the repo copy is
            mounted at /work. Used when docker is installed (or forced with
            SWARM_SANDBOX=docker). SWARM_DOCKER_RUNTIME=runsc adds gVisor, which
            puts a user-space kernel between the test and the host.
* local   — a subprocess in a temp copy with CPU-time, file-size and wall-clock
            limits, a scrubbed environment and proxies pointed at a dead port.
            Weaker isolation (no kernel-level network block); the fallback when
            docker is not available.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

from .config import Settings
from .patching import apply_diff
from .retrieval import SKIP_DIRS


@dataclass
class RunResult:
    returncode: int
    stdout: str
    stderr: str
    duration_s: float
    timed_out: bool = False

    @property
    def output(self) -> str:
        return (self.stdout + ("\n" + self.stderr if self.stderr.strip() else "")).strip()


@dataclass
class TestReport:
    passed: int = 0
    failed: int = 0
    errors: int = 0
    skipped: int = 0
    duration_s: float = 0.0
    timed_out: bool = False
    failures: list[str] = field(default_factory=list)
    output_tail: str = ""

    @property
    def total(self) -> int:
        return self.passed + self.failed + self.errors

    @property
    def ok(self) -> bool:
        return self.failed == 0 and self.errors == 0 and not self.timed_out and self.total > 0

    def as_dict(self) -> dict:
        return {
            "passed": self.passed,
            "failed": self.failed,
            "errors": self.errors,
            "skipped": self.skipped,
            "total": self.total,
            "ok": self.ok,
            "timed_out": self.timed_out,
            "duration_s": round(self.duration_s, 2),
            "failures": self.failures,
            "output_tail": self.output_tail,
        }


_SUMMARY = re.compile(r"(\d+) (passed|failed|error|errors|skipped)")
_FAILED_LINE = re.compile(r"^(?:FAILED|ERROR) (\S+)", re.M)


def parse_pytest(result: RunResult) -> TestReport:
    rep = TestReport(duration_s=result.duration_s, timed_out=result.timed_out)
    tail = result.output.strip().splitlines()
    # The summary is pytest's last stdout line, but other libraries may log after it
    # (to stderr, or from a forked child), so search for it instead of trusting position.
    summary = next((l for l in reversed(result.stdout.splitlines()) if _SUMMARY.search(l) and " in " in l), "")
    for n, kind in _SUMMARY.findall(summary):
        if kind == "passed":
            rep.passed = int(n)
        elif kind == "failed":
            rep.failed = int(n)
        elif kind in ("error", "errors"):
            rep.errors = int(n)
        elif kind == "skipped":
            rep.skipped = int(n)
    rep.failures = sorted(set(_FAILED_LINE.findall(result.output)))
    rep.output_tail = "\n".join(tail[-40:])
    if result.timed_out:
        rep.errors = max(rep.errors, 1)
    return rep


SANDBOX_IMAGE = "swarm-sandbox:1"
# Kept here rather than in a file next to the package: a pip install (the cloud worker's) ships only the
# package, so a Dockerfile beside it would be missing and every tester run would fail to build its sandbox.
SANDBOX_DOCKERFILE = """\
FROM python:3.12-slim
RUN pip install --no-cache-dir "pytest>=8" && useradd --uid 1000 --create-home runner
USER 1000:1000
"""
_image_ready: set[str] = set()


def ensure_image(image: str) -> None:
    """Build Swarm's sandbox image the first time it's needed; other images must exist or be pullable."""
    if image in _image_ready:
        return
    have = subprocess.run(["docker", "image", "inspect", image], capture_output=True).returncode == 0
    if not have and image == SANDBOX_IMAGE:
        r = subprocess.run(["docker", "build", "-q", "-t", image, "-"], input=SANDBOX_DOCKERFILE,
                           capture_output=True, text=True, timeout=600)
        if r.returncode:
            raise RuntimeError(f"couldn't build the sandbox image {image}: {(r.stderr or r.stdout).strip()[-600:]}")
    _image_ready.add(image)


def docker_available() -> bool:
    if not shutil.which("docker"):
        return False
    try:
        return subprocess.run(["docker", "info"], capture_output=True, timeout=10).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


class Sandbox:
    def __init__(self, settings: Settings, repo_path: Path | None = None):
        self.settings = settings
        self.repo_path = (repo_path or settings.repo_path).resolve()
        backend = settings.sandbox_backend
        if backend == "auto":
            backend = "docker" if docker_available() else "local"
        self.backend = backend
        self.docker_image = os.environ.get("SWARM_DOCKER_IMAGE", SANDBOX_IMAGE)
        self.docker_runtime = os.environ.get("SWARM_DOCKER_RUNTIME", "")

    @contextmanager
    def workspace(self, diff: str | None = None) -> Iterator[Path]:
        """A disposable copy of the repo, optionally with `diff` applied."""
        tmp = Path(tempfile.mkdtemp(prefix="swarm-sbx-"))
        work = tmp / "repo"
        try:
            shutil.copytree(self.repo_path, work, ignore=shutil.ignore_patterns(*SKIP_DIRS))
            if diff:
                apply_diff(diff, work)
            yield work
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def run(self, work: Path, argv: list[str], env: dict[str, str] | None = None, timeout: int | None = None) -> RunResult:
        timeout = timeout or self.settings.sandbox_timeout_s
        if self.backend == "docker":
            return self._run_docker(work, argv, env or {}, timeout)
        return self._run_local(work, argv, env or {}, timeout)

    def python(self) -> str:
        return "python" if self.backend == "docker" else sys.executable

    def run_pytest(self, work: Path, selector: str | None = None, env: dict[str, str] | None = None) -> TestReport:
        argv = [self.python(), "-m", "pytest", "-q", "-rfE", "-p", "no:cacheprovider"]
        if selector:
            argv.append(selector)
        return parse_pytest(self.run(work, argv, env=env))

    # -- backends ------------------------------------------------------
    def _run_local(self, work: Path, argv: list[str], env: dict[str, str], timeout: int) -> RunResult:
        base_env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": str(work),
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONPATH": str(work),
            # Best-effort network denial for well-behaved clients.
            "http_proxy": "http://127.0.0.1:9",
            "https_proxy": "http://127.0.0.1:9",
            "HTTP_PROXY": "http://127.0.0.1:9",
            "HTTPS_PROXY": "http://127.0.0.1:9",
            "NO_PROXY": "",
        }
        base_env.update(env)

        def limits() -> None:  # runs in the child before exec
            import resource

            cpu = timeout + 5
            resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
            resource.setrlimit(resource.RLIMIT_FSIZE, (64 * 1024 * 1024, 64 * 1024 * 1024))
            os.setsid()

        start = time.monotonic()
        try:
            proc = subprocess.run(
                argv, cwd=work, env=base_env, capture_output=True, text=True, timeout=timeout, preexec_fn=limits
            )
            return RunResult(proc.returncode, proc.stdout, proc.stderr, time.monotonic() - start)
        except subprocess.TimeoutExpired as e:
            return RunResult(
                -9,
                (e.stdout or b"").decode() if isinstance(e.stdout, bytes) else (e.stdout or ""),
                f"timed out after {timeout}s",
                time.monotonic() - start,
                timed_out=True,
            )

    def _run_docker(self, work: Path, argv: list[str], env: dict[str, str], timeout: int) -> RunResult:
        ensure_image(self.docker_image)
        cmd = [
            "docker", "run", "--rm", "--network", "none",
            "--memory", "1g", "--cpus", "1", "--pids-limit", "256",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only",
            "--tmpfs", "/tmp:rw,size=256m",
            # the worker's own uid, so tests can write inside the mounted copy; never root
            "--user", f"{os.getuid() or 1000}:{os.getgid() or 1000}" if hasattr(os, "getuid") else "1000:1000",
            "-v", f"{work}:/work", "-w", "/work", "-e", "PYTHONPATH=/work", "-e", "PYTHONDONTWRITEBYTECODE=1",
            "-e", "HOME=/tmp",
        ]
        if self.docker_runtime:
            cmd += ["--runtime", self.docker_runtime]
        for k, v in env.items():
            cmd += ["-e", f"{k}={v}"]
        cmd += [self.docker_image, *argv]
        start = time.monotonic()
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 30)
            return RunResult(proc.returncode, proc.stdout, proc.stderr, time.monotonic() - start)
        except subprocess.TimeoutExpired:
            return RunResult(-9, "", f"timed out after {timeout}s", time.monotonic() - start, timed_out=True)
