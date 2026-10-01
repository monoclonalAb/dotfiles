-- https://github.com/folke/trouble.nvim
-- "Problems" panel: workspace/buffer diagnostics, references, symbols, qf/loclist, todos.
return {
	"folke/trouble.nvim",
	cmd = "Trouble",
	opts = {},
	keys = {
		{ "<leader>xx", "<cmd>Trouble diagnostics toggle<cr>",              desc = "Diagnostics (workspace)" },
		{ "<leader>xX", "<cmd>Trouble diagnostics toggle filter.buf=0<cr>", desc = "Diagnostics (buffer)" },
		{ "<leader>xs", "<cmd>Trouble symbols toggle focus=false<cr>",      desc = "Symbols" },
		{ "<leader>xr", "<cmd>Trouble lsp_references toggle focus=false<cr>", desc = "LSP references" },
		{ "<leader>xl", "<cmd>Trouble loclist toggle<cr>",                 desc = "Location list" },
		{ "<leader>xq", "<cmd>Trouble qflist toggle<cr>",                  desc = "Quickfix list" },
		{ "<leader>xt", "<cmd>Trouble todo toggle<cr>",                    desc = "Todo" },
	},
}
