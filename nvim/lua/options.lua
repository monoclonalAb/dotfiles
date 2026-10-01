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
vim.opt.shiftwidth = 2

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
local fmt_grp = vim.api.nvim_create_augroup("ForceUnixFileformat", { clear = true })
vim.api.nvim_create_autocmd("BufWritePre", {
	group = fmt_grp,
	pattern = "*",
	callback = function()
		vim.bo.fileformat = "unix"
	end,
})

-- set up diagnostics
vim.diagnostic.config({
	virtual_text = true, -- Show inline diagnostics
	signs = true, -- Show signs in the gutter
	update_in_insert = false,
	underline = true,
	severity_sort = true,
})

-- Toggle expanded multi-line diagnostics (native 0.11 virtual_lines).
-- Flips between compact virtual_text and full virtual_lines so they don't stack.
vim.keymap.set("n", "<leader>vL", function()
	local cfg = vim.diagnostic.config()
	if cfg.virtual_lines then
		vim.diagnostic.config({ virtual_lines = false, virtual_text = true })
	else
		vim.diagnostic.config({ virtual_lines = true, virtual_text = false })
	end
end, { desc = "Toggle virtual_lines diagnostics" })

-- set up undotree

vim.opt.undodir = os.getenv("HOME") .. "/.vim/undodir"
vim.opt.undofile = true

-- let ghregex='\(^\|\s\s\)\zs\.\S\+'
-- let g:netrw_list_hide=ghregex
-- let g:netrw_hide = 1
