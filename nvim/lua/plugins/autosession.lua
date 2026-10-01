-- https://github.com/rmagatti/auto-session
-- Per-cwd session restore ("reopen folder" restores buffers/layout).
return {
	"rmagatti/auto-session",
	lazy = false,
	keys = {
		{ "<leader>qs", "<cmd>SessionSearch<cr>",  desc = "Search sessions" },
		{ "<leader>qr", "<cmd>SessionRestore<cr>", desc = "Restore session" },
		{ "<leader>qd", "<cmd>SessionDelete<cr>",  desc = "Delete session" },
	},
	opts = {
		suppressed_dirs = { "~/", "~/Downloads", "/" },
		bypass_save_filetypes = { "oil", "alpha", "dashboard", "trouble", "aerial" },
	},
	config = function(_, opts)
		-- Needed for layout/buffers to actually restore.
		vim.o.sessionoptions =
			"blank,buffers,curdir,folds,help,tabpages,winsize,winpos,terminal,localoptions"
		require("auto-session").setup(opts)
	end,
}
