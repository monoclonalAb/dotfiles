-- number lines
vim.opt.number = true
vim.opt.relativenumber = true

-- windows split rules
vim.opt.splitbelow = true
vim.opt.splitright = true

-- line wrapping rules
vim.opt.wrap = false

-- tap spaces rules
vim.opt.expandtab = true
vim.opt.tabstop = 2
vim.opt.shiftwidth = 4

-- cursor can be positioned where there are no characters - maybe try with "all" later
vim.opt.virtualedit = "block"

-- synchronizes the system clipboard with Neovim's clipboard
vim.opt.clipboard = "unnamedplus"

-- position window in middle when scrolling
vim.opt.scrolloff = 999

-- shows the changes of e.g. substitute in a split window
vim.opt.inccommand = "split"

vim.opt.ignorecase = true

-- allow terminal to display all colors???
vim.opt.termguicolors = true

-- Make sure to setup `mapleader` and `maplocalleader` before
-- loading lazy.nvim so that mappings are correct.
-- This is also a good place to setup other settings (vim.opt)
vim.g.mapleader = " "
vim.g.maplocalleader = "\\"

-- set file format
vim.opt.fileformat = "unix"
vim.api.nvim_create_autocmd("BufWritePre", {
	pattern = "*",
	callback = function()
		vim.opt.fileformat = "unix"
	end,
})

-- let ghregex='\(^\|\s\s\)\zs\.\S\+'
-- let g:netrw_list_hide=ghregex
-- let g:netrw_hide = 1
