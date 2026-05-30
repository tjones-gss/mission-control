# Harness CLI Spec

## harness status

Reads:
- .harness/project-state.yml
- .harness/pipeline-state.yml
- .harness/mission-index.yml
- .harness/readiness-score.yml

Prints:
- mode
- stage
- active mission
- blockers
- recommended next action

## harness next

Runs the next-mission selection algorithm.

Does not implement by itself.

## harness validate

Runs configured validation commands and writes a report.

## harness handoff

Creates a session note from the latest mission/review/test artifacts.
