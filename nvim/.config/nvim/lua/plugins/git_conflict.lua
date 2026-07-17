-- https://github.com/akinsho/git-conflict.nvim
-- Inline "accept ours/theirs/both/none" on conflict markers + conflict navigation.
return {
	"akinsho/git-conflict.nvim",
	version = "*",
	event = { "BufReadPre" },
	opts = { default_mappings = false },
	config = function(_, opts)
		require("git-conflict").setup(opts)
		local map = function(lhs, rhs, desc)
			vim.keymap.set("n", lhs, rhs, { desc = desc })
		end
		map("<leader>gco", "<cmd>GitConflictChooseOurs<cr>", "Conflict: choose ours")
		map("<leader>gct", "<cmd>GitConflictChooseTheirs<cr>", "Conflict: choose theirs")
		map("<leader>gcb", "<cmd>GitConflictChooseBoth<cr>", "Conflict: choose both")
		map("<leader>gc0", "<cmd>GitConflictChooseNone<cr>", "Conflict: choose none")
		map("]x", "<cmd>GitConflictNextConflict<cr>", "Next conflict")
		map("[x", "<cmd>GitConflictPrevConflict<cr>", "Prev conflict")
	end,
}
