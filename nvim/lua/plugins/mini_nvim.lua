return {
	"echasnovski/mini.nvim",
	version = false,
	config = function()
		require("mini.surround").setup({ -- quickly surround a word with characters
			mappings = {
				add = "gza",
				delete = "gzd",
				find = "gzf",
				find_left = "gzF",
				highlight = "gzh",
				replace = "gzr",
				update_n_lines = "gzn",
			},
		})
		require("mini.icons").setup() -- icon provider
	end,
}
