-- https://github.com/mfussenegger/nvim-jdtls
-- Java LSP + debugging. The actual start/attach is wired in ftplugin/java.lua
-- (the idiomatic nvim-jdtls setup); this spec just declares the plugin + its DAP dep.
return {
	"mfussenegger/nvim-jdtls",
	ft = "java",
	dependencies = { "mfussenegger/nvim-dap" },
}
