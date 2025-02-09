-- Global variable to track the autocmd state (enabled/disabled)
Autocmd_Enabled = true

static_site_generator_augroup = vim.api.nvim_create_augroup("StaticWebsiteGenerator", { clear = true })

-- Function to create or remove the autocmd based on the `autocmd_enabled` variable
function Toggle_Autocmd()
	if Autocmd_Enabled then
		-- Create the autocmd to run on BufWritePost
		vim.api.nvim_create_autocmd("BufWritePost", {
			group = static_site_generator_augroup,
			callback = function()
				-- Run the terminal command
				os.execute('bash -c "cd /mnt/c/Users/ericz/projects/static_website && ./build.sh"')
			end,
		})
		print("Autocmd enabled")
	else
		-- Clear the group to remove the autocmd
		vim.api.nvim_clear_autocmds({ group = "StaticWebsiteGenerator" })
		print("Autocmd disabled")
	end
end

-- Define the keymap for toggling the autocmd
vim.keymap.set("n", "<leader>`", ":lua Autocmd_Enabled = not Autocmd_Enabled Toggle_Autocmd()<CR>", {})
