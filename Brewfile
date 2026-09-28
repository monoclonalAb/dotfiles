# Brewfile — everything the dotfiles in this repo expect to find.
#
#   brew bundle --file=~/dotfiles/Brewfile
#
# Run this BEFORE `stow`. See "Setting up a new Mac" in README.md for the full order.
# Every name here was checked against `brew info`, so the bundle won't die halfway
# through on a typo.

tap "nikitabobko/tap" # aerospace
tap "can1357/tap"     # omp
tap "infisical/get-cli"
tap "anomalyco/tap"   # opencode

###############################################################################
# Required — the configs break without these                                  #
###############################################################################

brew "stow"                    # links this repo into $HOME
brew "coreutils"               # gls; .zshrc's `ls` alias is broken without it

# zsh: .zshrc `source`s these from /opt/homebrew/share with no existence check,
# so a missing one is a startup error, not a silent degradation.
brew "powerlevel10k"
brew "zsh-autosuggestions"
brew "zsh-syntax-highlighting"
brew "zsh-vi-mode"

brew "neovim"                  # 0.11+ — lsp.lua uses vim.lsp.config()
brew "herdr"                   # base install only; ~/.local/bin/herdr (install-herdr-focus) shadows it and owns the running config
brew "zig"                     # install-herdr-focus requires Zig 0.16.0 for Herdr 0.9.1; rustup comes from README step 3, not Homebrew
brew "python@3.14"             # herdr-next-agent plugin runtime
brew "tmux"
brew "ripgrep"                 # telescope live_grep, todo-comments, trouble
brew "fd"                      # telescope file finder
brew "lazygit"                 # toggleterm, <leader>gg
brew "tree-sitter-cli"         # required to generate and compile nvim-treesitter parsers
brew "make"                    # telescope-fzf-native's `build = "make"`
brew "cmake"
brew "luarocks"
brew "git-lfs"                 # `git lfs install` records its filter in ~/.config/git/config

brew "uv"                    # uvx runs Python-packaged MCP servers
brew "bun"                   # OMP plugin installation runtime
brew "typescript-language-server" # omp lsp: TS/JS
brew "basedpyright"          # omp lsp: Python type intelligence
brew "ruff"                  # omp lsp linter + formatter for Python
brew "lua-language-server"   # omp lsp: Lua
brew "jdtls"                 # omp lsp: Java; temurin@21 is required below
brew "yaml-language-server"  # omp lsp: YAML/CI files
brew "biome"                 # omp lsp linter/formatter for TS/JS/JSON
brew "can1357/tap/omp"       # OMP harness; Pi's omp-anthropic-route blocks Claude requests without it

# Pi and OMP's gcloud / gcp-observability MCP servers shell out to `gcloud`.
cask "gcloud-cli"

cask "alacritty"
cask "wezterm"
cask "aerospace"
cask "tailscale-app"          # tailnet access; needs a Privacy & Security approval

# alacritty.toml and archived .archive/wezterm/.config/wezterm/config/fonts.lua both ask for "JetBrainsMono Nerd Font"
# by that exact name. The plain `font-jetbrains-mono` cask is NOT a substitute —
# it has no glyphs, and every icon in lualine/telescope/blink renders as tofu.
cask "font-jetbrains-mono-nerd-font"
cask "font-symbols-only-nerd-font"

###############################################################################
# Daily drivers — not required by any config, safe to trim                    #
###############################################################################

brew "fzf"
brew "zoxide"
brew "yazi"                    # the `y` function in .zshrc wraps this
brew "jq"
brew "gh"
brew "fastfetch"               # what actually replaced the neofetch/ package
brew "typst"                   # typst.vim / typst-preview.nvim
brew "pandoc"
brew "poppler"
brew "imagemagick"
brew "ffmpeg"
brew "sevenzip"
brew "llvm"
brew "node"                    # npx: required by every stdio MCP server and Mason's node-based LSPs
brew "marksman"                # markdown LSP; omp auto-detects the `marksman` binary
brew "texlab"                  # LaTeX LSP; omp auto-detects the `texlab` binary
brew "difftastic"              # `difft`: structural diffs the agent can read instead of line noise
brew "hyperfine"               # benchmark claims instead of asserting them
brew "tokei"                   # cheap repo/language sizing before a broad refactor
brew "ast-grep"                # structural search/rewrite rules
brew "git-delta"               # readable patch and log rendering
brew "tuicr"                   # C-a v in Herdr (herdr-review): comment on an agent's diff, send the comments back
brew "watchexec"               # re-run tests on change during an agent loop
brew "just"                    # stable, discoverable per-project task names
brew "gitleaks"                # secret scan before commit
brew "semgrep"                 # SAST rules and semgrep MCP backing CLI
brew "trivy"                   # container, IaC, and SBOM scanning
brew "osv-scanner"             # dependency advisories across ecosystems
brew "shellcheck"              # shell correctness before running scripts
brew "shfmt"                   # shell formatting
brew "typos-cli"               # typo sweep across prose and code
brew "sd"                      # safer literal find/replace than sed
brew "yq"                      # structured YAML/JSON edits
brew "sqlite-utils"            # query and inspect SQLite from the shell
brew "lefthook"                # deterministic pre-commit gates
brew "terminal-notifier"       # desktop notifications from long agent runs
brew "pyenv"                   # .zshrc runs `pyenv init` when present
brew "git"                     # newer than the Command Line Tools git
brew "pngpaste"                # clipboard image -> file from the shell

# Work tooling installed on the current Mac.
brew "cloud-sql-proxy"
brew "libpq"                   # psql and friends (keg-only)
brew "infisical/get-cli/infisical"
brew "anomalyco/tap/opencode"
cask "ngrok"
cask "orbstack"                # Docker runtime; needed for container-use and Docker MCP servers


cask "skim"                    # vimtex's viewer (vimtex_view_method = "skim")
cask "obsidian"
cask "temurin@21"              # jdtls shells out to `java`

###############################################################################
# Optional — deliberately not installed                                       #
###############################################################################

# The archived .archive/wezterm/.config/wezterm/config/launch.lua has entries pointing at
# /opt/homebrew/bin/fish and /opt/homebrew/bin/nu. Without these the archived entries are
# dead, but nothing else breaks.
# brew "fish"
# brew "nushell"

# Legacy window manager — superseded by AeroSpace. See "Window managers" in
# README.md before re-adopting; yabai's scripting addition needs SIP partially
# disabled. Upstream tap is koekeishiya/formulae (this machine has asmvik/formulae).
# brew "koekeishiya/formulae/yabai"
# brew "koekeishiya/formulae/skhd"

# LaTeX, for vimtex. ~4 GB; `mactex-no-gui` skips the GUI apps since Skim is the
# configured viewer anyway. .zshrc already puts /Library/TeX/texbin on PATH.
# cask "mactex-no-gui"

# brew "jj"          # Jujutsu; cheap checkpoints, but a second VCS workflow on top of git
# brew "mise"        # runtime/env manager; overlaps nvm + conda already on PATH
# brew "direnv"      # per-directory env; adds a shell hook to every prompt
# brew "act"         # local GitHub Actions runner — needs Docker, which is not installed
# brew "pre-commit"  # alternative to lefthook; pick one, not both
# brew "trufflehog"  # deeper verified-secret scanning than gitleaks; network verification
# brew "asciinema"   # record terminal evidence of an agent run; can capture secrets
# brew "ollama"      # local model fallback; modelRoles point at hosted frontier models
# brew "oxlint"      # faster JS lint than biome, with fewer rules
# brew "entr"        # simpler watchexec alternative
# brew "scc"         # tokei alternative with COCOMO estimates
# brew "gum"         # interactive shell prompts; never use in unattended hooks
# brew "hurl"        # plain-text HTTP request tests
