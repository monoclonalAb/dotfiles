return {
    {
        "lewis6991/gitsigns.nvim",
        event = { "BufReadPre", "BufNewFile" },
        opts = {
            current_line_blame = false, -- toggled on demand via <leader>gb
            on_attach = function(bufnr)
                local gs = require("gitsigns")
                local function map(mode, l, r, desc)
                    vim.keymap.set(mode, l, r, { buffer = bufnr, desc = desc })
                end

                -- Hunk navigation (guarded so native diff-mode nav still works)
                map("n", "]c", function()
                    if vim.wo.diff then
                        vim.cmd.normal({ "]c", bang = true })
                    else
                        gs.nav_hunk("next")
                    end
                end, "Next hunk")
                map("n", "[c", function()
                    if vim.wo.diff then
                        vim.cmd.normal({ "[c", bang = true })
                    else
                        gs.nav_hunk("prev")
                    end
                end, "Prev hunk")

                -- Hunk actions
                map("n", "<leader>ghs", gs.stage_hunk, "Stage hunk")
                map("n", "<leader>ghr", gs.reset_hunk, "Reset hunk")
                map("v", "<leader>ghs", function() gs.stage_hunk({ vim.fn.line("."), vim.fn.line("v") }) end,
                    "Stage hunk (selection)")
                map("v", "<leader>ghr", function() gs.reset_hunk({ vim.fn.line("."), vim.fn.line("v") }) end,
                    "Reset hunk (selection)")
                map("n", "<leader>ghp", gs.preview_hunk_inline, "Preview hunk")
                map("n", "<leader>ghu", gs.undo_stage_hunk, "Undo stage hunk")
                map("n", "<leader>ghS", gs.stage_buffer, "Stage buffer")
                map("n", "<leader>ghR", gs.reset_buffer, "Reset buffer")

                -- Blame
                map("n", "<leader>gb", gs.toggle_current_line_blame, "Toggle line blame")
                map("n", "<leader>gB", function() gs.blame_line({ full = true }) end, "Blame line (full)")
            end,
        },
    },
}
