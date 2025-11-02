-- https://https://github.com/MeanderingProgrammer/render-markdown.nvim
-- for helping render markdown files
return {
	{
		"MeanderingProgrammer/render-markdown.nvim",
		dependencies = { "nvim-treesitter/nvim-treesitter", "nvim-mini/mini.icons" }, -- if you use standalone mini plugins
		-- dependencies = { 'nvim-treesitter/nvim-treesitter', 'nvim-tree/nvim-web-devicons' },
		---@module 'render-markdown'
		---@type render.md.UserConfig
		opts = {},
	},
	{
		"jakewvincent/mkdnflow.nvim",
		opts = {
			mappings = {
				MkdnEnter = { { "n", "v" }, "<CR>" },
				-- MkdnEnter = false,
				MkdnTab = false,
				MkdnSTab = false,
				MkdnNextLink = { "n", "<Tab>" },
				MkdnPrevLink = { "n", "<S-Tab>" },
				MkdnNextHeading = { "n", "]]" },
				MkdnPrevHeading = { "n", "[[" },
				MkdnGoBack = { "n", "<BS>" },
				MkdnGoForward = { "n", "<Del>" },
				MkdnCreateLink = false, -- see MkdnEnter
				MkdnCreateLinkFromClipboard = { { "n", "v" }, "<leader>p" }, -- see MkdnEnter
				MkdnFollowLink = false, -- see MkdnEnter
				MkdnDestroyLink = { "n", "<M-CR>" },
				MkdnTagSpan = { "v", "<M-CR>" },
				MkdnMoveSource = { "n", "<F2>" },
				MkdnYankAnchorLink = { "n", "yaa" },
				MkdnYankFileAnchorLink = { "n", "yfa" },
				MkdnIncreaseHeading = { "n", "+" },
				MkdnDecreaseHeading = { "n", "-" },
				MkdnToggleToDo = { { "n", "v" }, "<C-space>" },
				MkdnNewListItem = false,
				MkdnNewListItemBelowInsert = { "n", "o" },
				MkdnNewListItemAboveInsert = { "n", "O" },
				MkdnExtendList = false,
				MkdnUpdateNumbering = { "n", "<leader>nn" },
				MkdnTableNextCell = { "i", "<Tab>" },
				MkdnTablePrevCell = { "i", "<S-Tab>" },
				MkdnTableNextRow = false,
				MkdnTablePrevRow = { "i", "<M-CR>" },
				MkdnTableNewRowBelow = { "n", "<leader>ir" },
				MkdnTableNewRowAbove = { "n", "<leader>iR" },
				MkdnTableNewColAfter = { "n", "<leader>ic" },
				MkdnTableNewColBefore = { "n", "<leader>iC" },
				MkdnFoldSection = { "n", "<leader>f" },
				MkdnUnfoldSection = { "n", "<leader>F" },
			},
		},
	},
}
