#!/usr/bin/env python3
"""
tests/test_pipelines.py — Phase 2: the pipeline-phase schema becomes CONSUMED.

The harness loader now validates authored pipeline YAML against the shared
contract (packages/contracts/schemas/pipeline-phase.schema.json) and materializes
the canonical phase object (default strategy=single, carry the pipeline goal into
each phase, default an empty gate set). This locks the spine: a typo in a phase
fails closed at load time, and downstream code always sees the full canonical
shape.

Run:
    python3 -m unittest tests.test_pipelines
"""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from harness_core import pipelines  # noqa: E402
from harness_core.pipelines import (  # noqa: E402
    PipelineValidationError,
    load_pipeline,
    load_pipeline_phase_schema,
    pipeline_phases,
    validate_phase,
)


def _write_pipeline(root: Path, name: str, body: str) -> None:
    (root / "pipelines").mkdir(parents=True, exist_ok=True)
    (root / "pipelines" / f"{name}.yml").write_text(body, encoding="utf-8")


class TestValidatePhase(unittest.TestCase):
    def test_accepts_a_real_authored_phase(self):
        phase = {
            "id": "execute",
            "agent": "implementer",
            "description": "Run a ready mission.",
            "inputs": ["runs/missions/MISSION-1.md"],
            "outputs": ["<files>"],
            "gate": {"required": ["work_completed_within_scope_or_stop_reason_documented"]},
        }
        self.assertEqual(validate_phase(phase), [])

    def test_accepts_canonical_phase_with_tier_strategy_goal(self):
        phase = {
            "id": "fanout",
            "agent": "fleet",
            "tier": "implementation",
            "strategy": "fleet",
            "goal": "Fan out candidates",
            "gate": {"required": []},
        }
        self.assertEqual(validate_phase(phase), [])

    def test_rejects_unknown_field(self):
        phase = {"id": "x", "agent": "y", "inputz": ["typo"]}
        errors = validate_phase(phase)
        self.assertTrue(errors, "unknown field must produce a validation error")

    def test_rejects_bad_strategy_enum(self):
        phase = {"id": "x", "agent": "y", "strategy": "parallel"}
        self.assertTrue(validate_phase(phase))

    def test_rejects_missing_required_id(self):
        phase = {"agent": "y", "gate": {"required": []}}
        self.assertTrue(validate_phase(phase))

    def test_fail_open_when_schema_absent(self):
        """If the contracts schema can't be loaded (standalone install), validation
        is a no-op — fail open on tooling absence, never on a real violation."""
        original = pipelines.load_pipeline_phase_schema
        pipelines.load_pipeline_phase_schema = lambda: None
        try:
            # even a clearly-bad phase passes when the schema is unavailable
            self.assertEqual(validate_phase({"nonsense": True}), [])
        finally:
            pipelines.load_pipeline_phase_schema = original


class TestLoadPipeline(unittest.TestCase):
    def test_real_shipped_pipelines_load_without_raising(self):
        for name in ("next-mission-loop", "idea-to-mvp"):
            pipeline = load_pipeline(ROOT, name)
            self.assertTrue(pipeline.get("phases"), f"{name} has phases")

    def test_raises_on_a_malformed_phase(self):
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            _write_pipeline(
                root,
                "bad",
                "pipeline: bad\nphases:\n  - id: x\n    agent: y\n    inputz: [oops]\n",
            )
            with self.assertRaises(PipelineValidationError):
                load_pipeline(root, "bad")

    def test_does_not_raise_when_schema_absent(self):
        import tempfile

        original = pipelines.load_pipeline_phase_schema
        pipelines.load_pipeline_phase_schema = lambda: None
        try:
            with tempfile.TemporaryDirectory() as d:
                root = Path(d)
                _write_pipeline(
                    root, "bad", "pipeline: bad\nphases:\n  - id: x\n    bogus: 1\n"
                )
                # fail-open: no schema -> no raise
                load_pipeline(root, "bad")
        finally:
            pipelines.load_pipeline_phase_schema = original


class TestPipelinePhasesCanonical(unittest.TestCase):
    def test_fills_strategy_goal_and_gate_defaults(self):
        pipeline = {
            "pipeline": "demo",
            "description": "The demo goal.",
            "phases": [
                {"id": "a", "agent": "orchestrator"},
                {"id": "b", "agent": "implementer", "strategy": "fleet", "goal": "own goal"},
            ],
        }
        phases = pipeline_phases(pipeline)
        self.assertEqual(phases[0]["strategy"], "single")
        self.assertEqual(phases[0]["goal"], "The demo goal.")
        self.assertEqual(phases[0]["gate"]["required"], [])
        # an explicit strategy/goal is preserved, not overwritten
        self.assertEqual(phases[1]["strategy"], "fleet")
        self.assertEqual(phases[1]["goal"], "own goal")

    def test_goal_falls_back_to_pipeline_name_when_no_description(self):
        pipeline = {"pipeline": "demo-name", "phases": [{"id": "a", "agent": "o"}]}
        phases = pipeline_phases(pipeline)
        self.assertEqual(phases[0]["goal"], "demo-name")

    def test_skips_non_dict_phases(self):
        pipeline = {"description": "g", "phases": ["bare-string", {"id": "a", "agent": "o"}]}
        phases = pipeline_phases(pipeline)
        self.assertEqual(len(phases), 1)


class TestSchemaLoader(unittest.TestCase):
    def test_loads_the_contract_schema(self):
        schema = load_pipeline_phase_schema()
        # In the monorepo the contracts package is present; assert it resolves.
        self.assertIsNotNone(schema)
        self.assertEqual(schema.get("title"), "PipelinePhase")


if __name__ == "__main__":
    unittest.main(verbosity=2)
