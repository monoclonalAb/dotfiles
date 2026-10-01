-- https://github.com/catgoose/nvim-colorizer.lua
-- Maintained fork of norcalli/nvim-colorizer.lua.
-- Lazy-loaded and restricted to color-relevant filetypes instead of attaching to every buffer.
return {
    "catgoose/nvim-colorizer.lua",
    event = "BufReadPre",
    opts = {
        filetypes = {
            "css",
            "scss",
            "html",
            "javascript",
            "javascriptreact",
            "typescript",
            "typescriptreact",
            "lua",
            "conf",
            "vim",
        },
        user_default_options = {
            names = false, -- don't colorize bare words like "red"/"blue"
        },
    },
}
