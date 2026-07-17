local keymap = vim.keymap.set

---------------------------
-- Leader Key == 'Space' --
---------------------------

------------------
-- Vim Keybinds --
------------------
keymap("n", "<leader>e", ":Oil --float<CR>")

-----------------
-- Vim Macroes --
-----------------
keymap("n", "<leader>gr", "gd[{V%::s/<C-R>///gc<left><left><left>", {}) -- locally change all variable names
keymap("n", "<leader>gR", "gD:%s/<C-R>///gc<left><left><left>") -- globally change all variable names

------------------------
-- Telescope Keybinds --
------------------------

local builtin = require("telescope.builtin")
keymap("n", "<leader>ff", builtin.find_files, { desc = "Telescope find files" })
keymap("n", "<leader>fg", builtin.live_grep, { desc = "Telescope live grep" })
keymap("n", "<leader>fb", builtin.buffers, { desc = "Telescope buffers" })
keymap("n", "<leader>fh", builtin.help_tags, { desc = "Telescope help tags" })

----------------------------
-- mini-surround keybinds --
----------------------------

-- gza == add surrounding
-- gzd == delete surrounding
-- gzr == replace surrounding
-- gzf or gzF == find surrounding (cursor before or cursor after)
-- gzh == highlight surrounding
-- gzn == change number of neighbour lines

-----------------------
-- Fugitive Keybinds --
-----------------------

-- git == <leader>gs
-- Git log == <leader>gl
-- Git blame == <leader>gw
-- Gvdiffsplit == <leader>gd

----------------------
-- Harpoon Keybinds --  (defined in lua/plugins/harpoon.lua)
----------------------
-- <leader>ha == add file
-- <leader>hm == toggle quick menu
-- <leader>hn / <leader>hp == next / prev
-- <leader>1..4 == jump to mark
