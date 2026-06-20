#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

psql \
  --set ON_ERROR_STOP=1 \
  --file "${repo_root}/schema/schema.sql"

