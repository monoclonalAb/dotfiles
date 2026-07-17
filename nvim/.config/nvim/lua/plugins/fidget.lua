-- https://github.com/j-hui/fidget.nvim
-- Extensible UI for Neovim notifications and LSP progress messages.
return {
    "j-hui/fidget.nvim",
    config = function()
        require("fidget").setup({
            notification = {
                window = {
                    max_width = 0, -- avoid unbounded-memory reflow loop (fidget.nvim #296)
                    winblend = 0,
                },
            },
        })
    end,
}
