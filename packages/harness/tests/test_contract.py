#!/usr/bin/env python3
"""
tests/test_contract.py — Cross-language contract test for `harness status --json`.

The cockpit (Node/React) does NOT reparse harness YAML; it shells out to
`harness status --json` and renders the structured output. That JSON shape is
the contract boundary, defined once in the SHARED schema:

    packages/contracts/schemas/harness-status.schema.json

Until now nothing on the Python side validated the CLI's emitted shape against
that schema, so a rename like `readiness_overall` -> `readiness` would only be
caught (if at all) on the cockpit side. This test closes that gap: it runs the
real CLI and validates its output against the shared schema, so cross-language
drift FAILS a test here too.

Dev dependency:
    jsonschema  (pip install jsonschema)

If jsonschema is not installed, the contract assertions are skipped with a
clear message rather than failing — the suite stays green where the dev
dependency is absent, but the check runs (and bites) wherever it is present.

Run:
    python -m pytest packages/harness/tests/test_contract.py
    python3 tests/test_contract.py     # also works as a unittest module
"""

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

# tools/harness lives one level up from tests/.
HARNESS_ROOT = Path(__file__).resolve().parent.parent
CLI = HARNESS_ROOT / "tools" / "harness"

# The shared schema lives in the sibling contracts package:
# .../packages/harness/tests/test_contract.py
#   parent(tests) -> harness, parent -> packages, /contracts/schemas/...
SCHEMA_PATH = (
    HARNESS_ROOT.parent
    / "contracts"
    / "schemas"
    / "harness-status.schema.json"
)

# jsonschema is a dev dependency. Import lazily so the module still loads (and
# skips cleanly) on machines that don't have it installed.
try:
    import jsonschema  # type: ignore
    from jsonschema import Draft202012Validator  # type: ignore

    _HAVE_JSONSCHEMA = True
    _JSONSCHEMA_SKIP = ""
except ImportError:  # pragma: no cover - exercised only where dep is absent
    jsonschema = None  # type: ignore
    Draft202012Validator = None  # type: ignore
    _HAVE_JSONSCHEMA = False
    _JSONSCHEMA_SKIP = (
        "jsonschema is required for the harness/cockpit contract test "
        "(`pip install jsonschema`). Skipping so the suite stays green where "
        "the dev dependency is absent."
    )


def run_status_json():
    """Invoke `harness status --json` from the harness dir (which has a .harness)."""
    env = os.environ.copy()
    proc = subprocess.run(
        [sys.executable, str(CLI), "status", "--json"],
        capture_output=True,
        text=True,
        cwd=str(HARNESS_ROOT),
        env=env,
        timeout=30,
    )
    return proc


@unittest.skipUnless(_HAVE_JSONSCHEMA, _JSONSCHEMA_SKIP)
class TestStatusJsonContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        proc = run_status_json()
        if proc.returncode != 0:
            raise AssertionError(
                f"`harness status --json` exited {proc.returncode}\n"
                f"STDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"
            )
        cls.status = json.loads(proc.stdout)

    def test_schema_file_exists(self):
        self.assertTrue(
            SCHEMA_PATH.exists(),
            f"shared schema not found at {SCHEMA_PATH}",
        )

    def test_cli_output_validates_against_shared_schema(self):
        """The whole point: emitted JSON must satisfy the shared contract.

        If someone renames a required key (e.g. `pipeline`) or changes a field
        type the schema rejects, this fails — cross-language drift caught on the
        Python side.
        """
        # Collect every error so a failure message is actionable, not just the first.
        validator = Draft202012Validator(self.schema)
        errors = sorted(validator.iter_errors(self.status), key=lambda e: e.path)
        if errors:
            detail = "\n".join(
                f"  - at {list(e.path) or '<root>'}: {e.message}" for e in errors
            )
            self.fail(
                "`harness status --json` output does NOT match the shared "
                f"schema ({SCHEMA_PATH.name}):\n{detail}\n\n"
                f"Emitted JSON:\n{json.dumps(self.status, indent=2)}"
            )

    def test_top_level_required_keys_present_and_valid(self):
        """Explicitly assert the keys the cockpit depends on validate.

        `pipeline` is schema-required; `readiness_overall` is the field whose
        rename is the canonical drift example called out in the contract.
        """
        # pipeline: required by the schema and consumed by the cockpit.
        self.assertIn(
            "pipeline",
            self.status,
            "contract requires a top-level 'pipeline' key",
        )
        self.assertIsInstance(self.status["pipeline"], dict)

        # readiness_overall: the canonical drift example. If it were renamed,
        # this assertion (and the schema validation of its sub-shape) fails.
        self.assertIn(
            "readiness_overall",
            self.status,
            "contract expects a top-level 'readiness_overall' key — if this "
            "was renamed, the cockpit's readiness display drifts",
        )
        readiness = self.status["readiness_overall"]
        self.assertIsInstance(readiness, dict)

        # Validate just the readiness_overall sub-shape against its schema slice
        # so a type drift inside it (e.g. score becomes a string) also fails.
        readiness_schema = self.schema["properties"]["readiness_overall"]
        Draft202012Validator(readiness_schema).validate(readiness)

        # Validate the pipeline sub-shape against its schema slice too.
        pipeline_schema = self.schema["properties"]["pipeline"]
        Draft202012Validator(pipeline_schema).validate(self.status["pipeline"])

    def test_drift_is_caught_and_by_which_guard(self):
        """Guard the guard — and be honest about which check catches which drift.

        The shared schema is deliberately PERMISSIVE (top-level extra keys
        allowed, readiness_overall optional) for backward-compat with older
        harness installs. So schema validation alone does NOT catch a
        `readiness_overall` -> `readiness` *rename* — the renamed key is just an
        extra property and the missing optional key is fine. That specific
        rename (the canonical drift example) is caught instead by the explicit
        presence assertion in test_top_level_required_keys_present_and_valid.
        This test documents all three facts so the guarantee isn't overstated.
        """
        validator = Draft202012Validator(self.schema)

        # (a) Dropping a SCHEMA-REQUIRED key (pipeline) IS caught by the schema.
        broken = dict(self.status)
        broken.pop("pipeline", None)
        self.assertTrue(
            list(validator.iter_errors(broken)),
            "schema failed to reject output missing the required 'pipeline' key",
        )

        # (b) A TYPE drift inside readiness_overall IS caught by the schema.
        type_drift = json.loads(json.dumps(self.status))
        type_drift.setdefault("readiness_overall", {})["score"] = "not-a-number"
        self.assertTrue(
            list(validator.iter_errors(type_drift)),
            "schema failed to reject a non-numeric readiness_overall.score",
        )

        # (c) A readiness_overall -> readiness RENAME is NOT caught by the
        #     permissive schema (it passes) — so the explicit presence assertion
        #     in test_top_level_required_keys_present_and_valid is what guards it.
        #     We assert both halves so the protection model is documented, not
        #     assumed: the schema accepts the rename, and the rename really did
        #     remove the key the presence test checks for.
        renamed = json.loads(json.dumps(self.status))
        renamed["readiness"] = renamed.pop("readiness_overall", None)
        self.assertEqual(
            list(validator.iter_errors(renamed)),
            [],
            "expected the permissive schema to ACCEPT a rename (extra prop); the "
            "rename is caught by the presence assertion, not by schema validation",
        )
        self.assertNotIn(
            "readiness_overall",
            renamed,
            "rename simulation should have removed readiness_overall, so the "
            "presence assertion in the sibling test would fail on real drift",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
