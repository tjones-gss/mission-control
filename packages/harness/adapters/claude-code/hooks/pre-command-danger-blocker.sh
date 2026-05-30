#!/usr/bin/env bash
# Starter hook: block obvious dangerous commands.
# Wire this into Claude Code hook settings as appropriate for your environment.

COMMAND="$1"

case "$COMMAND" in
  *"rm -rf"*|*"DROP TABLE"*|*"terraform apply"*|*"kubectl delete"*|*"vercel --prod"*)
    echo "Blocked by harness danger-zone policy: $COMMAND"
    exit 1
    ;;
esac

exit 0
