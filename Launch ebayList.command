#!/bin/zsh

set -u

cd "$(dirname "$0")" || exit 1

pause() {
  echo
  echo "Press Enter to close this window."
  read -r _
}

fail() {
  echo
  echo "ebayList could not start:"
  echo "$1"
  pause
  exit 1
}

run() {
  "$@"
  local status=$?

  if [ "$status" -ne 0 ]; then
    fail "Command failed: $*"
  fi
}

echo "Starting ebayList..."

if ! command -v node >/dev/null 2>&1; then
  fail "Node.js is not installed. Install Node.js, then open this launcher again."
fi

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    echo "Enabling pnpm..."
    corepack enable >/dev/null 2>&1
  fi

  if ! command -v pnpm >/dev/null 2>&1; then
    fail "pnpm is not installed. Run 'corepack enable' or install pnpm, then open this launcher again."
  fi
fi

if [ ! -d "node_modules" ]; then
  echo "Installing ebayList dependencies..."
  run env CI=true pnpm install
fi

if [ ! -d ".auth/profile" ]; then
  echo "Opening Shopify login..."
  run pnpm auth
else
  echo "Checking saved Shopify session..."
  run pnpm start
fi

echo
echo "Done."
pause
