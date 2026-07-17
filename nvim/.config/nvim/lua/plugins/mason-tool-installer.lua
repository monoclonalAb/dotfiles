return {
    "WhoIsSethDaniel/mason-tool-installer.nvim",
    dependencies = { "mason-org/mason.nvim" },
    config = function()
        require("mason-tool-installer").setup({
            ensure_installed = {
                "eslint_d",
                "pylint",
                "htmlhint",
                "cpplint",
            },
            run_on_start = true,
            auto_update = false,
        })
    end,
}
