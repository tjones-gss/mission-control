"""Write a human-readable summary of one loop attempt to .oversight/logs/attempts/.

Usage (programmatic — called by run_job_loop.py):
  summarize_attempt(job_id, iteration, before_score, after_score, diff_text, notes)

Usage (CLI for inspecting an existing attempt JSON):
  python .oversight/scripts/summarize_attempt.py <attempt.json>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from _common import OVERSIGHT, ensure_dir, now_stamp, write_json  # type: ignore


def write_attempt(
    job_id: str,
    iteration: int,
    before_score: int | None,
    after_score: int | None,
    accepted: bool,
    reason: str,
    diff_text: str = "",
    eval_results: list | None = None,
    notes: str = "",
) -> Path:
    folder = OVERSIGHT / "logs" / "attempts" / job_id
    ensure_dir(folder)
    ts = now_stamp()
    record = {
        "job_id": job_id,
        "iteration": iteration,
        "timestamp": ts,
        "before_score": before_score,
        "after_score": after_score,
        "delta": (after_score - before_score) if (before_score is not None and after_score is not None) else None,
        "accepted": accepted,
        "reason": reason,
        "notes": notes,
        "eval_results": eval_results or [],
    }
    json_path = folder / f"{ts}__iter{iteration:02d}.json"
    write_json(json_path, record)
    if diff_text:
        (folder / f"{ts}__iter{iteration:02d}.diff").write_text(diff_text, encoding="utf-8")
    return json_path


def main(argv: list[str]) -> int:
    if not argv:
        print("Usage: summarize_attempt.py <attempt.json>", file=sys.stderr)
        return 2
    doc = json.loads(Path(argv[0]).read_text(encoding="utf-8"))
    print(f"Job:       {doc['job_id']}")
    print(f"Iteration: {doc['iteration']}")
    print(f"Accepted:  {doc['accepted']}  ({doc['reason']})")
    print(f"Score:     {doc['before_score']} -> {doc['after_score']}  (Δ={doc['delta']})")
    if doc.get("notes"):
        print(f"Notes:     {doc['notes']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
