-- https://github.com/nvim-neotest/neotest
-- Test explorer: gutter pass/fail signs, run/debug nearest test, summary + output panels.
-- Debug-nearest-test (<leader>td) reuses the nvim-dap stack from dap.lua.
return {
	"nvim-neotest/neotest",
	dependencies = {
		"nvim-neotest/nvim-nio",
		"nvim-lua/plenary.nvim",
		"antoinemadec/FixCursorHold.nvim",
		"nvim-treesitter/nvim-treesitter",
		-- adapters
		"nvim-neotest/neotest-python",
		"nvim-neotest/neotest-jest",
		"marilari88/neotest-vitest",
		"rcasia/neotest-java",
	},
	keys = {
		{ "<leader>tr", function() require("neotest").run.run() end,                     desc = "Run nearest test" },
		{ "<leader>tf", function() require("neotest").run.run(vim.fn.expand("%")) end,   desc = "Run file" },
		{ "<leader>tl", function() require("neotest").run.run_last() end,                desc = "Run last test" },
		{ "<leader>tA", function() require("neotest").run.run(vim.fn.getcwd()) end,      desc = "Run all tests" },
		{ "<leader>tS", function() require("neotest").summary.toggle() end,              desc = "Toggle summary" },
		{ "<leader>to", function() require("neotest").output.open({ enter = true }) end, desc = "Show output" },
		{ "<leader>tO", function() require("neotest").output_panel.toggle() end,         desc = "Toggle output panel" },
		{ "<leader>tw", function() require("neotest").watch.toggle() end,                desc = "Toggle watch" },
		{ "<leader>td", function() require("neotest").run.run({ strategy = "dap" }) end, desc = "Debug nearest test" },
		-- failed-test nav uses capital T to avoid colliding with todo-comments ]t/[t
		{ "]T", function() require("neotest").jump.next({ status = "failed" }) end, desc = "Next failed test" },
		{ "[T", function() require("neotest").jump.prev({ status = "failed" }) end, desc = "Prev failed test" },
	},
	config = function()
		require("neotest").setup({
			adapters = {
				require("neotest-python")({ runner = "pytest", dap = { justMyCode = false } }),
				require("neotest-jest")({}),
				require("neotest-vitest"),
				require("neotest-java")({}),
			},
		})
	end,
}
