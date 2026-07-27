-- nvim-treesitter on the `main` branch.
--
-- Required for Neovim 0.12+: the old `master` branch is frozen and does NOT
-- support 0.12 (its custom query directives assume single-node captures, but
-- 0.12 made captures quantified — `match[id]` is now a node *list* — which
-- crashed markdown injection parsing: "attempt to call method 'range' (a nil
-- value)"). See https://github.com/nvim-treesitter/nvim-treesitter (main).
--
-- `main` is a full rewrite: it ONLY installs parsers and ships queries.
-- Everything that used to be a "module" is now enabled by hand via Neovim's
-- native treesitter runtime:
--   * highlight            -> vim.treesitter.start() in a FileType autocmd
--   * injections           -> automatic, no setup (fixes render-markdown)
--   * incremental_selection-> REMOVED upstream, no core replacement (see below)
--   * textobjects          -> separate spec, manual keymaps (below)
local ensure_installed = {
    "c",
    "lua",
    "vim",
    "vimdoc",
    "query",
    "cpp",
    "python",
    "java",
    "typescript",
    "markdown",        -- required by render-markdown.nvim / obsidian.nvim
    "markdown_inline", -- required by render-markdown.nvim / obsidian.nvim
}

return {
    {
        "nvim-treesitter/nvim-treesitter",
        branch = "main",
        lazy = false, -- the `main` branch does not support lazy-loading
        build = ":TSUpdate",
        -- context is independent of the master module API and works on 0.12;
        -- kept as a dependency so it self-activates with defaults as before.
        dependencies = { "nvim-treesitter/nvim-treesitter-context" },
        config = function()
            local TS = require("nvim-treesitter")

            -- Install the baseline parser set (async; no-op if already present).
            TS.install(ensure_installed)

            local function installed(lang)
                return vim.tbl_contains(TS.get_installed(), lang)
            end

            -- Enable highlighting for any buffer whose parser is installed, and
            -- auto-install missing-but-available parsers on demand (this is the
            -- replacement for the old `auto_install = true`).
            vim.api.nvim_create_autocmd("FileType", {
                group = vim.api.nvim_create_augroup("ts_highlight", { clear = true }),
                callback = function(ev)
                    local ft = vim.bo[ev.buf].filetype
                    if ft == "" then
                        return
                    end
                    local lang = vim.treesitter.language.get_lang(ft)
                    if not lang then
                        return
                    end
                    if installed(lang) then
                        pcall(vim.treesitter.start, ev.buf, lang)
                    elseif vim.tbl_contains(TS.get_available(), lang) then
                        pcall(function()
                            TS.install({ lang }):await(function(err)
                                if err or not vim.api.nvim_buf_is_valid(ev.buf) then
                                    return
                                end
                                vim.schedule(function()
                                    pcall(vim.treesitter.start, ev.buf, lang)
                                end)
                            end)
                        end)
                    end
                end,
            })

            -- NOTE: `incremental_selection` (<Leader>ss/si/sc/sd) was removed by
            -- the `main` rewrite and has no core replacement. If you miss it,
            -- ask and I'll wire up a small standalone implementation.
        end,
    },

    {
        "nvim-treesitter/nvim-treesitter-textobjects",
        branch = "main",
        dependencies = { "nvim-treesitter/nvim-treesitter" },
        config = function()
            require("nvim-treesitter-textobjects").setup({
                select = {
                    lookahead = true,
                    selection_modes = {
                        ["@parameter.outer"] = "v",  -- charwise
                        ["@function.outer"] = "v",   -- charwise
                        ["@class.outer"] = "<c-v>",  -- blockwise
                    },
                    include_surrounding_whitespace = true,
                },
            })

            -- `main` dropped the declarative keymaps table; set them by hand.
            local select = require("nvim-treesitter-textobjects.select")
            local function map(key, obj, group, desc)
                vim.keymap.set({ "x", "o" }, key, function()
                    select.select_textobject(obj, group or "textobjects")
                end, { desc = desc })
            end
            map("af", "@function.outer", nil, "Select a function")
            map("if", "@function.inner", nil, "Select inner function")
            map("ac", "@class.outer", nil, "Select a class")
            map("ic", "@class.inner", nil, "Select inner class")
            map("as", "@local.scope", "locals", "Select language scope")
        end,
    },
}
