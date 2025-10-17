-- https://github.com/j-hui/fidget.nvim
-- Extensible UI for Neovim notifications and LSP progress messages.
return {
    "j-hui/fidget.nvim",
    config = function()
        require("fidget").setup({
            notification = {
                window = {
                    winblend = 0
                }
            }
        })
    end,
}
