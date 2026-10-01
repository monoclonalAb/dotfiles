-- https://github.com/sindrets/diffview.nvim
-- IDE-grade diff view, file/repo history browser, and merge tool.
-- (If you hit an upstream bug, the dlyongemallo/diffview.nvim fork has newer fixes.)
return {
	"sindrets/diffview.nvim",
	cmd = { "DiffviewOpen", "DiffviewClose", "DiffviewFileHistory", "DiffviewToggleFiles", "DiffviewFocusFiles" },
	opts = { enhanced_diff_hl = true },
	keys = {
		{ "<leader>gv", "<cmd>DiffviewOpen<cr>",          desc = "Diffview open" },
		{ "<leader>gV", "<cmd>DiffviewClose<cr>",         desc = "Diffview close" },
		{ "<leader>gf", "<cmd>DiffviewFileHistory %<cr>", desc = "File history (current)" },
		{ "<leader>gF", "<cmd>DiffviewFileHistory<cr>",   desc = "Repo history" },
	},
}
