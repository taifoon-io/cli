#!/usr/bin/env bash
# Install `taifoon` from this checkout, without the npm registry (`npm i -g @taifoon/cli` installs the published release).
#   scripts/install.sh            npm i -g of both packed packages (a real install; survives moving the checkout)
#   scripts/install.sh --link     npm link both (edits in the checkout are live; for development)
#   PREFIX=/tmp/x scripts/install.sh   install under another prefix (tests)
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"; TERM_DIR="$(cd "$HERE/../term" && pwd)"
if [ "${1:-}" = "--link" ]; then
  (cd "$TERM_DIR" && npm link --silent)
  (cd "$HERE" && npm link --silent @taifoon/term && npm link --silent)
  echo "linked: $(command -v taifoon) → $HERE"; exit 0
fi
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
(cd "$TERM_DIR" && npm pack --silent --pack-destination "$TMP" >/dev/null)
(cd "$HERE" && npm pack --silent --pack-destination "$TMP" >/dev/null)
npm i -g ${PREFIX:+--prefix "$PREFIX"} "$TMP"/taifoon-term-*.tgz "$TMP"/taifoon-cli-*.tgz
BIN="${PREFIX:+$PREFIX/bin/}taifoon"
echo "installed taifoon $("$BIN" --version) (${PREFIX:-the global npm prefix})"
