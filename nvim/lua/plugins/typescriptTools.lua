return {
    {
        "pmizio/typescript-tools.nvim",
        dependencies = { "nvim-lua/plenary.nvim", "neovim/nvim-lspconfig" },
        opts = {},
        config = function()
            require("typescript-tools").setup {
                on_attach =
                    function(client, bufnr)
                        client.server_capabilities.documentFormattingProvider = false
                        client.server_capabailities. documentRangeFormattingProvider = false
                    end,
                settings = {
                    jsx_close_tag = {
                        enable = true,
                        filetypes = {"javascriptreact", "typescriptreact" },
                    }
                }
            }
        end,
    }
}
