#!/usr/bin/env python3
"""
tests/test_contract_parity.py — L1-D: SCHEMA_VERSION single-sourced, CI reds on drift.

Exercises the importable parity module harness_core/contract_parity.py, which is
the Python home of the schema-version derivation + parity check. The contracts
package (JS) and the harness (Python) BOTH derive from one canonical file
(packages/contracts/schema-version.json); this asserts the Python module reads
that single source and FAILS (does not skip) when a value drifts.

Run:
    python -m pytest packages/harness/tests/test_contract_parity.py
    python3 -m unittest tests.test_contract_parity
"""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from harness_core import contract_parity  # noqa: E402

SIDECAR_PATH = ROOT.parent / "contracts" / "schema-version.json"


class TestContractParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sidecar = json.loads(SIDECAR_PATH.read_text(encoding="utf-8"))

    def test_module_points_at_the_canonical_sidecar(self):
        self.assertEqual(contract_parity.SIDECAR_PATH, SIDECAR_PATH)

    def test_reads_versions_from_the_single_source(self):
        resolved = contract_parity.read_sidecar_versions()
        self.assertEqual(resolved["schemaVersion"], self.sidecar["schemaVersion"])
        self.assertEqual(
            resolved["approvalSchemaVersion"], self.sidecar["approvalSchemaVersion"]
        )

    def test_module_constants_match_the_sidecar(self):
        self.assertEqual(contract_parity.SCHEMA_VERSION, self.sidecar["schemaVersion"])
        self.assertEqual(
            contract_parity.APPROVAL_SCHEMA_VERSION,
            self.sidecar["approvalSchemaVersion"],
        )

    def test_assert_parity_passes_for_matching_values(self):
        self.assertTrue(
            contract_parity.assert_parity(
                {
                    "schemaVersion": self.sidecar["schemaVersion"],
                    "approvalSchemaVersion": self.sidecar["approvalSchemaVersion"],
                }
            )
        )

    def test_assert_parity_RAISES_on_drift_not_skips(self):
        # The whole point: a one-sided change must turn this RED.
        drifted = {
            "schemaVersion": self.sidecar["schemaVersion"] + 1,
            "approvalSchemaVersion": self.sidecar["approvalSchemaVersion"],
        }
        with self.assertRaises(AssertionError):
            contract_parity.assert_parity(drifted)

    def test_fallbacks_agree_with_sidecar_when_present(self):
        # The standalone-install fallbacks must not silently drift from the sidecar.
        self.assertEqual(
            contract_parity._SCHEMA_VERSION_FALLBACK, self.sidecar["schemaVersion"]
        )
        self.assertEqual(
            contract_parity._APPROVAL_SCHEMA_VERSION_FALLBACK,
            self.sidecar["approvalSchemaVersion"],
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
