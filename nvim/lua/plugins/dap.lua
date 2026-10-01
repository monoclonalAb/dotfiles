-- Debug Adapter Protocol: breakpoints, stepping, scopes/watches, REPL.
-- Installed once and reused by neotest's strategy="dap" (debug-nearest-test).
return {
	{
		"mfussenegger/nvim-dap",
		dependencies = {
			{ "rcarriga/nvim-dap-ui", dependencies = { "nvim-neotest/nvim-nio" } },
			"theHamsta/nvim-dap-virtual-text",
			"jay-babu/mason-nvim-dap.nvim",
			"mason-org/mason.nvim",
		},
		keys = {
			{ "<leader>db", function() require("dap").toggle_breakpoint() end, desc = "Toggle breakpoint" },
			{
				"<leader>dB",
				function() require("dap").set_breakpoint(vim.fn.input("Breakpoint condition: ")) end,
				desc = "Conditional breakpoint",
			},
			{ "<leader>dc", function() require("dap").continue() end,    desc = "Continue / start" },
			{ "<leader>di", function() require("dap").step_into() end,   desc = "Step into" },
			{ "<leader>do", function() require("dap").step_over() end,   desc = "Step over" },
			{ "<leader>dO", function() require("dap").step_out() end,    desc = "Step out" },
			{ "<leader>dr", function() require("dap").repl.toggle() end, desc = "Toggle REPL" },
			{ "<leader>dl", function() require("dap").run_last() end,    desc = "Run last" },
			{ "<leader>dx", function() require("dap").terminate() end,   desc = "Terminate" },
			{ "<leader>du", function() require("dapui").toggle() end,    desc = "Toggle DAP UI" },
			{ "<leader>de", function() require("dapui").eval() end,      desc = "Eval",            mode = { "n", "v" } },
			-- IDE-style function keys (verify <S-F11> in your terminal/tmux)
			{ "<F5>",       function() require("dap").continue() end,    desc = "DAP continue" },
			{ "<F10>",      function() require("dap").step_over() end,   desc = "DAP step over" },
			{ "<F11>",      function() require("dap").step_into() end,   desc = "DAP step into" },
			{ "<S-F11>",    function() require("dap").step_out() end,    desc = "DAP step out" },
		},
		config = function()
			local dap = require("dap")
			local dapui = require("dapui")
			local adapters = { "codelldb", "python" }
			local has_node = vim.fn.executable("node") == 1
			if has_node then
				table.insert(adapters, "js")
			end

			require("mason-nvim-dap").setup({
				ensure_installed = adapters,
				automatic_installation = true,
				handlers = {},
			})

			dapui.setup()
			require("nvim-dap-virtual-text").setup({
				virt_text_pos = "inline",
				clear_on_continue = true,
			})

			-- Breakpoint/stopped signs (catppuccin-latte friendly)
			vim.fn.sign_define("DapBreakpoint", { text = "●", texthl = "DiagnosticError", numhl = "" })
			vim.fn.sign_define("DapBreakpointCondition", { text = "◆", texthl = "DiagnosticWarn", numhl = "" })
			vim.fn.sign_define("DapLogPoint", { text = "◆", texthl = "DiagnosticInfo", numhl = "" })
			vim.fn.sign_define("DapStopped", { text = "▶", texthl = "DiagnosticOk", linehl = "Visual", numhl = "" })

			-- Auto open/close the UI with the session
			dap.listeners.before.attach.dapui_config = function() dapui.open() end
			dap.listeners.before.launch.dapui_config = function() dapui.open() end
			dap.listeners.before.event_terminated.dapui_config = function() dapui.close() end
			dap.listeners.before.event_exited.dapui_config = function() dapui.close() end

			-- C/C++: codelldb (installed by mason-nvim-dap)
			dap.adapters.codelldb = {
				type = "server",
				port = "${port}",
				executable = {
					command = vim.fn.stdpath("data") .. "/mason/bin/codelldb",
					args = { "--port", "${port}" },
				},
			}
			local cpp = {
				{
					name = "Launch (codelldb)",
					type = "codelldb",
					request = "launch",
					program = function()
						return vim.fn.input("Path to executable: ", vim.fn.getcwd() .. "/", "file")
					end,
					cwd = "${workspaceFolder}",
					stopOnEntry = false,
				},
			}
			dap.configurations.cpp = cpp
			dap.configurations.c = cpp

			-- JS/TS/React requires Node to launch vscode-js-debug.
			if has_node then
				dap.adapters["pwa-node"] = {
					type = "server",
					host = "localhost",
					port = "${port}",
					executable = {
						command = "node",
						args = {
							vim.fn.stdpath("data") .. "/mason/packages/js-debug-adapter/js-debug/src/dapDebugServer.js",
							"${port}",
						},
					},
				}
				for _, lang in ipairs({ "javascript", "typescript", "javascriptreact", "typescriptreact" }) do
					dap.configurations[lang] = {
						{
							type = "pwa-node",
							request = "launch",
							name = "Launch file",
							program = "${file}",
							cwd = "${workspaceFolder}",
							sourceMaps = true,
						},
						{
							type = "pwa-node",
							request = "attach",
							name = "Attach to process",
							processId = require("dap.utils").pick_process,
							cwd = "${workspaceFolder}",
							sourceMaps = true,
						},
					}
				end
			end
			-- Java debug configs are registered by nvim-jdtls (see ftplugin/java.lua).
		end,
	},
	{
		"mfussenegger/nvim-dap-python",
		ft = "python",
		dependencies = { "mfussenegger/nvim-dap" },
		keys = {
			{ "<leader>dpt", function() require("dap-python").test_method() end, desc = "Debug test method", ft = "python" },
			{ "<leader>dpc", function() require("dap-python").test_class() end,  desc = "Debug test class",  ft = "python" },
		},
		config = function()
			-- Use mason's debugpy venv so we never pollute project venvs.
			local debugpy = vim.fn.stdpath("data") .. "/mason/packages/debugpy/venv/bin/python"
			require("dap-python").setup(debugpy)
		end,
	},
}
