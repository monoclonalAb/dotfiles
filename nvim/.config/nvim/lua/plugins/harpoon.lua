return {
    {
        "ThePrimeagen/harpoon",
        branch = "harpoon2",
        dependencies = { "nvim-lua/plenary.nvim" },
        config = function()
            local harpoon = require("harpoon")
            harpoon:setup()

            local list = function() return harpoon:list() end

            vim.keymap.set("n", "<leader>ha", function() list():add() end, { desc = "Harpoon add file" })
            vim.keymap.set("n", "<leader>hm", function() harpoon.ui:toggle_quick_menu(list()) end,
                { desc = "Harpoon menu" })
            vim.keymap.set("n", "<leader>hn", function() list():next() end, { desc = "Harpoon next" })
            vim.keymap.set("n", "<leader>hp", function() list():prev() end, { desc = "Harpoon prev" })

            for i = 1, 4 do
                vim.keymap.set("n", "<leader>" .. i, function() list():select(i) end,
                    { desc = "Harpoon select " .. i })
            end
        end,
    },
}
