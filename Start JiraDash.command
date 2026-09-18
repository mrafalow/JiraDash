#!/bin/bash
set -e

cd "$(dirname "$0")"

# Avoid broken root-owned ~/.npm cache (common after old sudo npm usage)
export npm_config_cache="$PWD/.npm"

if [[ -f "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  source "$HOME/.nvm/nvm.sh"
fi
if [[ -d "$HOME/.fnm" ]] && command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env)"
fi
if [[ -d "$HOME/.volta/bin" ]]; then
  export PATH="$HOME/.volta/bin:$PATH"
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed (or not on PATH for double-click Terminal)."
  echo ""
  echo "Install Node.js 18 or newer, then run this launcher again:"
  echo "  • Easiest: https://nodejs.org/ — download the LTS macOS installer (.pkg)"
  echo "  • Or ask IT if your Mac uses a managed Node setup."
  echo ""
  read -r -p "Open nodejs.org in your browser now? [y/N] " OPEN_NODE
  case "$OPEN_NODE" in
    [yY]|[yY][eE][sS]) open "https://nodejs.org/" ;;
  esac
  read -r -p "Press Enter to close…"
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies (first run)…"
  npm install
fi

PORT="${PORT:-3847}"
URL="http://127.0.0.1:${PORT}/"

echo "Starting JiraDash at ${URL}"
echo "Leave this window open while you use the dashboard."
echo ""

( sleep 1 && open "${URL}" ) &

npm start

echo ""
read -r -p "Server stopped. Press Enter to close…"
