local wezterm = require("wezterm")

local Config = {}

Config.cells = {}

Config.set_process_name = function(s)
	local a = string.gsub(s, "(.*[/\\])(.*)", "%2")
	return a:gsub("%.exe$", "")
end

Config.find_base_name = function(path)
	local trimmed_path = path:gsub("[/\\]*$", "")
	local index = trimmed_path:find("[^/\\]*$")
	return index and trimmed_path:sub(index) or trimmed_path
end

Config.check_if_admin = function(p)
	if p:match("^Administrator: ") then
		return true
	end
	return false
end

Config.get_current_working_dir = function(tab)
	local current_dir = tab.active_pane.current_working_dir
	local HOME_DIR = string.format("file://%s", os.getenv("HOME"))

	return current_dir == HOME_DIR and "." or string.gsub(current_dir, "(.*[/\\])(.*)", "%2")
end

Config.languages = {
	["lua-language-server"] = "lua",
}

Config.set_title = function(process_name, base_title, max_width)
	local title
	local inset = 2

	if Config.languages[process_name] then
		process_name = Config.languages[process_name]
	end

	if process_name:len() > 0 then
		title = " " .. process_name .. " ~ " .. base_title
	else
		title = " " .. base_title
	end

	if title:len() > max_width - inset then
		local diff = title:len() - max_width + inset
		title = wezterm.truncate_right(title, title:len() - diff)
	else
		local padding = max_width - title:len() - inset
		title = string.rep(" ", padding // 2) .. title .. string.rep(" ", padding // 2)
	end

	return title
end

Config.push = function(bg, fg, attribute, text)
	table.insert(Config.cells, { Background = { Color = bg } })
	table.insert(Config.cells, { Foreground = { Color = fg } })
	table.insert(Config.cells, { Attribute = attribute })
	table.insert(Config.cells, { Text = text })
end

local current_scheme = wezterm.color.get_builtin_schemes()

Config.setup = function()
	wezterm.on("format-tab-title", function(tab, tabs, panes, config, hover, max_width)
		Config.cells = {}

		local bg
		local fg

		local process_name = Config.set_process_name(tab.active_pane.foreground_process_name)

		local directory
		if tab.active_pane.current_working_dir then
			directory = Config.find_base_name(tab.active_pane.current_working_dir.file_path)
		else
			directory = tab.active_pane.title
		end

		local title = Config.set_title(process_name, directory, max_width)

		fg = current_scheme[config.color_scheme].background
		if tab.is_active then
			bg = current_scheme[config.color_scheme].ansi[5]
		elseif hover then
			bg = current_scheme[config.color_scheme].ansi[7]
		else
			bg = current_scheme[config.color_scheme].brights[1]
		end

		-- Title
		Config.push(bg, fg, { Intensity = "Bold" }, title)

		-- Right padding
		Config.push(bg, fg, { Intensity = "Bold" }, " ")

		-- Right padding after semi-circle
		Config.push(fg, fg, { Intensity = "Bold" }, " ")

		return Config.cells
	end)
end

return Config

-- black = current_scheme.ansi[1],
-- red = current_scheme.ansi[2],
-- green = current_scheme.ansi[3],
-- yellow = current_scheme.ansi[4],
-- blue = current_scheme.ansi[5],
-- magenta = current_scheme.ansi[6],
-- cyan = current_scheme.ansi[7],
-- white = current_scheme.ansi[8],
-- black_bright = current_scheme.brights[1],
-- red_bright = current_scheme.brights[2],
-- green_bright = current_scheme.brights[3],
-- yellow_bright = current_scheme.brights[4],
-- blue_bright = current_scheme.brights[5],
-- magenta_bright = current_scheme.brights[6],
-- cyan_bright = current_scheme.brights[7],
-- white_bright = current_scheme.brights[8],
