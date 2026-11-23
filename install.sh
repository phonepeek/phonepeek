#!/bin/sh
# Install phonepeek from a GitHub release. The SHA-256 checksum is verified before anything is installed.
#   curl -fsSL https://github.com/nkechr1s/phonepeek/releases/latest/download/install.sh | sh
# Pin a version:
#   curl -fsSL https://github.com/nkechr1s/phonepeek/releases/download/v0.2.0/install.sh | PHONEPEEK_VERSION=v0.2.0 sh
set -eu

REPO="nkechr1s/phonepeek"
DIR="${PHONEPEEK_DIR:-$HOME/.local/bin}"
VERSION="${PHONEPEEK_VERSION:-latest}"
if [ "$VERSION" = latest ]; then
  BASE="https://github.com/$REPO/releases/latest/download"
else
  BASE="https://github.com/$REPO/releases/download/$VERSION"
fi
BASE="${PHONEPEEK_BASE_URL:-$BASE}" # tests point this at a local folder

command -v node >/dev/null 2>&1 || { echo "phonepeek needs Node.js 20+ (https://nodejs.org)" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# HTTPS only (file: is for tests); never follow a redirect to plain http.
fetch() { curl -fsSL --proto '=https,file' --proto-redir '=https' "$BASE/$1" -o "$TMP/$1"; }
fetch phonepeek.js
fetch SHA256SUMS

EXPECTED=$(awk '$2 == "phonepeek.js" { print $1 }' "$TMP/SHA256SUMS")
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL=$(sha256sum "$TMP/phonepeek.js" | awk '{ print $1 }')
else
  ACTUAL=$(shasum -a 256 "$TMP/phonepeek.js" | awk '{ print $1 }')
fi
if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "Checksum mismatch: the download is corrupted or was tampered with. Nothing was installed." >&2
  exit 1
fi

mkdir -p "$DIR"
cp "$TMP/phonepeek.js" "$DIR/phonepeek"
chmod 755 "$DIR/phonepeek"
echo "Installed phonepeek $(node "$DIR/phonepeek" --version) to $DIR/phonepeek (SHA-256 verified)"
echo "Verify who built it:  gh attestation verify $DIR/phonepeek --repo $REPO"

case ":$PATH:" in
  *":$DIR:"*) echo "Run it: phonepeek" ;;
  *) echo "Add this to your ~/.zshrc or ~/.bashrc, then open a new terminal:"
     echo "  export PATH=\"$DIR:\$PATH\"" ;;
esac
