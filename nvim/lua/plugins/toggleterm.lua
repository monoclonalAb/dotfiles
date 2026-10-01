-- https://github.com/akinsho/toggleterm.nvim
-- Integrated terminal (floating) + a lazygit float on <leader>gg.
-- (lazygit float needs the `lazygit` binary: `brew install lazygit`.)
return {
	"akinsho/toggleterm.nvim",
	version = "*",
	cmd = { "ToggleTerm", "TermExec" },
	keys = {
		{ [[<C-\>]], "<cmd>ToggleTerm<cr>", mode = { "n", "t" }, desc = "Toggle terminal" },
		{ "<leader>gg", function() _LAZYGIT_TOGGLE() end, desc = "Lazygit" },
	},
	opts = {
		direction = "float",
		float_opts = { border = "rounded" },
	},
	config = function(_, opts)
		require("toggleterm").setup(opts)
		local Terminal = require("toggleterm.terminal").Terminal
		local lazygit = Terminal:new({
			cmd = "lazygit",
			hidden = true,
			direction = "float",
			float_opts = { border = "rounded" },
		})
		function _LAZYGIT_TOGGLE()
			lazygit:toggle()
		end
	end,
}
