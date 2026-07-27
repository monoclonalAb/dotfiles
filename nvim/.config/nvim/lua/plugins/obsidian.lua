-- Maintained community fork of obsidian.nvim (epwalsh/obsidian.nvim is superseded).
return {
    "obsidian-nvim/obsidian.nvim",
    version = "*", -- recommended, use latest release instead of latest commit
    lazy = true,   -- set false if I want to load this in
    ft = "markdown",
    -- Replace the above line with this if you only want to load obsidian.nvim for markdown files in your vault:
    -- event = {
    --   "BufReadPre " .. vim.fn.expand "~" .. "/Documents/obsidian/*.md",
    --   "BufNewFile " .. vim.fn.expand "~" .. "/Documents/obsidian/*.md",
    -- },
    dependencies = {
        -- Required. (nvim-cmp dropped: blink.cmp is the completion engine; the fork auto-detects it.)
        "nvim-lua/plenary.nvim",
        "nvim-telescope/telescope.nvim",
        "nvim-treesitter/nvim-treesitter",
    },
    opts = {
        legacy_commands = false, -- use `:Obsidian <subcommand>` (silences fork deprecation warning)
        workspaces = {
            {
                name = "the holy grail",
                path = "/Users/ericzheng/Documents/obsidian",
            },
        },
        -- UI disabled entirely (render-markdown.nvim handles rendering).
        -- Keep this minimal: an empty `ui.checkboxes` still trips the fork's
        -- deprecation warning, so don't list the sub-keys.
        ui = {
            enable = false,
        },
    },
}
