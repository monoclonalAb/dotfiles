local options = {
	default_prog = { "pwsh", "-NoLogo" },
	launch_menu = {
		{ label = "PowerShell Core", args = { "pwsh", "-NoLogo" } },
		{ label = "PowerShell Desktop", args = { "powershell" } },
		{ label = "Command Prompt", args = { "cmd" } },
		{ label = "Nushell", args = { "nu" } },
	},
}

return options
