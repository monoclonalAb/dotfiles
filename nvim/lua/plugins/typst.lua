return {
    {
        'chomosuke/typst-preview.nvim',
        lazy = false, -- or ft = 'typst'
        version = '1.*',
        opts = {
            vim.keymap.set('n', '<leader>tp', ':TypstPreview<CR>', { noremap = true }),       -- Start preview
            vim.keymap.set('n', '<leader>ts', ':TypstPreview slide<CR>', { noremap = true }), -- Start preview in slide mode
            vim.keymap.set('n', '<leader>tt', ':TypstPreviewToggle<CR>', { noremap = true }), -- Toggle preview
            vim.keymap.set('n', '<leader>tx', ':TypstPreviewStop<CR>', { noremap = true }),   -- Stop preview
        },                                                                                    -- lazy.nvim will implicitly calls `setup {}`
    },
    {
        "kaarmu/typst.vim",
        ft = "typst",
        lazy = false,
    },
}
