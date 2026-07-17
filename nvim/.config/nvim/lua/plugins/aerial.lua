-- https://github.com/stevearc/aerial.nvim
-- Symbol outline / code structure panel (the VS Code "Outline" view).
return {
	"stevearc/aerial.nvim",
	branch = "nvim-0.11", -- master targets nvim 0.12+; pin to the 0.11-compat branch
	dependencies = { "nvim-treesitter/nvim-treesitter", "nvim-tree/nvim-web-devicons" },
	cmd = { "AerialToggle", "AerialOpen", "AerialNavToggle" },
	keys = {
		{ "<leader>o", "<cmd>AerialToggle!<cr>", desc = "Outline (aerial)" },
	},
	opts = {
		backends = { "lsp", "treesitter", "markdown", "man" },
		layout = { default_direction = "right" },
		attach_mode = "global",
		on_attach = function(bufnr)
			vim.keymap.set("n", "]]", "<cmd>AerialNext<cr>", { buffer = bufnr, desc = "Aerial next symbol" })
			vim.keymap.set("n", "[[", "<cmd>AerialPrev<cr>", { buffer = bufnr, desc = "Aerial prev symbol" })
		end,
	},
}
