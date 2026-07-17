-- Java LSP + debug via nvim-jdtls. Runs on every Java buffer; start_or_attach
-- reuses an existing client per project. Requires (mason): jdtls,
-- java-debug-adapter, java-test.
local ok, jdtls = pcall(require, "jdtls")
if not ok then
	return
end

local home = os.getenv("HOME")
local mason = vim.fn.stdpath("data") .. "/mason"
local jdtls_path = mason .. "/packages/jdtls"

-- Per-project workspace dir
local project = vim.fn.fnamemodify(vim.fn.getcwd(), ":p:h:t")
local workspace_dir = home .. "/.local/share/nvim/jdtls-workspace/" .. project

-- Project root
local root_dir = require("jdtls.setup").find_root({ ".git", "mvnw", "gradlew", "pom.xml", "build.gradle" })
	or vim.fn.getcwd()

-- jdtls launcher + platform config from mason
local launcher = vim.fn.glob(jdtls_path .. "/plugins/org.eclipse.equinox.launcher_*.jar")
local os_config
if vim.fn.has("mac") == 1 then
	os_config = jdtls_path .. "/config_mac"
elseif vim.fn.has("unix") == 1 then
	os_config = jdtls_path .. "/config_linux"
else
	os_config = jdtls_path .. "/config_win"
end

-- Debug + test bundles
local bundles = {}
vim.list_extend(
	bundles,
	vim.split(
		vim.fn.glob(mason .. "/packages/java-debug-adapter/extension/server/com.microsoft.java.debug.plugin-*.jar", true),
		"\n"
	)
)
vim.list_extend(bundles, vim.split(vim.fn.glob(mason .. "/packages/java-test/extension/server/*.jar", true), "\n"))

local config = {
	cmd = {
		"java",
		"-Declipse.application=org.eclipse.jdt.ls.core.id1",
		"-Dosgi.bundles.defaultStartLevel=4",
		"-Declipse.product=org.eclipse.jdt.ls.core.product",
		"-Dlog.protocol=true",
		"-Dlog.level=ALL",
		"-Xmx1g",
		"--add-modules=ALL-SYSTEM",
		"--add-opens",
		"java.base/java.util=ALL-UNNAMED",
		"--add-opens",
		"java.base/java.lang=ALL-UNNAMED",
		"-jar",
		launcher,
		"-configuration",
		os_config,
		"-data",
		workspace_dir,
	},
	root_dir = root_dir,
	init_options = { bundles = bundles },
	on_attach = function(_, bufnr)
		jdtls.setup_dap({ hotcodereplace = "auto" })
		require("jdtls.dap").setup_dap_main_class_configs()
		vim.keymap.set("n", "<leader>djt", jdtls.test_nearest_method, { buffer = bufnr, desc = "Debug test method" })
		vim.keymap.set("n", "<leader>djc", jdtls.test_class, { buffer = bufnr, desc = "Debug test class" })
	end,
}

jdtls.start_or_attach(config)
