-- https://github.com/godlygeek/tabular
-- used to create hotkeys to align text
-- NOTE: tabular is a vimscript plugin with no Lua module, so it must NOT use `opts`
-- (that makes lazy.nvim try require("tabular").setup() and error). Keymaps go in `keys`.
return {
    "godlygeek/tabular",
    cmd = { "Tabularize" },
    keys = {
        { "<leader>a=", ":Tabularize /=<CR>",    mode = "x", silent = true, desc = "Align = signs" },
        { "<leader>a>", ":Tabularize /=>/<CR>",  mode = "x", silent = true, desc = "Align => arrows" },
        { "<leader>a:", ":Tabularize /:<CR>",    mode = "x", silent = true, desc = "Align colons" },
        { "<leader>a-", ":Tabularize /--/<CR>",  mode = "x", silent = true, desc = "Align Lua comments" },
        { "<leader>a/", ":Tabularize /\\//<CR>", mode = "x", silent = true, desc = "Align // comments" },
        { "<leader>a#", ":Tabularize /#/<CR>",   mode = "x", silent = true, desc = "Align # comments" },
    },
}
