return {
    {
        "nvim-telescope/telescope.nvim",
        dependencies = {
            "nvim-lua/plenary.nvim",
            "debugloop/telescope-undo.nvim",
        },
        config = function()
            local telescope = require("telescope")
            local actions = require("telescope.actions")
            -- configure telescope
            telescope.setup({
                -- configure custom mappings
                defaults = {
                    mappings = {
                        i = {
                            ["<C-k>"] = actions.move_selection_previous,                       -- move to prev result
                            ["<C-j>"] = actions.move_selection_next,                           -- move to next result
                            ["<C-q>"] = actions.send_selected_to_qflist + actions.open_qflist, -- send selected to quickfixlist
                            ['<C-d>'] = require('telescope.actions').delete_buffer,
                        },
                    },
                },
                extensions = {
                    undo = {
                        -- telescope-undo.nvim config, see below
                    },
                    -- other extensions:
                    -- file_browser = { ... }
                },
            })
            telescope.load_extension("fzf")
            telescope.load_extension("undo")
        end,
    },
    { "nvim-telescope/telescope-fzf-native.nvim", build = "make" },
    {
        "debugloop/telescope-undo.nvim",
        dependencies = { -- note how they're inverted to above example
            {
                "nvim-telescope/telescope.nvim",
                dependencies = { "nvim-lua/plenary.nvim" },
            },
        },
        keys = {
            { -- lazy style key map
                "<leader>u",
                "<cmd>Telescope undo<cr>",
                desc = "undo history",
            },
        },
        opts = {
            -- don't use `defaults = { }` here, do this in the main telescope spec
            extensions = {
                undo = {
                    -- telescope-undo.nvim config, see below
                },
                -- no other extensions here, they can have their own spec too
            },
        },
        config = function(_, opts)
            -- Calling telescope's setup from multiple specs does not hurt, it will happily merge the
            -- configs for us. We won't use data, as everything is in it's own namespace (telescope
            -- defaults, as well as each extension).
            require("telescope").setup(opts)
            require("telescope").load_extension("undo")
        end,
    },
}
