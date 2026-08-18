return {
    "WhoIsSethDaniel/mason-tool-installer.nvim",
    dependencies = { "mason-org/mason.nvim" },
    config = function()
        local ensure_installed = {
            -- Linters and formatters used by nvim-lint and conform.nvim.
            "stylua",
            "black",
            "isort",
            "pylint",
            "cpplint",

            -- Java LSP, tests, and debug support configured in ftplugin/java.lua.
            "jdtls",
            "java-debug-adapter",
            "java-test",

            -- DAP packages configured in dap.lua.
            "codelldb",
            "debugpy",
        }

        -- These packages invoke npm.  Skipping them until Node is available
        -- prevents Mason from failing them on every fresh-install startup.
        if vim.fn.executable("npm") == 1 then
            vim.list_extend(ensure_installed, {
                "eslint_d",
                "htmlhint",
                "prettierd",
                "prettier",
                "js-debug-adapter",
                -- typescript-tools.nvim discovers this package's bundled
                -- tsserver, avoiding a global `npm install -g typescript`.
                "typescript-language-server",
            })
        end

        require("mason-tool-installer").setup({
            ensure_installed = ensure_installed,
            run_on_start = true,
            auto_update = false,
        })
    end,
}
