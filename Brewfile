# Brewfile — everything the dotfiles in this repo expect to find.
#
#   brew bundle --file=~/dotfiles/Brewfile
#
# Run this BEFORE `stow`. See "Setting up a new Mac" in README.md for the full order.
# Every name here was checked against `brew info`, so the bundle won't die halfway
# through on a typo.

tap "nikitabobko/tap" # aerospace

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
brew "herdr"                   # persistent terminal workspaces for coding agents
brew "python@3.14"             # herdr-next-agent plugin runtime
brew "tmux"
brew "ripgrep"                 # telescope live_grep, todo-comments, trouble
brew "fd"                      # telescope file finder
brew "lazygit"                 # toggleterm, <leader>gg
brew "tree-sitter-cli"         # required to generate and compile nvim-treesitter parsers
brew "make"                    # telescope-fzf-native's `build = "make"`
brew "cmake"
brew "luarocks"
brew "git-lfs"                 # ~/.gitconfig declares the lfs filter

cask "alacritty"
cask "wezterm"
cask "aerospace"

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
