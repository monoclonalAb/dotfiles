#!/usr/bin/env bash
# Toggle the current window between two custom "big pane + grid" layouts (bound to prefix+Space):
#   A = one big pane on the LEFT (50% width, full height) + a grid filling the right half
#   B = one big pane on TOP  (full width, 50% height) + a grid filling the bottom half
# Grid density follows the pane count (ONLY 5 or 7 panes are supported; any other
# count leaves the window untouched — no panes are spawned or killed):
#   5 panes -> 2x2 grid (4 small panes)
#   7 panes -> 3x2 grid (6 small panes): 3 rows x 2 cols in both orientations
# Strings are generated at the CURRENT window size (with a valid checksum) so they fit any terminal.
set -euo pipefail

W=$(tmux display-message -p '#{window_width}')
H=$(tmux display-message -p '#{window_height}')

# pane ids in index order (ids have no spaces, so word-splitting is safe; bash 3.2 friendly)
PANES=($(tmux list-panes -F '#{pane_id}'))
n=${#PANES[@]}

# Only exactly 5 (2x2) or 7 (3x2) panes are supported. Any other count leaves the
# window untouched — never spawns and never kills panes.
if [ "$n" -ne 5 ] && [ "$n" -ne 7 ]; then
  tmux display-message "Grid layout needs exactly 5 or 7 panes — you have $n. Layout left unchanged."
  exit 0
fi
target=$n

ids=(); for p in "${PANES[@]}"; do ids+=("${p#%}"); done

# per-window orientation toggle: A -> B -> A ...
idx=$(tmux show-option -wqv @grid_idx); idx=${idx:-0}
if [ "$idx" -eq 0 ]; then mode=A; tmux set-option -w @grid_idx 1; else mode=B; tmux set-option -w @grid_idx 0; fi

# grid rows x cols for the small panes
if [ "$target" -eq 5 ]; then
  rows=2; cols=2
else
  rows=3; cols=2
fi

layout=$(python3 - "$W" "$H" "$mode" "$rows" "$cols" "${ids[@]}" <<'PY'
import sys
W=int(sys.argv[1]); H=int(sys.argv[2]); mode=sys.argv[3]
R=int(sys.argv[4]); C=int(sys.argv[5])
ids=sys.argv[6:]
big=ids[0]; cells=ids[1:]

def csum(s):
    c=0
    for ch in s.encode():
        c=((c>>1)+((c&1)<<15))&0xffff
        c=(c+ch)&0xffff
    return c

def split(length,k,start):
    # k cells along an axis of `length`, with a 1-cell border between cells
    avail=length-(k-1); base=avail//k; rem=avail%k
    out=[]; off=start
    for i in range(k):
        size=base+(1 if i<rem else 0)
        out.append((size,off)); off+=size+1
    return out

def grid(ox,oy,gw,gh):
    rstrs=[]; idx=0
    for (rh,ry) in split(gh,R,oy):
        cstrs=[]
        for (cw,cx) in split(gw,C,ox):
            cstrs.append(f"{cw}x{rh},{cx},{ry},{cells[idx]}"); idx+=1
        rstrs.append(f"{gw}x{rh},{ox},{ry}{{"+",".join(cstrs)+"}")
    return f"{gw}x{gh},{ox},{oy}["+",".join(rstrs)+"]"

if mode=='A':
    LW=(W-1)//2; LX=LW+1; RW=W-LX
    body=f"{W}x{H},0,0{{{LW}x{H},0,0,{big},"+grid(LX,0,RW,H)+"}"
else:
    TH=(H-1)//2; BY=TH+1; BH=H-BY
    body=f"{W}x{H},0,0[{W}x{TH},0,0,{big},"+grid(0,BY,W,BH)+"]"

print(f"{csum(body):04x},{body}")
PY
)
tmux select-layout "$layout"
