local wezterm = require 'wezterm'

local Config = {}

-- strips the directory information and optional suffixes from file names
Config.findbasename = function(path)
    local trimmed_path = path:gsub("[/\\]*$", "")
    local index = trimmed_path:find "[^/\\]*$"
    return index and trimmed_path:sub(index) or trimmed_path
end

Config.setup = function()
    wezterm.on('format-window-title', function(tab, pane, tabs, _, _)
        local zoomed = ''
        if tab.active_pane.is_zoomed then
            zoomed = '[Z] '
        end

        local index = ''
        if #tabs > 1 then
            index = string.format('[%d/%d] ', tab.tab_index + 1, #tabs)
        end

        ---tab title
        local title = Config.findbasename(pane.title):gsub("%.exe%s?$", "")

        local proc = pane.foreground_process_name
        if proc:find "nvim" then
            proc = proc:sub(proc:find "nvim")
        end
        if proc == "nvim" or title == "cmd" then
            local cwd, _ = Config.findbasename(pane.current_working_dir.file_path)
            title = ("Neovim (dir: %s)"):format(cwd)
        end

        return zoomed .. index .. title
    end)
end

return Config
