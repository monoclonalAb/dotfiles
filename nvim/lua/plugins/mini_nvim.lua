return {
    'echasnovski/mini.nvim',
    version = false,
    config = function()
        require("mini.surround").setup() -- quickly surround a word with characters
        require("mini.pick").setup()     -- alternate 'telescope'
        require('mini.icons').setup()    -- icon provider
    end,
}
