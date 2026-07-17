-- https://github.com/folke/which-key.nvim
-- Keybinding discovery popup. Surfaces the many leader maps in this config and
-- labels the prefix groups so everything is self-documenting.
return {
	"folke/which-key.nvim",
	event = "VeryLazy",
	opts = {
		preset = "modern",
	},
	config = function(_, opts)
		local wk = require("which-key")
		wk.setup(opts)
		wk.add({
			{ "<leader>f", group = "find (telescope)" },
			{ "<leader>g", group = "git" },
			{ "<leader>gh", group = "git hunks" },
			{ "<leader>gc", group = "git conflict" },
			{ "<leader>v", group = "lsp" },
			{ "<leader>d", group = "debug" },
			{ "<leader>dp", group = "debug python" },
			{ "<leader>dj", group = "debug java" },
			{ "<leader>t", group = "test" },
			{ "<leader>x", group = "trouble/diagnostics" },
			{ "<leader>h", group = "harpoon" },
			{ "<leader>q", group = "session" },
			{ "<leader>a", group = "align (tabular)" },
			{ "<leader>s", group = "treesitter select" },
		})
	end,
}
