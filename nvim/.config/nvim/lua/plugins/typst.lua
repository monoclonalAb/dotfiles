return {
    {
        "chomosuke/typst-preview.nvim",
        version = "1.*",
        ft = "typst",
        cmd = { "TypstPreview", "TypstPreviewToggle", "TypstPreviewStop" },
        keys = {
            { "<leader>tp", "<cmd>TypstPreview<cr>",       mode = "n", desc = "Typst preview" },
            { "<leader>ts", "<cmd>TypstPreview slide<cr>", mode = "n", desc = "Typst preview (slide)" },
            { "<leader>tt", "<cmd>TypstPreviewToggle<cr>", mode = "n", desc = "Typst preview toggle" },
            { "<leader>tx", "<cmd>TypstPreviewStop<cr>",   mode = "n", desc = "Typst preview stop" },
        },
        opts = {},
    },
    {
        "kaarmu/typst.vim",
        ft = "typst",
    },
}
