#!/usr/bin/env bash
set -euo pipefail
BODY_FILE="${EVOSUBAGENT_BODY_FILE:-}"
if [[ -z "${BODY_FILE}" || ! -f "${BODY_FILE}" ]]; then
  echo "missing EVOSUBAGENT_BODY_FILE" >&2
  exit 1
fi
if grep -q 'NEW:' "${BODY_FILE}"; then
  echo "pass: body has NEW:"
  exit 0
fi
echo "fail: body missing NEW:" >&2
exit 1
