return {
	{
		"mbbill/undotree",
		lazy = false,
		config = function()
			vim.keymap.set("n", "<leader>U", vim.cmd.UndotreeToggle, { desc = "Undotree toggle" })
		end,
	},
}
