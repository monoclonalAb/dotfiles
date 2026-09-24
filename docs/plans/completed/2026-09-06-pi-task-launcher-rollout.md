# Enable and verify Pi Tasks

**Status:** Complete
**Scope:** Deploy only the Herdr task-launcher package additions/keybinding; register the plugin, regenerate config through `theme`, and verify the native UI without submitting a task.

## Objective

Enable `C-a a t` on this Mac and verify the menu, model/thinking picker, and cancellation with real Herdr and deployed launcher code.

## Non-goals

- No production task submission, agent startup, model request, worktree creation, application restart, commit, or push. Source-suite Git fixtures remain temporary and isolated.
- No input to any existing agent pane or inspection of credential/session stores.

## Context and constraints

- User explicitly approved deployment and UI-only verification after source implementation.
- Existing uncommitted implementation/docs/tests and external checkpoint commit remain intact.
- Observed production server: Herdr 0.8.2/protocol 20, `~/.config/herdr/herdr.sock`; this agent has `HERDR_ENV=1`.
- The reviewed Stow preview proposes only the new task-launcher directory and leaves. Generated Herdr config is a real file; its base and Pi wrapper are managed symlinks.
- `theme status`: Latte/1.0, live Herdr, no tmux or Neovim consumers. `theme apply` is the canonical config generator and also refreshes the Alacritty overlay.
- Native UI input tests must run in a temporary, isolated Herdr instance with independent plugin/state/socket locations; no existing pane receives input. The launcher may use Pi's local model catalog via its normal SDK, but never creates a Pi session.

## Acceptance criteria

- [x] Affected-package preview revalidated and applied; deployed paths resolve to source.
- [x] Task plugin is linked/enabled; production config reload succeeds without restart.
- [x] Native Herdr recognizes the keybinding, opens menu/form/model/thinking UI, and cancels without creating a task or worktree.
- [x] Production remains reachable; source diff remains intact; verification gaps reported.

## Approach

1. Retain a generated-config backup outside the repository, apply reviewed Herdr Stow links, link the plugin, and run `theme apply`.
2. Validate production plugin/config status and resolved symlinks.
3. Run real native Herdr in an isolated PTY/socket/config/state environment using the deployed launcher and live cached Pi catalog; inspect only test-owned UI/topology/state.
4. Clean up only the test instance and document results.

## Progress

- [x] Re-read source/deployment owners, live CLI/schema, runtime path isolation, and Stow preview.
- [x] Deployed and validated production registration/config.
- [x] Passed native UI-only checks and stopped only the isolated test instance. Documented native verification boundaries in the plugin README/runbook.

## Decisions

- **No live task:** approval covers popup/pickers/cancel, not task startup or billing.
- **Own native UI instance:** production deployment is verified in place; input testing uses isolation because Herdr's public socket API has no popup-key-input endpoint. Avoid sending global key input toward another agent pane.

## Verification

- `herdr status server`, `herdr plugin list`, `theme status`, `stow -n -v -t "$HOME" herdr` — passed preflight; not yet deployed.
- `stow -v -t "$HOME" herdr` — passed: deployed the reviewed task-launcher leaves only. Verified every deployed leaf resolves to its canonical source.
- `herdr plugin link "$HOME/.config/herdr/plugins/task-launcher" --enabled` — passed; production lists the task launcher alongside the unchanged next-agent and spaces-env plugins.
- `theme apply` — passed: Herdr config regenerated and server reloaded, Alacritty overlay refreshed; no running tmux/Neovim instances. No production application/server was restarted.
- `herdr config check`, `herdr plugin action list --plugin martinro.task-launcher`, `herdr status server` — passed after deployment.
- Python TOML comparison against `/tmp/pi-task-rollout.UenCiQ/config-before.toml` — passed: the production generated config differs only by the intended task-launcher keybinding.
- `PYTHONDONTWRITEBYTECODE=1 python3 /tmp/pi-task-rollout.UenCiQ/native-ui-check.py` — passed against the installed native Herdr binary, deployed plugin and actual cached Pi model catalog: leader+a menu, t form, Model select, compatible Thinking selector, Escape back/cancel, reopen/menu cancellation. No agent process, worktree change, request file or preference write. The isolated test socket no longer accepts connections.
- Initial native-verifier attempts failed on test-harness setup (PTY output backpressure, monolithic registry not restored, and initial shell cwd=HOME); the verifier was corrected and rerun. No launcher runtime source change was required. These constraints are now in the owning verification docs.
- `node --test "$HOME"/.config/herdr/plugins/task-launcher/*.test.mjs` — passed: 31 tests through deployed paths, with temporary fixtures/fake consumers where appropriate.
- `env -i HOME="$HOME" PATH=/usr/bin:/bin /bin/sh "$HOME/.config/herdr/plugins/task-launcher/launch.sh" --check` — passed: installed npm Pi 0.85.1 and required SDK/TUI APIs.
- Final `stow -n -v -t "$HOME" herdr` — passed with no proposed actions. Production launcher state contained zero request/preference files.
- `git diff --check` — passed; prior implementation/docs/tests remain intact.
- Real Pi task startup, provider/billing acceptance, and production popup keystroke injection — not run: outside approved UI-only scope and/or intentionally avoided to protect existing agent panes.

## Risks and recovery

- Keep runtime outputs outside the repository and isolated from production plugin ledgers.
- On deployment failure, retain the backup and report before further changes; do not restart the running server.
- Test teardown may stop only the isolated instance created for verification.

## Outcome

Pi Tasks is enabled on this Mac: `C-a a t` is ready. Production registration and generated config are verified; native picker/cancel behavior passed in an isolated real Herdr instance. No task or model request was submitted. The generated-config backup and temporary native-test script/output remain outside the repository under `/tmp/pi-task-rollout.UenCiQ/` for audit/recovery; the test process is stopped.
