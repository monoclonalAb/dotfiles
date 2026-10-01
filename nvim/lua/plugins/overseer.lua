-- https://github.com/stevearc/overseer.nvim
-- Task runner: discovers make/npm/cargo, reads VS Code tasks.json, errors -> quickfix.
return {
	"stevearc/overseer.nvim",
	cmd = { "OverseerRun", "OverseerToggle", "OverseerOpen", "OverseerClose", "OverseerTaskAction", "OverseerShell" },
	keys = {
		{ "<leader>r", "<cmd>OverseerRun<cr>",    desc = "Run task" },
		{ "<leader>R", "<cmd>OverseerToggle<cr>", desc = "Task list" },
	},
	opts = {
		task_list = { direction = "bottom" },
	},
}
