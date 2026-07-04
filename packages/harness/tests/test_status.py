"""Unit tests for harness_core.status.status_payload — the v10 canvas fields.

These build minimal tmp-dir .harness fixtures (mirroring test_mcp_server.py) to
exercise the enriched emitter in isolation from the repo's own .harness: the
graceful-absence paths (missing pipeline, unconfigured budget, absent guardrail
files) and the passthrough/derivation paths (transitions verbatim, phases +
gate classification, guardrail summaries, budget from the cost ledger).
"""

import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from harness_core.status import status_payload  # noqa: E402


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def make_root() -> Path:
    return Path(tempfile.mkdtemp(prefix="harness-status-"))


class TestPhasesAndGates(unittest.TestCase):
    def _root_with_pipeline(self) -> Path:
        root = make_root()
        _write(
            root / ".harness/pipeline-state.yml",
            "pipeline:\n  active: demo\n  phase: build\n",
        )
        _write(
            root / "pipelines/demo.yml",
            "pipeline: demo\n"
            "description: a demo pipeline\n"
            "phases:\n"
            "  - id: build\n"
            "    agent: implementer\n"
            "    description: do the work\n"
            "    gate:\n"
            "      required:\n"
            "        - scope_adherence\n"
            "  - id: approve\n"
            "    agent: orchestrator\n"
            "    gate:\n"
            "      required:\n"
            "        - human_approval_for_plan\n"
            "        - not_a_real_gate\n",
        )
        return root

    def test_phases_emitted_in_order_with_canonical_defaults(self):
        payload = status_payload(self._root_with_pipeline())
        phases = payload["phases"]
        self.assertEqual([p["id"] for p in phases], ["build", "approve"])
        # strategy default materialized by pipeline_phases.
        self.assertEqual(phases[0]["strategy"], "single")
        # goal carried from the pipeline description when a phase omits its own.
        self.assertEqual(phases[0]["goal"], "a demo pipeline")
        self.assertEqual(phases[0]["gate"]["required"], ["scope_adherence"])

    def test_gates_classified_auto_vs_manual_vs_unknown(self):
        gates = status_payload(self._root_with_pipeline())["gates"]
        # a registry evaluator that is not a human gate -> auto
        self.assertTrue(gates["scope_adherence"]["auto"])
        # a registry evaluator that IS a human-approval gate -> not auto
        self.assertFalse(gates["human_approval_for_plan"]["auto"])
        # a name the registry does not know -> not auto
        self.assertFalse(gates["not_a_real_gate"]["auto"])

    def test_missing_active_pipeline_omits_phases_and_gates(self):
        root = make_root()
        # active names a pipeline whose definition file does not exist.
        _write(
            root / ".harness/pipeline-state.yml",
            "pipeline:\n  active: does-not-exist\n",
        )
        payload = status_payload(root)
        self.assertNotIn("phases", payload)
        self.assertNotIn("gates", payload)

    def test_no_active_pipeline_omits_phases_and_gates(self):
        root = make_root()
        _write(root / ".harness/pipeline-state.yml", "pipeline:\n  phase: build\n")
        payload = status_payload(root)
        self.assertNotIn("phases", payload)
        self.assertNotIn("gates", payload)


class TestTransitions(unittest.TestCase):
    def test_transitions_passed_through_verbatim(self):
        root = make_root()
        _write(
            root / ".harness/pipeline-state.yml",
            "pipeline:\n  active: none\n"
            "allowed_transitions:\n"
            "  build:\n"
            "    - review\n"
            "blocked_transitions:\n"
            "  deploy_without_gate: true\n",
        )
        transitions = status_payload(root)["transitions"]
        self.assertEqual(transitions["allowed"], {"build": ["review"]})
        self.assertEqual(transitions["blocked"], {"deploy_without_gate": True})

    def test_transitions_omitted_when_absent(self):
        root = make_root()
        _write(root / ".harness/pipeline-state.yml", "pipeline:\n  active: none\n")
        self.assertNotIn("transitions", status_payload(root))

    def test_only_present_transition_key_emitted(self):
        root = make_root()
        _write(
            root / ".harness/pipeline-state.yml",
            "pipeline:\n  active: none\nallowed_transitions:\n  a:\n    - b\n",
        )
        transitions = status_payload(root)["transitions"]
        self.assertIn("allowed", transitions)
        self.assertNotIn("blocked", transitions)


class TestGuardrails(unittest.TestCase):
    def test_all_absent_reports_present_false(self):
        root = make_root()
        _write(root / ".harness/pipeline-state.yml", "pipeline:\n  active: none\n")
        guardrails = status_payload(root)["guardrails"]
        self.assertEqual(
            guardrails,
            {
                "danger_zone": {"present": False},
                "quality_gates": {"present": False},
                "human_approval": {"present": False},
            },
        )

    def test_present_configs_are_summarized(self):
        root = make_root()
        _write(root / ".harness/pipeline-state.yml", "pipeline:\n  active: none\n")
        _write(
            root / ".harness/danger-zone.yml",
            "dangerous_operations:\n"
            "  require_human_approval:\n"
            "    - production_deploy\n"
            "    - bulk_delete\n"
            "blocked_command_patterns:\n"
            "  - 'rm -rf'\n"
            "policy:\n"
            "  production_access: forbidden_unless_explicit\n",
        )
        _write(
            root / ".harness/quality-gates.yml",
            "quality_gates:\n"
            "  before_pr:\n"
            "    required:\n"
            "      - tests_pass\n"
            "failure_policy:\n"
            "  tests_fail: create_fix_mission\n",
        )
        _write(
            root / ".harness/human-approval-policy.yml",
            "approval_required:\n"
            "  production:\n"
            "    - deploy\n"
            "  security:\n"
            "    - auth_change\n",
        )
        guardrails = status_payload(root)["guardrails"]

        self.assertEqual(
            guardrails["danger_zone"],
            {
                "present": True,
                "policy": {"production_access": "forbidden_unless_explicit"},
                "approval_required_count": 2,
                "blocked_pattern_count": 1,
            },
        )
        self.assertEqual(
            guardrails["quality_gates"],
            {
                "present": True,
                "stages": {"before_pr": ["tests_pass"]},
                "failure_policy": {"tests_fail": "create_fix_mission"},
            },
        )
        self.assertEqual(
            guardrails["human_approval"],
            {"present": True, "categories": ["production", "security"]},
        )


class TestBudget(unittest.TestCase):
    def test_omitted_when_unconfigured(self):
        root = make_root()
        _write(root / ".harness/pipeline-state.yml", "pipeline:\n  active: none\n")
        self.assertNotIn("budget", status_payload(root))

    def test_ceiling_only_from_cost_policy(self):
        root = make_root()
        _write(root / ".harness/pipeline-state.yml", "pipeline:\n  active: none\n")
        _write(root / ".harness/cost-policy.yml", "run_ceiling_usd: 12.5\n")
        budget = status_payload(root)["budget"]
        self.assertEqual(budget["ceiling_usd"], 12.5)
        # No ledger yet: spend unknown, not exceeded.
        self.assertIsNone(budget["spent_usd"])
        self.assertFalse(budget["exceeded"])
        self.assertEqual(budget["currency"], "USD")

    def test_ledger_spend_and_exceeded(self):
        root = make_root()
        _write(root / ".harness/pipeline-state.yml", "pipeline:\n  active: none\n")
        _write(root / ".harness/cost-policy.yml", "run_ceiling_usd: 10\n")
        _write(
            root / ".harness/run-ledger.yml",
            "run_id: r1\nceiling_usd: 10\nspent_usd: 12.0\nper_phase: []\n",
        )
        budget = status_payload(root)["budget"]
        self.assertEqual(budget["ceiling_usd"], 10.0)
        self.assertEqual(budget["spent_usd"], 12.0)
        self.assertTrue(budget["exceeded"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
