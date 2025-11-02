return {
    "catppuccin/nvim",
    priority = 1000,
    config = function()
        opts = {
            transparent_background = true,
        }
        vim.cmd.colorscheme("catppuccin-latte")
    end,
}
