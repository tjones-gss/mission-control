"""contract_parity.py — single-sourced schema-version parity (L1-D).

The contracts package (JS) and the harness (Python) BOTH derive their schema
version numbers from ONE canonical file:

    packages/contracts/schema-version.json

so the two languages cannot silently drift. This module is the importable Python
home of that derivation plus the parity check. It reads the sidecar directly — it
hand-copies no version number — and `assert_parity()` turns a one-sided change
(e.g. someone bumps the JS export or the sidecar but not the other) into a hard
AssertionError instead of a shipped mismatch. The cross-language gate that drives
it lives in tests/test_contract.py; this module makes the resolution + assertion
reusable and unit-testable on its own.
"""

import json
from pathlib import Path

# harness_core/contract_parity.py -> parents[2] == packages/; sibling contracts pkg.
SIDECAR_PATH = Path(__file__).resolve().parents[2] / "contracts" / "schema-version.json"

# Fallbacks used ONLY when the sidecar is absent (a standalone harness install
# detached from the monorepo). They match the committed sidecar; the parity test
# asserts they agree when the sidecar IS present, so they can never silently drift.
_SCHEMA_VERSION_FALLBACK = 10
_APPROVAL_SCHEMA_VERSION_FALLBACK = 2


def read_sidecar_versions(path: Path = SIDECAR_PATH) -> dict:
    """Resolve {schemaVersion, approvalSchemaVersion} from the canonical sidecar.

    Falls back to the documented defaults only when the sidecar is unreadable, so a
    standalone harness install still works while the monorepo stays parity-checked.
    """
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    return {
        "schemaVersion": data.get("schemaVersion", _SCHEMA_VERSION_FALLBACK),
        "approvalSchemaVersion": data.get(
            "approvalSchemaVersion", _APPROVAL_SCHEMA_VERSION_FALLBACK
        ),
    }


def assert_parity(other: dict) -> bool:
    """Raise AssertionError if `other` does not match the canonical sidecar.

    `other` is a {schemaVersion, approvalSchemaVersion} mapping — e.g. the values
    exported by the JS contracts package — that must equal the single source. This
    fails closed (raises), never skips, so drift turns CI red.
    """
    sidecar = read_sidecar_versions()
    for key in ("schemaVersion", "approvalSchemaVersion"):
        if other.get(key) != sidecar[key]:
            raise AssertionError(
                f"{key} drift: {other.get(key)!r} != canonical {sidecar[key]!r} "
                f"(single source: {SIDECAR_PATH})"
            )
    return True


_VERSIONS = read_sidecar_versions()
SCHEMA_VERSION = _VERSIONS["schemaVersion"]
APPROVAL_SCHEMA_VERSION = _VERSIONS["approvalSchemaVersion"]
