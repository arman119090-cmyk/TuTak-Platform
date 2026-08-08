#!/usr/bin/env bash
#
# Stops the demo stack.
#
#   ./scripts/demo-down.sh          stop the containers, keep the data
#   ./scripts/demo-down.sh --wipe   also delete the database volume
#
# After --wipe the next ./scripts/demo-up.sh starts from an empty database
# and re-seeds everything, which is the way to get back to a known state
# once you have clicked things into a mess.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${1:-}" == "--wipe" ]]; then
  printf '\033[0;33m▸ Removing containers and the database volume\033[0m\n'
  docker compose down -v
  printf '\033[0;32m✓ Gone. ./scripts/demo-up.sh will rebuild from scratch.\033[0m\n'
else
  printf '\033[0;36m▸ Stopping containers (data is kept)\033[0m\n'
  docker compose down
  printf '\033[0;32m✓ Stopped. ./scripts/demo-up.sh brings it back with your data.\033[0m\n'
fi
