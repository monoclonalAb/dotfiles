local wezterm = require("wezterm")

local font_family = "JetBrainsMono Nerd Font"
local font_size = 12

return {
	font = wezterm.font({
		family = font_family,
		weight = "Medium",
	}),
	font_size = font_size,
}
