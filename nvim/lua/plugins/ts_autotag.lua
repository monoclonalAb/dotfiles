-- https://github.com/windwp/nvim-ts-autotag
-- Auto-close and auto-rename paired HTML/JSX/TSX tags (autopairs does not do tags).
return {
	"windwp/nvim-ts-autotag",
	ft = {
		"html",
		"xml",
		"javascript",
		"javascriptreact",
		"typescript",
		"typescriptreact",
		"svelte",
		"vue",
		"markdown",
	},
	opts = {},
}
