#!/usr/bin/env bash
set -euo pipefail
VER_FILE="${EVOSUBAGENT_VERSION_FILE:-}"
if [[ -z "${VER_FILE}" || ! -f "${VER_FILE}" ]]; then
  echo "missing EVOSUBAGENT_VERSION_FILE" >&2
  exit 1
fi
ver="$(tr -d '[:space:]' < "${VER_FILE}")"
if [[ -n "${ver}" ]]; then
  echo "pass: version=${ver}"
  exit 0
fi
echo "fail: empty version" >&2
exit 1
