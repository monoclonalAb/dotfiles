local wezterm = require "wezterm"
local nf = wezterm.nerdfonts

local Config = {}

local ICON_SEPARATOR = nf.oct_dash
local ICON_DATE = nf.fa_calendar

local discharging_icons = {
    nf.md_battery_10,
    nf.md_battery_20,
    nf.md_battery_30,
    nf.md_battery_40,
    nf.md_battery_50,
    nf.md_battery_60,
    nf.md_battery_70,
    nf.md_battery_80,
    nf.md_battery_90,
    nf.md_battery,
}

local charging_icons = {
    nf.md_battery_charging_10,
    nf.md_battery_charging_20,
    nf.md_battery_charging_30,
    nf.md_battery_charging_40,
    nf.md_battery_charging_50,
    nf.md_battery_charging_60,
    nf.md_battery_charging_70,
    nf.md_battery_charging_80,
    nf.md_battery_charging_90,
    nf.md_battery_charging,
}

local function battery_info()
    -- ref: https://wezfurlong.org/wezterm/config/lua/wezterm/battery_info.html

    local charge = ''
    local icon = ''

    for _, battery in ipairs(wezterm.battery_info()) do
        local idx = math.ceil(battery.state_of_charge * 10)
        charge = string.format('%.0f%%', battery.state_of_charge * 100)

        if battery.state == 'Charging' then
            icon = charging_icons[idx]
        else
            icon = discharging_icons[idx]
        end
    end

    return charge, icon .. ' '
end

Config.setup = function()
    wezterm.on('update-right-status', function(window, pane)
        local date = wezterm.strftime '%Y-%m-%d %H:%M:%S'
        local battery_text, battery_icon = battery_info()

        -- Make it italic and underlined
        window:set_right_status(wezterm.format {
            { Text = ICON_DATE .. "  " .. date .. " " .. ICON_SEPARATOR .. "  " .. battery_icon .. battery_text },
        })
    end)
end

return Config
