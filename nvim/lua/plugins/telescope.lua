return {
    {
        "nvim-telescope/telescope.nvim",
        dependencies = {
            "nvim-lua/plenary.nvim",
            { "nvim-telescope/telescope-fzf-native.nvim", build = "make" },
            "debugloop/telescope-undo.nvim",
        },
        config = function()
            local telescope = require("telescope")
            local actions = require("telescope.actions")
            -- configure telescope (single setup; extension configs live here)
            telescope.setup({
                defaults = {
                    mappings = {
                        i = {
                            ["<C-k>"] = actions.move_selection_previous,                       -- move to prev result
                            ["<C-j>"] = actions.move_selection_next,                           -- move to next result
                            ["<C-q>"] = actions.send_selected_to_qflist + actions.open_qflist, -- send selected to quickfixlist
                            ["<C-d>"] = actions.delete_buffer,
                        },
                    },
                },
                extensions = {
                    undo = {
                        -- telescope-undo.nvim config, see plugin docs
                    },
                },
            })
            telescope.load_extension("fzf")
            telescope.load_extension("undo")

            vim.keymap.set("n", "<leader>u", "<cmd>Telescope undo<cr>", { desc = "Undo history" })
        end,
    },
}
