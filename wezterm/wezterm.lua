local Config = require("config")

require("events.update_status").setup()
require("events.format_tab_title").setup()
require("events.format_window_title").setup()
require("events.toggle_colorscheme").setup()

return Config:init()
	:append(require("config.appearance"))
	:append(require("config.bindings"))
	:append(require("config.fonts"))
	:append(require("config.general"))
	:append(require("config.launch")).options
