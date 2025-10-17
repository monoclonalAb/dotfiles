-- https://github.com/godlygeek/tabular
-- used to create hotkeys to align text
return {
    "godlygeek/tabular",
    cmd = { "Tabularize" },
    opts = {
        -- Align `=` in visual mode
        vim.keymap.set("x", "<leader>a=", ":Tabularize /=<CR>", { silent = true, desc = "Align = signs" }),

        -- Align `=>` in visual mode (useful for JS/TS/Lua)
        vim.keymap.set("x", "<leader>a>", ":Tabularize /=>/<CR>", { silent = true, desc = "Align => arrows" }),

        -- Align `:` in visual mode (e.g., tables, maps)
        vim.keymap.set("x", "<leader>a:", ":Tabularize /:<CR>", { silent = true, desc = "Align colons" }),

        -- Align comments `--` in visual mode (e.g., Lua)
        vim.keymap.set("x", "<leader>a-", ":Tabularize /--/<CR>", { silent = true, desc = "Align Lua comments" }),

        -- Align comments `//` in visual mode (e.g., JS, C++)
        vim.keymap.set("x", "<leader>a/", ":Tabularize /\\//<CR>", { silent = true, desc = "Align // comments" }),

        -- Align `#` comments (e.g., Python, shell)
        vim.keymap.set("x", "<leader>a#", ":Tabularize /#/<CR>", { silent = true, desc = "Align # comments" }),
    },
}
