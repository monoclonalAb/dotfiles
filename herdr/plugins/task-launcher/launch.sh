#!/bin/sh
# Herdr/GUI processes must not depend on interactive .zshrc initialization.
set -eu
PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
export PATH

# Use the installed nvm default, never a project's .nvmrc; do not install Node.
NVM_DIR=${NVM_DIR:-$HOME/.nvm}
export NVM_DIR
if [ -s "$NVM_DIR/nvm.sh" ]; then
    . "$NVM_DIR/nvm.sh" --no-use
    nvm use --silent default >/dev/null || {
        printf '%s\n' 'Pi Tasks: set an installed nvm default Node version first.' >&2
        exit 1
    }
fi
# nvm prepends its bin; restore the managed Pi wrapper to the front.
PATH="$HOME/.local/bin:$PATH"
export PATH
command -v node >/dev/null 2>&1 || {
    printf '%s\n' 'Pi Tasks: Node and the npm Pi installation are required.' >&2
    exit 1
}
root=${HERDR_PLUGIN_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)}
exec node "$root/main.mjs" "$@"
