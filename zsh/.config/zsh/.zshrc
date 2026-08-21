###########################
# MacOS Permanent Aliases #
###########################

alias desktop="cd ~/Desktop/"
alias downloads="cd ~/Downloads/"

############################
# MacOS Temporary Alisases #
############################

alias pmd="$HOME/pmd-bin-7.16.0/bin/pmd"
alias claude="claude --dangerously-skip-permissions"
alias ls='gls -lAhsF --color --group-directories-first'

alias life="cd ~/Desktop/life/"
alias todo="nvim ~/Desktop/life/todo.md"
alias resumes="cd ~/Desktop/resumes/"

######################
# Prosperity Aliases #
######################

alias prosperity='python /Users/ericzheng/Desktop/prosperity/prosperity4/_submission/prosperity_cli.py'

########
# Path #
########

export PATH="$HOME/.bun/bin:$PATH"

export PATH="/Library/TeX/texbin:$HOME/.cargo/bin:/usr/local/share/dotnet:$PATH"

#########
# Conda #
#########

# >>> conda initialize >>>
# !! Contents within this block are managed by 'conda init' !!
__conda_setup="$('/opt/anaconda3/bin/conda' 'shell.zsh' 'hook' 2> /dev/null)"
if [ $? -eq 0 ]; then
    eval "$__conda_setup"
else
    if [ -f "/opt/anaconda3/etc/profile.d/conda.sh" ]; then
        . "/opt/anaconda3/etc/profile.d/conda.sh"
    else
        export PATH="/opt/anaconda3/bin:$PATH"
    fi
fi
unset __conda_setup
# <<< conda initialize <<<

#################
# PowerLevel10k #
#################

# Enable Powerlevel10k instant prompt. Should stay close to the top of ~/.zshrc.
# Initialization code that may require console input (password prompts, [y/n]
# confirmations, etc.) must go above this block; everything else may go below.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

source /opt/homebrew/share/powerlevel10k/powerlevel10k.zsh-theme

# To customize prompt, run `p10k configure` or edit ~/.p10k.zsh.
[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh

#######
# Zsh #
#######

# zsh syntax highlighting
source /opt/homebrew/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
source /opt/homebrew/share/zsh-autosuggestions/zsh-autosuggestions.zsh
source $(brew --prefix)/opt/zsh-vi-mode/share/zsh-vi-mode/zsh-vi-mode.plugin.zsh

################
# AutoComplete #
################

# to ignore capitals
autoload -Uz compinit && compinit
zstyle ':completion:*' matcher-list 'm:{a-z}={A-Za-z}'

#######
# nvm #
#######

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

########
# yazi #
########

function y() {
	local tmp="$(mktemp -t "yazi-cwd.XXXXXX")" cwd
	yazi "$@" --cwd-file="$tmp"
	IFS= read -r -d '' cwd < "$tmp"
	[ -n "$cwd" ] && [ "$cwd" != "$PWD" ] && builtin cd -- "$cwd"
	rm -f -- "$tmp"
}
export PATH="$HOME/.local/bin:$PATH"

# To customize prompt, run `p10k configure` or edit ~/.config/zsh/.p10k.zsh.
[[ ! -f ~/.config/zsh/.p10k.zsh ]] || source ~/.config/zsh/.p10k.zsh

# Route Python commands through the version selected by pyenv.
export PYENV_ROOT="$HOME/.pyenv"
[[ -d $PYENV_ROOT/bin ]] && export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init - zsh)"

# The next line updates PATH for the Google Cloud SDK.
if [ -f '/Users/eric/Downloads/google-cloud-sdk/path.zsh.inc' ]; then . '/Users/eric/Downloads/google-cloud-sdk/path.zsh.inc'; fi

# The next line enables shell command completion for gcloud.
if [ -f '/Users/eric/Downloads/google-cloud-sdk/completion.zsh.inc' ]; then . '/Users/eric/Downloads/google-cloud-sdk/completion.zsh.inc'; fi
