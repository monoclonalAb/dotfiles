local wezterm = require 'wezterm'

local Config = {}
Config.__index = Config

-- to initialize the config
function Config:init()
    local config = setmetatable({ options = {} }, self)
    return config
end

-- to add to the config
function Config:append(new_options)
    for k, v in pairs(new_options) do
        if self.options[k] ~= nil then
            wezterm.log_warn(
                'Duplicate config option detected: ',
                { old = self.options[k], new = new_options[k] }
            )
            goto continue
        end
        self.options[k] = v
        ::continue::
    end
    return self
end

return Config
