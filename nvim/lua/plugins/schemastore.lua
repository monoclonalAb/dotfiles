-- https://github.com/b0o/SchemaStore.nvim
-- JSON/YAML schema catalog. Wired into jsonls/yamlls in lua/plugins/lsp.lua so
-- package.json, tsconfig.json, .eslintrc, GitHub Actions, tasks.json, etc. get
-- validation + completion.
return {
	"b0o/SchemaStore.nvim",
	lazy = true,
}
