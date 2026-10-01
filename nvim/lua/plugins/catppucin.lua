return {
    "catppuccin/nvim",
    name = "catppuccin",
    priority = 1000,
    config = function()
        -- Flavour and transparency come from the shared theme state, so a
        -- newly-started nvim matches whatever Alacritty and tmux are showing.
        require("theme").setup()
    end,
}
