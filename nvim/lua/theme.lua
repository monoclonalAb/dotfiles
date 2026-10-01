-- Follows the shared theme state written by the `theme` script
-- (dotfiles/bin/theme), so Neovim's flavour and transparency stay in
-- sync with Alacritty and tmux.
--
-- Two paths reach a running editor:
--   * push  — `theme` calls M.reload() over RPC on every open instance (instant)
--   * pull  — the FocusGained autocmd below, as a fallback for any instance the
--             push missed. tmux sets `focus-events on` (via tmux-sensible), so
--             this fires for Neovim inside a tmux pane too.
--
-- The state path is hardcoded rather than derived from $XDG_STATE_HOME because
-- Alacritty's TOML `import` cannot expand environment variables — all four
-- consumers have to agree on one literal path. It is NOT vim.fn.stdpath("state"),
-- which is the nvim-private ~/.local/state/nvim.

local M = {}

local STATE_DIR = vim.env.HOME .. "/.local/state/theme"

local FLAVOURS = { latte = true, frappe = true, macchiato = true, mocha = true }

local DEFAULT_FLAVOUR = "latte"
local DEFAULT_OPACITY = 0.6

-- What we last handed to catppuccin, so repeated reloads are free. Re-running
-- setup() + colorscheme is not idempotent-looking to the user: it clears and
-- redraws every highlight group, which flashes.
local applied_flavour, applied_opacity

local function read_line(name)
    -- readfile throws E484 when the file is missing (fresh machine, before the
    -- first `theme set`), which is a normal state, not an error.
    local ok, lines = pcall(vim.fn.readfile, STATE_DIR .. "/" .. name, "", 1)
    if not ok or type(lines) ~= "table" or not lines[1] then
        return nil
    end
    return vim.trim(lines[1])
end

-- Returns flavour, opacity — falling back to the defaults when the state dir is
-- missing or holds something unrecognised.
function M.read_state()
    local flavour = read_line("flavour")
    if not flavour or not FLAVOURS[flavour] then
        flavour = DEFAULT_FLAVOUR
    end
    local opacity = tonumber(read_line("opacity") or "") or DEFAULT_OPACITY
    return flavour, opacity
end

function M.apply(flavour, opacity)
    if flavour == applied_flavour and opacity == applied_opacity then
        return flavour
    end

    -- Other plugins and some LSP servers key off vim.o.background, so keep it
    -- in sync. Must come before the colorscheme call.
    vim.o.background = flavour == "latte" and "light" or "dark"

    -- Below 1.0 the terminal shows through, so let it. At 1.0 nvim paints its
    -- own background. Changing this option re-hashes catppuccin's config and
    -- triggers a recompile of its cache — a one-off sub-second hitch.
    require("catppuccin").setup({
        transparent_background = opacity < 1.0,
    })
    vim.cmd.colorscheme("catppuccin-" .. flavour)

    applied_flavour, applied_opacity = flavour, opacity
    return flavour
end

-- Entry point the `theme` script calls over RPC.
function M.reload()
    return M.apply(M.read_state())
end

function M.setup()
    M.reload()
    vim.api.nvim_create_autocmd("FocusGained", {
        group = vim.api.nvim_create_augroup("ThemeFollowState", { clear = true }),
        desc = "Re-read the shared theme state on focus",
        callback = function()
            M.reload()
        end,
    })
end

return M
