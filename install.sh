#!/bin/sh
# Installs phonepeek: curl -fsSL https://raw.githubusercontent.com/nkechr1s/live-preview/main/install.sh | sh
set -e
REPO="${PHONEPEEK_REPO:-nkechr1s/live-preview}"
DIR="${PHONEPEEK_DIR:-$HOME/.local/bin}"

command -v node >/dev/null 2>&1 || { echo "phonepeek needs Node.js 20+ (https://nodejs.org)"; exit 1; }
mkdir -p "$DIR"
curl -fsSL "https://raw.githubusercontent.com/$REPO/main/phonepeek.js" -o "$DIR/phonepeek"
chmod +x "$DIR/phonepeek"
echo "Installed: $DIR/phonepeek"

case ":$PATH:" in
  *":$DIR:"*) echo "Run it: phonepeek" ;;
  *) echo "Add this to your ~/.zshrc or ~/.bashrc, then open a new terminal:"
     echo "  export PATH=\"$DIR:\$PATH\"" ;;
esac
