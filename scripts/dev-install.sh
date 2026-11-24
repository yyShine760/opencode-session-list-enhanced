#!/usr/bin/env bash
# Copy the plugin parts into the local OpenCode plugin directory for development.
#
# The local directory must contain only index.ts / tui.ts: a package.json with
# name + exports makes OpenCode resolve the TUI part through node_modules, which
# fails for a local directory and the TUI part never loads.
set -euo pipefail

src="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="${OPENCODE_PLUGIN_DIR:-$HOME/.config/opencode/plugins/opencode-session-list}"

mkdir -p "$dest"
cp "$src/index.ts" "$dest/index.ts"
cp "$src/tui.ts" "$dest/tui.ts"

echo "copied plugin parts to $dest"
echo "restart the TUI to load the updated TUI part"
