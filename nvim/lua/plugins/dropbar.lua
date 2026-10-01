-- https://github.com/Bekaboo/dropbar.nvim
-- Breadcrumbs bar in the winbar (path > class > method) with interactive pick.
-- 0.11-native and dependency-free; complements treesitter-context.
return {
	"Bekaboo/dropbar.nvim",
	event = { "BufReadPost", "BufNewFile" },
	keys = {
		{ "<leader>;", function() require("dropbar.api").pick() end, desc = "Breadcrumbs pick" },
	},
	opts = {},
}
