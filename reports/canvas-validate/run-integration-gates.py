"""Local validation runner. Reports are ignored task artifacts, not product code."""

import json
import subprocess
import sys
import time
from pathlib import Path

root = Path("/Users/anas/Documents/droid-control/.worktrees/droidex-canvas")
report = root / "reports/canvas-validate"
stem = sys.argv[1]
if not stem.replace("-", "").isalnum():
    raise SystemExit("Invalid report stem")

checks = [
    ("format", ["npm", "run", "format:check"], root),
    ("docs", ["npm", "run", "docs:check"], root),
    ("lint", ["npm", "run", "lint", "--", "--ignore-pattern", "reports/**"], root),
    ("typecheck", ["npm", "run", "typecheck"], root),
    ("sidecar-typecheck", ["npm", "run", "sidecar:typecheck"], root),
    ("electron-check", ["npm", "run", "electron:check"], root),
    ("remote-typecheck", ["npm", "run", "remote:typecheck"], root),
    ("relay-typecheck", ["npm", "run", "relay:typecheck"], root),
    ("file-size", ["npm", "run", "quality:file-size"], root),
    ("design-tokens", ["npm", "run", "quality:design-tokens"], root),
    ("tech-debt", ["npm", "run", "quality:tech-debt"], root),
    ("boundaries", ["npm", "run", "quality:boundaries"], root),
    ("deps", ["npm", "run", "quality:deps"], root),
    ("deadcode", ["npm", "run", "quality:deadcode"], root),
    ("duplicates", ["npm", "run", "quality:duplicates"], root),
    ("test", ["npm", "run", "test"], root),
    (
        "sidecar-tests",
        [
            "node", "--import", "tsx", "--import", "./src/testing/isolatedTestEnv.ts",
            "--test", "--test-concurrency=1", "--test-reporter=spec", "src/**/*.test.ts",
        ],
        root / "sidecar",
    ),
    ("build", ["npm", "run", "build"], root),
    ("runtime", ["npm", "run", "canvas:runtime"], root),
    ("budgets", ["npm", "run", "quality:bundle-budgets"], root),
    (
        "smoke",
        ["./node_modules/.bin/playwright", "test", "--config=playwright.canvas-smoke.config.ts"],
        root,
    ),
]

head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
if subprocess.check_output(["git", "status", "--porcelain"], cwd=root):
    raise SystemExit("Integration is not clean")

results = []
with (report / f"{stem}.log").open("x") as log:
    log.write(head + "\n")
    log.flush()
    for name, command, cwd in checks:
        current = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
        if current != head or subprocess.check_output(["git", "status", "--porcelain"], cwd=root):
            raise SystemExit("Integration changed during validation")
        print(f"Starting {name}", flush=True)
        log.write(f"\n=== {name} ===\n")
        log.flush()
        started = time.monotonic()
        result = subprocess.run(command, cwd=cwd, stdout=log, stderr=subprocess.STDOUT)
        item = {
            "check": name,
            "exit": result.returncode,
            "seconds": round(time.monotonic() - started, 2),
        }
        results.append(item)
        log.write(f"\nEXIT={result.returncode}\n")
        log.flush()
        (report / f"{stem}.json").write_text(
            json.dumps({"head": head, "checks": results}, indent=2) + "\n"
        )
        print(json.dumps(item), flush=True)
        if result.returncode:
            raise SystemExit(result.returncode)
print(f"All integration gates passed for {head}", flush=True)
