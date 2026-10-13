import { chooseThinking, validateImages } from "./task.mjs";

const PASTE_START = "\x1b[200~";
const EMPTY_PASTE = `${PASTE_START}\x1b[201~`;
const IMAGE_MARKER = /\[img #(\d+)\]/g;

// Built from Pi's existing Editor/Input/SelectList, but not an agent session.
// Dependency injection lets the same form run against installed TUI APIs in tests.
export function createTaskForm(lib, {
  renderer, repo, models, selection, launch, onClose, keybindings, CustomEditor,
  cycleModels = models.map((model) => ({ model })), defaults = {}, now = Date.now,
  readClipboard = async () => undefined, copyText = async () => {},
  draft, saveDraft = () => {}, history = [], autocomplete, namer = () => undefined,
}) {
  const { Input, SelectList, matchesKey, truncateToWidth, wrapTextWithAnsi } = lib;
  // Editor, Input and SelectList consult this same manager internally. Loading
  // Pi's table and user overrides here prevents two competing shortcut systems.
  lib.setKeybindings(keybindings);
  const keyHint = (action) => keybindings.getKeys(action).join("/") || "unbound";
  const accent = (s) => `\x1b[36m${s}\x1b[39m`;
  const dim = (s) => `\x1b[2m${s}\x1b[22m`;
  const listTheme = { selectedPrefix: accent, selectedText: accent, description: dim, scrollInfo: dim, noMatch: dim };
  const safe = (value) => String(value).replace(/[\x00-\x1f\x7f-\x9f]/g, " ");

  return new class TaskForm {
    constructor() {
      this.phase = "form";
      this.field = "prompt";
      this.advanced = false;
      this.model = selection.model;
      this.thinking = selection.thinking;
      this.startFrom = selection.startFrom === "latest" && repo.upstream ? "latest" : "current";
      this.carry = false;
      this.message = selection.notice;
      this.busy = false;
      this.closed = false;
      this.clipboardPending = false;
      this.suppressSubmit = false;
      this.queuedInput = [];
      this.pendingEmptyPaste = "";
      this.images = new Map(); // Retain removed markers for native editor undo.
      this.nextImageId = 1;
      this._focused = false;
      // Bound prompt height to leave room for model/thinking/actions in a popup.
      this.editor = new CustomEditor({
        terminal: { get rows() { return Math.min(renderer.terminal.rows, 16); } },
        requestRender: () => renderer.requestRender(),
      }, { borderColor: accent, selectList: listTheme }, keybindings, { paddingX: 1 });
      // @ completes files in the source checkout; / completes Pi prompt templates.
      if (autocomplete) this.editor.setAutocompleteProvider(autocomplete);
      for (const entry of history) this.editor.addToHistory(entry);
      this.lastClearAt = -Infinity;
      this.actions = new Map([
        ["app.thinking.cycle", () => this.cycleThinking()],
        ["app.model.select", () => this.openSelector("model")],
        ["app.model.cycleForward", () => this.cycleModel(1)],
        ["app.model.cycleBackward", () => this.cycleModel(-1)],
        ["app.clear", () => this.clearDraft()],
      ]);
      for (const [action, handler] of this.actions) this.editor.onAction(action, handler);
      this.editor.onEscape = () => this.close();
      this.editor.onCtrlD = () => this.close();
      this.editor.onPasteImage = () => { void this.pasteClipboard(); };
      this.editor.onSubmit = (text) => {
        // Pi's editor owns newline/submit precedence, paste expansion and the
        // backslash+Enter fallback. Restore its submitted draft for failure/retry.
        this.editor.setText(text);
        void this.submit();
      };
      this.inputs = { branch: new Input(), base: new Input(), path: new Input() };
      this.search = new Input();
      if (draft?.text) this.restoreDraft(draft);
    }

    get focused() { return this._focused; }
    set focused(value) { this._focused = value; this.syncFocus(); }
    syncFocus() {
      this.editor.focused = this._focused && this.phase === "form" && this.field === "prompt" && !this.busy;
      for (const [name, input] of Object.entries(this.inputs)) {
        input.focused = this._focused && this.phase === "form" && this.field === name && !this.busy;
      }
      this.search.focused = this._focused && this.phase === "select";
    }
    invalidate() { this.editor.invalidate(); for (const input of Object.values(this.inputs)) input.invalidate(); }
    fields() {
      return ["prompt", "model", "thinking", "startFrom", ...(repo.dirty ? ["changes"] : []), "advanced",
        ...(this.advanced ? ["branch", "base", "path"] : []), "start"];
    }
    changeField(direction) {
      const fields = this.fields();
      this.field = fields[(fields.indexOf(this.field) + direction + fields.length) % fields.length];
    }

    restoreDraft({ text, images }) {
      this.editor.setText(text);
      for (const { marker, mimeType, data } of images) this.images.set(marker, { mimeType, data });
      const numbers = [...text.matchAll(IMAGE_MARKER)].map((match) => Number(match[1]));
      this.nextImageId = Math.max(0, ...numbers) + 1;
      this.message = [this.message, `Restored your unsent draft. ${keyHint("app.clear")} clears it.`].filter(Boolean).join(" ");
    }

    // Saved when the popup closes for any reason except a successful start.
    persistDraft() {
      if (launch.launched || this.closed) return;
      const { prompt, attached } = this.attachments();
      try {
        saveDraft(prompt.trim() || attached.length ? { text: this.editor.getExpandedText(), images: attached } : undefined);
      } catch { /* Best effort: the popup is already closing. */ }
    }

    close() {
      if (this.closed) return;
      this.persistDraft();
      this.closed = true;
      this.queuedInput.length = 0;
      this.images.clear();
      onClose();
    }

    // Images referenced by markers still in the text, in order of appearance.
    attachments() {
      const found = new Map();
      const prompt = this.editor.getExpandedText().replace(IMAGE_MARKER, (marker) => {
        const image = this.images.get(marker);
        if (!image) return marker; // Ordinary user text is not an attachment.
        if (!found.has(marker)) found.set(marker, image);
        return "";
      });
      return { prompt, attached: [...found].map(([marker, image]) => ({ marker, ...image })) };
    }

    draft() {
      const { prompt, attached } = this.attachments();
      return { prompt, images: attached.map(({ mimeType, data }) => ({ mimeType, data })) };
    }

    async pasteClipboard() {
      if (this.clipboardPending || this.closed) return;
      this.clipboardPending = true;
      this.message = "Reading clipboard…";
      renderer.requestRender();
      let timer;
      let failed = false;
      try {
        const content = await Promise.race([readClipboard(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Clipboard read timed out.")), 10_000);
        })]);
        if (this.closed) return;
        if (!content) throw new Error("No supported image or text found in the clipboard.");
        if (content.type === "image") {
          const image = { mimeType: content.mimeType, data: content.data };
          validateImages([...this.images.values(), image]);
          let marker;
          do { marker = `[img #${this.nextImageId++}]`; }
          while (this.editor.getExpandedText().includes(marker)); // Do not claim existing literal text.
          this.images.set(marker, image);
          this.editor.insertTextAtCursor(marker);
          this.message = "Image attached. Delete its marker to remove; undo restores it.";
        } else {
          // Insert literally, never replay clipboard text as terminal keys.
          this.editor.insertTextAtCursor(content.text);
          this.message = "";
        }
      } catch (error) {
        failed = true;
        if (!this.closed) this.message = `Clipboard paste failed: ${error.message}`;
      } finally {
        clearTimeout(timer);
        this.clipboardPending = false;
        if (!this.closed) {
          renderer.requestRender();
          // A failed paste must not turn an impatient Enter (or Space on the
          // Start row) into a task that silently omits its image. Keep typing.
          this.suppressSubmit = failed;
          try {
            for (const data of this.queuedInput.splice(0)) this.handleInput(data);
          } finally { this.suppressSubmit = false; }
        }
      }
    }

    handlePromptInput(data) {
      // Alacritty sends empty bracketed paste for an image-only Cmd+V. Do not
      // inspect the clipboard for nonempty terminal text pastes, even whitespace.
      if (this.pendingEmptyPaste || data.startsWith(PASTE_START)) {
        const pending = this.pendingEmptyPaste + data;
        this.pendingEmptyPaste = "";
        if (pending.startsWith(EMPTY_PASTE)) {
          this.editor.onPasteImage();
          const remaining = pending.slice(EMPTY_PASTE.length);
          if (remaining) this.handleInput(remaining);
          return;
        }
        if (EMPTY_PASTE.startsWith(pending)) { this.pendingEmptyPaste = pending; return; }
        data = pending;
      }
      this.editor.handleInput(data);
    }

    clearDraft() {
      const time = now();
      if (time - this.lastClearAt < 500) { this.close(); return; }
      const text = this.editor.getExpandedText();
      this.editor.setText("");
      this.field = "prompt";
      this.lastClearAt = time;
      const again = `Press ${keyHint("app.clear")} again within 500 ms to close.`;
      this.message = `Draft cleared. ${again}`;
      if (!text.trim()) return;
      // Like the Pi editor here: a cleared draft goes to the clipboard first.
      void Promise.resolve().then(() => copyText(text)).then(
        () => { if (!this.closed && this.lastClearAt === time) this.message = `Draft cleared and copied to the clipboard. ${again}`; },
        (error) => { if (!this.closed) this.message = `Draft cleared; clipboard copy failed: ${error.message}`; },
      ).finally(() => { if (!this.closed) renderer.requestRender(); });
    }

    cycleThinking() {
      if (!this.model) { this.message = "Choose a model first."; return; }
      const levels = this.model.levels;
      this.thinking = levels[(levels.indexOf(this.thinking) + 1) % levels.length];
      this.message = `Thinking: ${this.thinking}`;
    }

    selectModel(model, explicitThinking) {
      this.model = model;
      this.thinking = chooseThinking(model, explicitThinking ?? defaults.modelThinkingLevels?.[model.key] ?? defaults.thinking ?? this.thinking);
    }

    cycleModel(direction) {
      if (cycleModels.length <= 1) {
        this.message = cycleModels.length ? "Only one model in the cycle scope." : "No available models in the configured cycle scope.";
        return;
      }
      const index = Math.max(0, cycleModels.findIndex((choice) => choice.model.key === this.model?.key));
      const next = cycleModels[(index + direction + cycleModels.length) % cycleModels.length];
      this.selectModel(next.model, next.thinkingLevel);
      this.message = `Model: ${this.model.key}`;
    }

    toggleStartFrom() {
      if (launch.spec) { this.message = "Git details are locked for this attempt."; return; }
      if (!repo.upstream) { this.message = "No origin default branch to start from; this repository starts from the current commit."; return; }
      this.startFrom = this.startFrom === "latest" ? "current" : "latest";
      if (this.startFrom === "latest" && this.carry) {
        this.carry = false;
        this.message = "Uncommitted changes stay in the source when starting from the latest default branch.";
      } else this.message = "";
    }

    toggleCarry() {
      if (launch.carried) { this.message = "Your changes are already in the task checkout."; return; }
      if (!this.carry && launch.spec && launch.spec.base !== repo.head) {
        this.message = "Changes can only be copied onto the current commit; this attempt is locked to another base.";
        return;
      }
      this.carry = !this.carry;
      if (this.carry && this.startFrom === "latest") {
        this.startFrom = "current";
        this.message = "Copying changes needs the current commit, so Start from is now current.";
      } else this.message = "";
    }

    openSelector(kind) {
      if (kind === "thinking" && !this.model) {
        this.message = "Choose a model first.";
        return;
      }
      this.selectorKind = kind;
      this.search.setValue("");
      const items = kind === "model" ? models.map((model) => ({
        value: model.key, label: safe(model.key), description: safe(model.name ?? ""),
      })) : this.model.levels.map((level) => ({ value: level, label: level }));
      this.selectorItems = items;
      this.list = this.makeList(items);
      const current = kind === "model" ? this.model?.key : this.thinking;
      this.list.setSelectedIndex(Math.max(0, items.findIndex((item) => item.value === current)));
      this.list.onSelect = (item) => {
        if (kind === "model") {
          this.selectModel(models.find((model) => model.key === item.value));
        } else this.thinking = item.value;
        this.phase = "form";
        this.message = "";
      };
      this.list.onCancel = () => { this.phase = "form"; };
      this.phase = "select";
    }

    makeList(items) {
      return new SelectList(items, Math.max(1, Math.min(8, renderer.terminal.rows - 8)), listTheme);
    }

    filterSelector() {
      // SelectList's built-in filter is prefix-only; model IDs need substring
      // search across provider, ID and display name (e.g. "sonnet", not provider/…).
      const terms = this.search.getValue().toLowerCase().trim().split(/\s+/);
      const previous = this.list;
      this.list = this.makeList(this.selectorItems.filter((item) => {
        const text = `${item.label} ${item.description ?? ""}`.toLowerCase();
        return terms.every((term) => text.includes(term));
      }));
      this.list.onSelect = previous.onSelect;
      this.list.onCancel = previous.onCancel;
    }

    async submit() {
      if (this.busy || this.clipboardPending || this.suppressSubmit || this.closed || launch.launched) return;
      this.busy = true;
      const steps = [
        ...(!launch.spec && this.startFrom === "latest" && !this.inputs.base.getValue().trim() ? [`fetching ${repo.upstream.remote}/${repo.upstream.branch}`] : []),
        ...(!launch.spec && !this.inputs.branch.getValue().trim() ? ["naming the task"] : []),
        ...(this.carry && !launch.carried ? ["copying your changes"] : []),
      ];
      this.message = steps.length ? `${steps.join(", ").replace(/^./, (c) => c.toUpperCase())}, then starting Pi…` : "Starting Pi…";
      this.syncFocus();
      renderer.requestRender();
      try {
        const { prompt, images } = this.draft();
        const result = await launch.start({
          prompt, images, model: this.model, thinking: this.thinking, startFrom: this.startFrom, carry: this.carry,
          branch: this.inputs.branch.getValue(), base: this.inputs.base.getValue(), path: this.inputs.path.getValue(),
        });
        if (result.warning) {
          this.phase = "done";
          this.message = result.warning;
        } else this.close();
      } catch (error) {
        this.field = "start"; // Keep failure/recovery text in view on short popups.
        this.message = [error.message, launch.recoveryMessage()].filter(Boolean).join(" ");
      } finally {
        this.busy = false;
        this.syncFocus();
        renderer.requestRender();
      }
    }

    handleInput(data) {
      if (this.busy || this.closed) return; // Do not pretend to cancel an in-flight Git mutation.
      const is = (action) => keybindings.matches(data, action);
      if (this.clipboardPending) {
        if (is("app.interrupt")) this.close();
        else this.queuedInput.push(data); // Paste → typing/Enter order is preserved.
        return;
      }
      if ((this.width !== undefined && this.width < 28) || renderer.terminal.rows < 12) {
        if (is("app.interrupt")) this.close();
        else if (is("app.clear")) this.clearDraft();
        this.syncFocus();
        renderer.requestRender();
        return; // Never submit a form whose controls are hidden by a tiny viewport.
      }
      const completing = this.field === "prompt" && this.editor.isShowingAutocomplete?.();
      if (this.phase === "done") {
        if (is("app.interrupt") || is("app.clear") || is("tui.input.submit")) this.close();
      } else if (this.phase === "select") {
        if (["cancel", "confirm", "up", "down", "pageUp", "pageDown"].some((action) => is(`tui.select.${action}`))) {
          this.list.handleInput(data);
        } else {
          this.search.handleInput(data);
          this.filterSelector();
        }
      } else if (is("tui.input.tab") && !completing) this.changeField(1);
      else if (this.field === "prompt") {
        // CustomEditor preserves Pi's app-action/history precedence; Editor
        // handles Ctrl+J before Enter, including legacy LF and Kitty sequences.
        this.handlePromptInput(data);
      } else if (is("app.interrupt")) this.close();
      else if ([...this.actions].some(([action, handler]) => {
        if (!is(action)) return false;
        handler();
        return true;
      })) { /* action handled without moving field focus */ }
      else if (is("tui.input.newLine") || data === "\n") {
        // Non-prompt fields are single-line: do not reinterpret LF as Start.
      } else if (is("tui.input.submit") || (!this.inputs[this.field] && matchesKey(data, "space"))) {
        if (this.field === "model" || this.field === "thinking") this.openSelector(this.field);
        else if (this.field === "startFrom") this.toggleStartFrom();
        else if (this.field === "changes") this.toggleCarry();
        else if (this.field === "advanced") this.advanced = !this.advanced;
        else void this.submit();
      } else if (this.inputs[this.field] && !launch.spec) this.inputs[this.field].handleInput(data);
      else if (is("tui.select.up")) this.changeField(-1);
      else if (is("tui.select.down")) this.changeField(1);
      this.syncFocus();
      renderer.requestRender();
    }

    render(width) {
      this.width = width;
      const lines = this.renderContent(width);
      const height = Math.max(1, renderer.terminal.rows);
      if (lines.length <= height) return lines;
      if (height < 3) return lines.slice(0, height);
      const body = lines.slice(1);
      const focused = body.findIndex((line) => line.includes(lib.CURSOR_MARKER) || line.includes("› "));
      const available = height - 2;
      const offset = Math.max(0, Math.min(body.length - available, focused - Math.floor(available / 2)));
      return [lines[0], ...body.slice(offset, offset + available),
        truncateToWidth(dim(`${offset ? "↑ " : ""}${offset + available < body.length ? "↓ " : ""}More fields · ${keyHint("tui.input.tab")} to navigate`), Math.max(1, width))];
    }

    renderContent(width) {
      const fit = (line) => truncateToWidth(line, Math.max(1, width));
      const title = (name) => accent(name) + dim(`    ${safe(repo.name)}`);
      if (width < 28 || renderer.terminal.rows < 12) {
        return [fit("Pi Tasks — enlarge this popup"), fit(`${keyHint("app.interrupt")} cancels; your draft is kept.`)];
      }
      if (this.phase === "select") {
        return [fit(title(this.selectorKind === "model" ? "MODEL" : "THINKING")), "",
          ...this.search.render(width).map(fit), "", ...this.list.render(width).map(fit), "",
          fit(dim(`Type to filter · ${keyHint("tui.select.confirm")} select · ${keyHint("tui.select.cancel")} back`))];
      }
      if (this.phase === "done") {
        return [fit(title("TASK OPENED")), "", ...wrapTextWithAnsi(safe(this.message), width).map(fit), "", fit(`${keyHint("tui.input.submit")} / ${keyHint("app.interrupt")} close`)];
      }
      const row = (field, label, value) => (this.field === field ? accent("› ") : "  ") + label.padEnd(10) + "  " + value;
      const upstream = repo.upstream ? `${repo.upstream.remote}/${repo.upstream.branch}` : "";
      const startValue = this.startFrom === "latest"
        ? `[ latest ${safe(upstream)} (fetched on start) ⇄ ]`
        : `[ current: ${safe(repo.branch ?? "detached")} @ ${repo.head.slice(0, 7)}${upstream ? " ⇄" : ""} ]`;
      const lines = [fit(title("NEW TASK")), "", fit("What do you want to do?"),
        ...this.editor.render(width).map(fit), "",
        fit(row("model", "Model", `[ ${safe(this.model?.key ?? "Choose model")} ▾ ]`)),
        fit(row("thinking", "Thinking", `[ ${safe(this.thinking ?? "off")} ▾ ]`)),
        fit(row("startFrom", "Start from", launch.spec ? `${startValue} ${dim("locked")}` : startValue))];
      if (repo.dirty) {
        lines.push(fit(row("changes", "Changes", this.carry || launch.carried
          ? "[ copy uncommitted changes into the task ⇄ ]" : `[ leave uncommitted changes in ${safe(repo.name)} ⇄ ]`)));
      }
      lines.push(fit(row("advanced", "Advanced", this.advanced ? "▾" : "▸")));
      if (this.advanced) {
        for (const [field, label, empty] of [["branch", "Branch", "Automatic task name"], ["base", "Base", "Use Start from"],
          ["path", "Path", "Herdr worktree directory"]]) {
          const fixed = launch.spec?.[field];
          const value = fixed ?? this.inputs[field].getValue();
          if (this.field === field && !launch.spec) {
            lines.push(fit(row(field, label, "")), ...this.inputs[field].render(width).map(fit));
          } else {
            lines.push(fit(row(field, label, safe(value || empty))));
          }
        }
      }
      lines.push("", fit(row("start", this.busy ? "Starting…" : launch.created ? "[ Retry Pi startup ]" : "[ Start task ]", "")));
      if (!launch.spec && !this.inputs.branch.getValue().trim()) {
        const naming = namer(this.model);
        lines.push(fit(dim(naming ? `Auto-name: one short request to ${safe(naming.key)}` : "Auto-name: no usable naming model; a placeholder name is used")));
      }
      if (this.busy) lines.push(fit(dim("Please wait; checkout creation cannot be cancelled safely.")));
      else lines.push(
        fit(dim(`${keyHint("tui.input.newLine")} newline · ${keyHint("app.clipboard.pasteImage")}/Cmd+V image · ${keyHint("app.thinking.cycle")} effort`)),
        fit(dim(`@ file · / prompt template · ↑ previous task · ${keyHint("app.model.select")} model`)),
        fit(dim(`${keyHint("tui.input.tab")} fields · ${keyHint("tui.input.submit")} start · ${keyHint("app.interrupt")} close (draft kept)`)),
      );
      if (launch.spec) lines.push(fit(dim(`Git details locked for this attempt. ${keyHint("app.interrupt")}/reopen to change them.`)));
      if (this.message) lines.push(...wrapTextWithAnsi(safe(this.message), width).slice(0, 5).map(fit));
      return lines;
    }
  }();
}
