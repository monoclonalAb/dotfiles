return {
    "mfussenegger/nvim-lint",
    event = {
        "BufReadPre",
        "BufNewFile",
    },
    config = function()
        local lint = require("lint")

        lint.linters_by_ft = {
            javascript = { "eslint_d" },
            typescript = { "eslint_d" },
            javascriptreact = { "eslint_d" },
            typescriptreact = { "eslint_d" },
            python = { "pylint" },
            html = { "htmlhint" },
            -- css = { "stylelint" },
            cpp = { "cpplint" },
        }

        local lint_augroup = vim.api.nvim_create_augroup("lint", { clear = true })

        vim.api.nvim_create_autocmd({ "BufReadPost", "BufWritePost", "InsertLeave" }, {
            group = lint_augroup,
            callback = function()
                -- Skip special buffers (help, terminal, prompts, etc.)
                if vim.bo.buftype ~= "" then
                    return
                end
                -- Only run linters whose executable actually exists, so a missing
                -- tool can't throw "ENOENT: no such file or directory".
                local runnable = {}
                for _, name in ipairs(lint.linters_by_ft[vim.bo.filetype] or {}) do
                    local linter = lint.linters[name]
                    local cmd = type(linter) == "table" and linter.cmd or nil
                    cmd = type(cmd) == "function" and cmd() or cmd
                    if cmd and vim.fn.executable(cmd) == 1 then
                        table.insert(runnable, name)
                    end
                end
                if #runnable > 0 then
                    lint.try_lint(runnable)
                end
            end,
        })

        vim.keymap.set("n", "<leader>l", function()
            lint.try_lint()
        end, { desc = "Trigger linting for current file" })
    end,
}
