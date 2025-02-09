return {
    'echasnovski/mini.nvim',
    version = false,
    config = function()
        require("mini.surround").setup()
        require("mini.pick").setup()
    end,
}
