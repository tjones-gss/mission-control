#!/usr/bin/env bash
# Starter hook: require at least one mission file before code edits.
# Customize path checks for your repo.

if ! ls runs/missions/MISSION-*.md >/dev/null 2>&1; then
  echo "No mission file found. Create a mission before editing application code."
  exit 1
fi

exit 0
