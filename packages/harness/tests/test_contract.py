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

If jsonschema is not installed the contract assertions now ERROR (fail) with a
clear install hint rather than silently skipping. CI installs `jsonschema`, so
a silent skip would let the golden-sample/schema check quietly stop running and
contract drift would ship unnoticed. Failing closed is the point.

Run:
    python -m pytest packages/harness/tests/test_contract.py
    python3 tests/test_contract.py     # also works as a unittest module
"""

import json
import os
import shutil
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

# jsonschema is a dev dependency. Import lazily so the module still LOADS on a
# machine without it (so collection doesn't crash), but the contract test then
# ERRORS rather than skipping — failing closed so the check can't silently stop
# running in CI (which installs jsonschema).
try:
    import jsonschema  # type: ignore
    from jsonschema import Draft202012Validator  # type: ignore

    _HAVE_JSONSCHEMA = True
    _JSONSCHEMA_ERROR = ""
except ImportError:  # pragma: no cover - exercised only where dep is absent
    jsonschema = None  # type: ignore
    Draft202012Validator = None  # type: ignore
    _HAVE_JSONSCHEMA = False
    _JSONSCHEMA_ERROR = (
        "jsonschema is required for the harness/cockpit contract test "
        "(`pip install jsonschema`). This test fails closed instead of "
        "skipping: CI installs jsonschema, and a silent skip would let "
        "contract drift ship unnoticed."
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


class TestStatusJsonContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Fail closed: if jsonschema is missing the whole class errors with a
        # clear hint instead of silently skipping (CI installs jsonschema).
        if not _HAVE_JSONSCHEMA:
            raise AssertionError(_JSONSCHEMA_ERROR)
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


def _load_harness_module():
    """Import the `tools/harness` CLI as a module.

    `tools/harness` has no `.py` extension, so the default file finder won't
    give it a loader. Use an explicit SourceFileLoader to read it as Python.
    """
    import importlib.util
    from importlib.machinery import SourceFileLoader

    loader = SourceFileLoader("harness_cli_under_test", str(CLI))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


# The single canonical source of truth for the contracts package versions.
# .../packages/harness/tests/test_contract.py
#   parent(tests) -> harness, parent -> packages, /contracts/schema-version.json
VERSION_SIDECAR_PATH = (
    HARNESS_ROOT.parent / "contracts" / "schema-version.json"
)


class TestSchemaVersionParity(unittest.TestCase):
    """Cross-language version parity (council MED #7, plan 1d).

    The Python harness must DERIVE its version numbers from the single canonical
    contracts sidecar (schema-version.json) rather than hand-copying them. This
    test asserts the Python-resolved values equal that sidecar, so a one-sided
    change (editing the Python constant OR the sidecar but not the other) turns
    CI red. There are TWO independent version concepts and each is asserted:

      - schemaVersion          : the contracts package version as a whole
      - approvalSchemaVersion  : the per-document version stamped into
                                 approval-request / approval-decision files
    """

    @classmethod
    def setUpClass(cls):
        cls.sidecar_present = VERSION_SIDECAR_PATH.exists()
        if cls.sidecar_present:
            cls.sidecar = json.loads(
                VERSION_SIDECAR_PATH.read_text(encoding="utf-8")
            )
        cls.mod = _load_harness_module()

    def test_canonical_sidecar_exists(self):
        self.assertTrue(
            self.sidecar_present,
            f"canonical version sidecar not found at {VERSION_SIDECAR_PATH}; "
            "it is the single source both JS and Python derive from",
        )

    def test_python_does_not_hand_code_the_version(self):
        """The CLI must expose a resolver that reads the sidecar, not a literal."""
        self.assertTrue(
            hasattr(self.mod, "_resolve_schema_versions"),
            "harness CLI must expose `_resolve_schema_versions()` that derives "
            "the versions from packages/contracts/schema-version.json",
        )

    def test_approval_schema_version_matches_sidecar(self):
        if not self.sidecar_present:
            self.skipTest("sidecar absent (standalone harness install)")
        resolved = self.mod._resolve_schema_versions()
        self.assertEqual(
            resolved["approvalSchemaVersion"],
            self.sidecar["approvalSchemaVersion"],
            "Python-resolved approvalSchemaVersion drifted from the canonical "
            "sidecar — a one-sided change. Update schema-version.json (the "
            "single source), never hand-edit a copy.",
        )
        # The module-level constant the CLI actually stamps into files must
        # equal the resolved value too (no stale hand-copied literal).
        self.assertEqual(
            self.mod.APPROVAL_SCHEMA_VERSION,
            self.sidecar["approvalSchemaVersion"],
            "APPROVAL_SCHEMA_VERSION constant drifted from the canonical sidecar",
        )

    def test_fallback_constants_match_sidecar(self):
        """The standalone-install fallback literals must not silently drift.

        _*_FALLBACK are only USED when the sidecar is absent, but when it IS
        present (CI) assert they agree, so bumping schema-version.json can never
        leave a stale fallback behind (the exact drift a 5-vs-6 review caught).
        """
        if not self.sidecar_present:
            self.skipTest("sidecar absent (standalone harness install)")
        self.assertEqual(
            self.mod._SCHEMA_VERSION_FALLBACK,
            self.sidecar["schemaVersion"],
            "_SCHEMA_VERSION_FALLBACK drifted from the canonical sidecar; bump it "
            "when schema-version.json changes (it is the no-sidecar fallback).",
        )
        self.assertEqual(
            self.mod._APPROVAL_SCHEMA_VERSION_FALLBACK,
            self.sidecar["approvalSchemaVersion"],
            "_APPROVAL_SCHEMA_VERSION_FALLBACK drifted from the canonical sidecar",
        )

    def test_javascript_and_python_resolve_the_same_versions(self):
        """The actual cross-language gate: JS-exported == Python-resolved.

        Both sides DERIVE from the sidecar, so this is the test that bites a
        one-sided change — e.g. someone re-hardcodes a literal on either side, or
        the JS index stops reading the sidecar. It shells out to Node to read the
        real exported constants from @mission-control/contracts and compares them
        to the Python resolver. Skipped only if Node isn't on PATH (Python-only
        CI lane); the cockpit lane always has Node.
        """
        node = shutil.which("node")
        if node is None:
            self.skipTest("node not on PATH (Python-only environment)")
        contracts_index = (
            HARNESS_ROOT.parent / "contracts" / "index.js"
        ).resolve()
        if not contracts_index.exists():
            self.skipTest("contracts package absent (standalone harness install)")
        script = (
            "import('file://' + process.argv[1])"
            ".then(m => process.stdout.write(JSON.stringify({"
            "schemaVersion: m.SCHEMA_VERSION, "
            "approvalSchemaVersion: m.APPROVAL_SCHEMA_VERSION})))"
        )
        proc = subprocess.run(
            [node, "--input-type=module", "-e", script, str(contracts_index)],
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(
            proc.returncode,
            0,
            f"failed to read JS contract versions:\nSTDERR:\n{proc.stderr}",
        )
        js = json.loads(proc.stdout)
        py = self.mod._resolve_schema_versions()
        self.assertEqual(
            js["schemaVersion"],
            py["schemaVersion"],
            "JS SCHEMA_VERSION and Python-resolved schemaVersion DRIFTED — a "
            "one-sided change. Both must derive from schema-version.json.",
        )
        self.assertEqual(
            js["approvalSchemaVersion"],
            py["approvalSchemaVersion"],
            "JS APPROVAL_SCHEMA_VERSION and Python-resolved approvalSchemaVersion "
            "DRIFTED — a one-sided change.",
        )

    def test_package_schema_version_matches_sidecar(self):
        if not self.sidecar_present:
            self.skipTest("sidecar absent (standalone harness install)")
        resolved = self.mod._resolve_schema_versions()
        self.assertEqual(
            resolved["schemaVersion"],
            self.sidecar["schemaVersion"],
            "Python-resolved package schemaVersion drifted from the canonical "
            "sidecar — update schema-version.json, the single source.",
        )


PIPELINE_PHASE_SCHEMA_PATH = (
    HARNESS_ROOT.parent
    / "contracts"
    / "schemas"
    / "pipeline-phase.schema.json"
)
PIPELINES_DIR = HARNESS_ROOT / "pipelines"


class TestPipelinePhaseSchemaConsumed(unittest.TestCase):
    """Phase 2: pipeline-phase schema is the CONSUMED spine contract.

    The schema was relaxed (v7) so it validates the real authored pipeline YAML:
    id/agent/gate required; tier/strategy/goal optional; the authored fields
    (description/inputs/outputs/rules/loop/...) accepted; additionalProperties
    stays false so a typo in a known field still fails. This test guards that
    relaxation directly at the schema layer — every phase of every shipped
    pipeline must validate, and an unknown field must still be rejected.
    """

    @classmethod
    def setUpClass(cls):
        if not _HAVE_JSONSCHEMA:
            raise AssertionError(_JSONSCHEMA_ERROR)
        cls.schema = json.loads(
            PIPELINE_PHASE_SCHEMA_PATH.read_text(encoding="utf-8")
        )
        cls.validator = Draft202012Validator(cls.schema)
        try:
            import yaml  # type: ignore
        except ImportError as exc:  # pragma: no cover - pyyaml is a runtime dep
            raise AssertionError("pyyaml required for pipeline schema test") from exc
        cls.yaml = yaml

    def test_schema_file_exists(self):
        self.assertTrue(
            PIPELINE_PHASE_SCHEMA_PATH.exists(),
            f"pipeline-phase schema not found at {PIPELINE_PHASE_SCHEMA_PATH}",
        )

    def test_every_shipped_pipeline_phase_validates(self):
        pipelines = sorted(PIPELINES_DIR.glob("*.yml"))
        self.assertTrue(pipelines, f"no pipelines found in {PIPELINES_DIR}")
        for path in pipelines:
            data = self.yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            phases = data.get("phases") or []
            self.assertTrue(
                phases, f"{path.name} has no phases to validate"
            )
            for phase in phases:
                errors = sorted(
                    self.validator.iter_errors(phase), key=lambda e: e.path
                )
                if errors:
                    detail = "\n".join(
                        f"    - at {list(e.path) or '<root>'}: {e.message}"
                        for e in errors
                    )
                    self.fail(
                        f"phase '{phase.get('id', '?')}' in {path.name} does NOT "
                        f"validate against the relaxed pipeline-phase schema:\n"
                        f"{detail}"
                    )

    def test_unknown_field_still_rejected(self):
        bad = {
            "id": "x",
            "agent": "y",
            "gate": {"required": []},
            "inputz": ["typo"],  # not a known field
        }
        self.assertTrue(
            list(self.validator.iter_errors(bad)),
            "relaxed schema must still reject a typo in an unknown field "
            "(additionalProperties:false)",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
