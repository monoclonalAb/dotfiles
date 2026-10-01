#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: delete_latest_save.sh [--dry-run] [--force] [--dir PATH]

Deletes the tmux-resurrect save pointed to by "last", then repoints "last" to
the newest remaining tmux_resurrect_*.txt file.

By default this only deletes tiny saves (<= 1024 bytes), which catches accidental
empty saves while avoiding deletion of a normal restore snapshot. Use --force to
delete the current "last" save regardless of size.
USAGE
}

dry_run=0
force=0
resurrect_dir=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run|-n)
      dry_run=1
      ;;
    --force|-f)
      force=1
      ;;
    --dir)
      if [ "$#" -lt 2 ]; then
        echo "error: --dir requires a path" >&2
        exit 2
      fi
      resurrect_dir="$2"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

expand_path() {
  local path="$1"
  path="${path/#\~/$HOME}"
  path="${path//\$HOME/$HOME}"
  path="${path//\$HOSTNAME/$(hostname)}"
  printf '%s\n' "$path"
}

detect_resurrect_dir() {
  local tmux_dir=""

  if command -v tmux >/dev/null 2>&1; then
    tmux_dir="$(tmux show-option -gqv @resurrect-dir 2>/dev/null || true)"
  fi

  if [ -n "$tmux_dir" ]; then
    expand_path "$tmux_dir"
  elif [ -d "$HOME/.tmux/resurrect" ]; then
    printf '%s\n' "$HOME/.tmux/resurrect"
  else
    printf '%s\n' "${XDG_DATA_HOME:-$HOME/.local/share}/tmux/resurrect"
  fi
}

file_size() {
  if stat -f '%z' "$1" >/dev/null 2>&1; then
    stat -f '%z' "$1"
  else
    stat -c '%s' "$1"
  fi
}

if [ -z "$resurrect_dir" ]; then
  resurrect_dir="$(detect_resurrect_dir)"
else
  resurrect_dir="$(expand_path "$resurrect_dir")"
fi

last_link="$resurrect_dir/last"

if [ ! -d "$resurrect_dir" ]; then
  echo "error: tmux-resurrect directory does not exist: $resurrect_dir" >&2
  exit 1
fi

if [ ! -L "$last_link" ]; then
  echo "error: expected last to be a symlink: $last_link" >&2
  exit 1
fi

last_target="$(readlink "$last_link")"
case "$last_target" in
  /*) bad_save="$last_target" ;;
  *) bad_save="$resurrect_dir/$last_target" ;;
esac

new_last="$(
  find "$resurrect_dir" -maxdepth 1 -type f -name 'tmux_resurrect_*.txt' ! -path "$bad_save" -print |
    sort |
    tail -n 1
)"

if [ -z "$new_last" ]; then
  echo "error: no previous tmux-resurrect save found to point last at" >&2
  exit 1
fi

echo "resurrect dir: $resurrect_dir"

if [ -f "$bad_save" ]; then
  bad_size="$(file_size "$bad_save")"
  if [ "$force" -ne 1 ] && [ "$bad_size" -gt 1024 ]; then
    echo "refusing to delete non-tiny save without --force: $bad_save (${bad_size} bytes)" >&2
    exit 1
  fi
  echo "delete:        $bad_save (${bad_size} bytes)"
else
  echo "stale last:    $bad_save is already missing"
fi

echo "new last:      $(basename "$new_last")"

if [ "$dry_run" -eq 1 ]; then
  echo "dry run: no changes made"
  exit 0
fi

if [ -f "$bad_save" ]; then
  rm -- "$bad_save"
fi
ln -sfn "$(basename "$new_last")" "$last_link"

echo "done"
