return {
	"williamboman/mason-lspconfig.nvim",
	dependencies = {
		{ "mason-org/mason.nvim", opts = {} },
		{ "neovim/nvim-lspconfig" },
	},
	config = function()
		require("mason-lspconfig").setup({
			ensure_installed = {
				"html",
				"cssls",
				"tailwindcss",
				"lua_ls",
				"clangd",
				"ruff",
				"ty",
				"jsonls",
				"yamlls",
			},
		})

		vim.lsp.config("clangd", {
			init_options = {
				fallbackFlags = { "-std=c++23" },
			},
		})

		-- Schema-aware JSON/YAML editing (package.json, tsconfig, eslintrc, CI, tasks.json...)
		vim.lsp.config("jsonls", {
			settings = {
				json = {
					schemas = require("schemastore").json.schemas(),
					validate = { enable = true },
				},
			},
		})

		vim.lsp.config("yamlls", {
			settings = {
				yaml = {
					schemaStore = { enable = false, url = "" },
					schemas = require("schemastore").yaml.schemas(),
				},
			},
		})

		vim.api.nvim_create_autocmd("LspAttach", {
			group = vim.api.nvim_create_augroup("UserLspConfig", {}),
			callback = function(ev)
				local client = vim.lsp.get_client_by_id(ev.data.client_id)
				vim.bo[ev.buf].omnifunc = "v:lua.vim.lsp.omnifunc"
				local opts = { buffer = ev.buf }
				vim.keymap.set("n", "gd", vim.lsp.buf.definition, opts)
				vim.keymap.set("n", "gD", vim.lsp.buf.declaration, opts)
				vim.keymap.set("n", "gi", vim.lsp.buf.implementation, opts)
				vim.keymap.set("n", "K", vim.lsp.buf.hover, opts)
				vim.keymap.set("n", "<leader>vws", vim.lsp.buf.workspace_symbol, opts)
				vim.keymap.set("n", "<leader>vd", vim.diagnostic.open_float, opts)
				vim.keymap.set({ "n", "v" }, "<leader>vca", vim.lsp.buf.code_action, opts)
				vim.keymap.set("n", "gr", vim.lsp.buf.references, opts)
				vim.keymap.set("n", "<leader>vrn", vim.lsp.buf.rename, opts)
				vim.keymap.set("n", "<leader>vtd", vim.lsp.buf.type_definition, opts)

				-- Inlay hints (native, Neovim 0.11). On by default; <leader>vh toggles.
				if client and client:supports_method("textDocument/inlayHint") then
					vim.lsp.inlay_hint.enable(true, { bufnr = ev.buf })
					vim.keymap.set("n", "<leader>vh", function()
						vim.lsp.inlay_hint.enable(
							not vim.lsp.inlay_hint.is_enabled({ bufnr = ev.buf }),
							{ bufnr = ev.buf }
						)
					end, { buffer = ev.buf, desc = "Toggle inlay hints" })
				end

				-- Codelens (native). Refresh on events; <leader>vl runs the lens under cursor.
				if client and client:supports_method("textDocument/codeLens") then
					vim.lsp.codelens.refresh({ bufnr = ev.buf })
					vim.api.nvim_create_autocmd({ "BufEnter", "CursorHold", "InsertLeave" }, {
						buffer = ev.buf,
						group = vim.api.nvim_create_augroup("UserLspCodelens" .. ev.buf, { clear = true }),
						callback = function()
							vim.lsp.codelens.refresh({ bufnr = ev.buf })
						end,
					})
					vim.keymap.set("n", "<leader>vl", vim.lsp.codelens.run, { buffer = ev.buf, desc = "Run codelens" })
				end
			end,
		})
	end,
}
