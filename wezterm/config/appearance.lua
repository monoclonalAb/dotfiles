local wezterm = require 'wezterm'
local current_scheme = wezterm.color.get_builtin_schemes()["Catppuccin Latte"]

-- [
--     {
--         "backend": "Vulkan",
--         "device": 5686,
--         "device_type": "IntegratedGpu",
--         "driver": "AMD proprietary driver",
--         "driver_info": "24.9.1 (AMD proprietary shader compiler)",
--         "name": "AMD Radeon(TM) Graphics",
--         "vendor": 4098,
--     },
--     {
--         "backend": "Dx12",
--         "device": 5686,
--         "device_type": "IntegratedGpu",
--         "driver": "31.0.21921.1000",
--         "name": "AMD Radeon(TM) Graphics",
--         "vendor": 4098,
--     },
--     {
--         "backend": "Dx12",
--         "device": 140,
--         "device_type": "Cpu",
--         "driver": "10.0.22621.4249",
--         "name": "Microsoft Basic Render Driver",
--         "vendor": 5140,
--     },
--     {
--         "backend": "Gl",
--         "device": 0,
--         "device_type": "Other",
--         "driver_info": "4.6.0 Compatibility Profile Context 24.9.1.240813",
--         "name": "AMD Radeon(TM) Graphics",
--         "vendor": 0,
--     },
-- ]

return {
    -- graphics + frames
    max_fps = 120,
    -- front_end = "OpenGL",
    front_end = 'WebGpu',
    webgpu_power_preference = 'HighPerformance',
    win32_system_backdrop = 'Acrylic',

    -- cursor
    animation_fps = 120,
    cursor_blink_ease_in = 'EaseOut',
    cursor_blink_ease_out = 'EaseOut',
    default_cursor_style = 'BlinkingBlock',
    cursor_blink_rate = 650,

    -- color-scheme
    color_scheme = 'Catppuccin Latte',
    colors = {
        tab_bar = {
            background = current_scheme.background
        }
    },

    -- background

    -- scroll bar
    enable_scroll_bar = true,

    -- tab bar
    enable_tab_bar = true,
    hide_tab_bar_if_only_one_tab = false,
    tab_bar_at_bottom = true,
    use_fancy_tab_bar = false,
    tab_max_width = 25,
    show_tab_index_in_tab_bar = false,
    switch_to_last_active_tab_when_closing_tab = false,
    show_new_tab_button_in_tab_bar = false,
    show_tabs_in_tab_bar = true,
    tab_and_split_indices_are_zero_based = false,

    -- window
    window_decorations = "TITLE | RESIZE",
}
