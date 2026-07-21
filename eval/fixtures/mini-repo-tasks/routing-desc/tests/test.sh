#!/usr/bin/env bash
set -euo pipefail
DESC_FILE="${EVOSUBAGENT_DESC_FILE:-}"
if [[ -z "${DESC_FILE}" || ! -f "${DESC_FILE}" ]]; then
  echo "missing EVOSUBAGENT_DESC_FILE" >&2
  exit 1
fi
if grep -qiE '^(Use when|Activate when)' "${DESC_FILE}"; then
  echo "pass: routing description"
  exit 0
fi
echo "fail: description is not routing language" >&2
exit 1
