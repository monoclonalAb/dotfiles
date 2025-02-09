local wezterm = require 'wezterm'

local Config = {}

Config.color_scheme = {
    "Catppuccin Latte",
    "Atelier Sulphurpool Light (base16)",
    "Atelier Estuary Light (base16)",
    "Atelier Lakeside Light (base16)",
    "Atelier Savanna Light (base16)",
}
Config.index = 1;

Config.setup = function()
    wezterm.on("toggle-colorscheme", function(window, _) -- the '_' can be replaced by 'pane'
        local overrides = window:get_config_overrides() or {}

        Config.index = Config.index % #Config.color_scheme + 1
        overrides.color_scheme = Config.color_scheme[Config.index]

        local current_scheme = wezterm.color.get_builtin_schemes()[overrides.color_scheme]

        overrides.colors = {
            tab_bar = {
                background = current_scheme.background
            }
        }

        window:set_config_overrides(overrides)
    end)
end

return Config
