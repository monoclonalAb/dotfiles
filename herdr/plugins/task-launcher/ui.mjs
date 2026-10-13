import { chooseThinking, validateImages } from "./task.mjs";

const PASTE_START = "\x1b[200~";
const EMPTY_PASTE = `${PASTE_START}\x1b[201~`;
const IMAGE_MARKER = /\[img #(\d+)\]/g;
const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

// Colours from the shared Catppuccin palette (Herdr's generated [theme.custom]),
// mapped the way the theme-sync Pi extension maps them: mauve accent, subtext
// for secondary text, overlay for chrome, and Pi's thinking-level colours for
// the editor border. Without a palette, fall back to the terminal's ANSI colours.
export function themeStyles(palette = {}) {
  const rgb = (value) => /^#[0-9a-f]{6}$/i.test(value ?? "")
    ? [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16)).join(";") : undefined;
  const fg = (value, fallback) => {
    const color = rgb(value);
    return color ? (text) => `\x1b[38;2;${color}m${text}\x1b[39m` : fallback;
  };
  const ansi = (open, close) => (text) => `\x1b[${open}m${text}\x1b[${close}m`;
  const faded = ansi(2, 22);
  const highlight = rgb(palette.active_row_bg ?? palette.surface0);
  return {
    accent: fg(palette.accent ?? palette.mauve, ansi(35, 39)),
    text: fg(palette.text, (text) => text),
    muted: fg(palette.subtext0, faded),
    dim: fg(palette.overlay1, faded),
    error: fg(palette.red, ansi(31, 39)),
    warning: fg(palette.yellow, ansi(33, 39)),
    success: fg(palette.green, ansi(32, 39)),
    bold: ansi(1, 22),
    selected: highlight ? (text) => `\x1b[48;2;${highlight}m${text}\x1b[49m` : ansi(7, 27),
    thinking: {
      off: fg(palette.surface1, faded), minimal: fg(palette.overlay1, faded), low: fg(palette.blue, ansi(34, 39)),
      medium: fg(palette.teal, ansi(36, 39)), high: fg(palette.mauve, ansi(35, 39)),
      xhigh: fg(palette.peach, ansi(33, 39)), max: fg(palette.red, ansi(31, 39)),
    },
  };
}

// Pi binding names as compact glyphs: shift+tab → ⇧⇥, ctrl+l → ^L, enter → ⏎.
const GLYPHS = { enter: "⏎", return: "⏎", escape: "esc", tab: "⇥", up: "↑", down: "↓", left: "←", right: "→", backspace: "⌫" };
export function prettyKey(key) {
  const parts = key.split("+");
  const last = parts.pop();
  const glyph = GLYPHS[last] ?? last;
  if (parts.length === 1 && parts[0] === "ctrl" && last.length === 1) return `^${last.toUpperCase()}`;
  const modifiers = { shift: "⇧", alt: "⌥", option: "⌥", ctrl: "^", super: "⌘", cmd: "⌘", meta: "⌘" };
  return parts.map((part) => modifiers[part] ?? `${part}+`).join("") + glyph;
}

// Built from Pi's existing Editor/Input/SelectList, but not an agent session.
// Dependency injection lets the same form run against installed TUI APIs in tests.
export function createTaskForm(lib, {
  renderer, repo, models, selection, launch, onClose, keybindings, CustomEditor,
  cycleModels = models.map((model) => ({ model })), defaults = {}, now = Date.now,
  readClipboard = async () => undefined, copyText = async () => {},
  draft, saveDraft = () => {}, history = [], autocomplete, namer = () => undefined, palette,
}) {
  const { Input, SelectList, matchesKey, truncateToWidth, wrapTextWithAnsi, visibleWidth } = lib;
  // Editor, Input and SelectList consult this same manager internally. Loading
  // Pi's table and user overrides here prevents two competing shortcut systems.
  lib.setKeybindings(keybindings);
  const keyHint = (action) => prettyKey(keybindings.getKeys(action)[0] ?? "unbound");
  const style = themeStyles(palette);
  const listTheme = { selectedPrefix: style.accent, selectedText: style.accent, description: style.dim, scrollInfo: style.dim, noMatch: style.dim };
  const safe = (value) => String(value).replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
  // Model IDs without their organisation prefix, unless that would be ambiguous.
  const shortModel = (model) => {
    const tail = model.id.split("/").at(-1);
    return models.some((other) => other !== model && other.id.split("/").at(-1) === tail) ? `${model.provider}/${tail}` : tail;
  };

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
      if (selection.notice) this.tone = "warning";
      this.frame = 0;
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
        terminal: { get rows() { return Math.ceil(Math.max(0, renderer.terminal.rows - 8) / 0.3); } },
        requestRender: () => renderer.requestRender(),
      }, { borderColor: (text) => this.thinkingStyle(text), selectList: listTheme }, keybindings, { paddingX: 1 });
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
      this.inputs = { branch: new Input({ prompt: "" }), base: new Input({ prompt: "" }), path: new Input({ prompt: "" }) };
      this.search = new Input({ prompt: style.accent("› ") });
      if (draft?.text) this.restoreDraft(draft);
    }

    get message() { return this._message; }
    set message(text) { this._message = text; this.tone = "info"; }
    say(text, tone) { this.message = text; this.tone = tone; }
    // Like Pi, the editor border shows the thinking level.
    thinkingStyle(text) { return (style.thinking[this.thinking] ?? style.dim)(text); }

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
    chips() { return ["model", "thinking", "startFrom", ...(repo.dirty ? ["changes"] : []), "advanced"]; }
    fields() { return ["prompt", ...this.chips(), ...(this.advanced ? ["branch", "base", "path"] : [])]; }
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
        if (!this.closed) this.say(`Clipboard paste failed: ${error.message}`, "error");
      } finally {
        clearTimeout(timer);
        this.clipboardPending = false;
        if (!this.closed) {
          renderer.requestRender();
          // A failed paste must not turn an impatient, already-queued Enter
          // into a task that silently omits its image. Keep typing.
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
        (error) => { if (!this.closed) this.say(`Draft cleared; clipboard copy failed: ${error.message}`, "warning"); },
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
      if (launch.spec) { this.say("Git details are locked for this attempt.", "warning"); return; }
      if (!repo.upstream) { this.say("No origin default branch to start from; this repository starts from the current commit.", "warning"); return; }
      this.startFrom = this.startFrom === "latest" ? "current" : "latest";
      if (this.startFrom === "latest" && this.carry) {
        this.carry = false;
        this.message = "Uncommitted changes stay in the source when starting from the latest default branch.";
      } else this.message = "";
    }

    toggleCarry() {
      if (launch.carried) { this.message = "Your changes are already in the task checkout."; return; }
      if (!this.carry && launch.spec && launch.spec.base !== repo.head) {
        this.say("Changes can only be copied onto the current commit; this attempt is locked to another base.", "warning");
        return;
      }
      this.carry = !this.carry;
      if (this.carry && this.startFrom === "latest") {
        this.startFrom = "current";
        this.message = "Bringing changes needs the current commit, so the task starts from it again.";
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
      const spinner = setInterval(() => { this.frame++; renderer.requestRender(); }, 80);
      spinner.unref?.();
      renderer.requestRender();
      try {
        const { prompt, images } = this.draft();
        const result = await launch.start({
          prompt, images, model: this.model, thinking: this.thinking, startFrom: this.startFrom, carry: this.carry,
          branch: this.inputs.branch.getValue(), base: this.inputs.base.getValue(), path: this.inputs.path.getValue(),
        });
        if (result.warning) {
          this.phase = "done";
          this.say(result.warning, "warning");
        } else this.close();
      } catch (error) {
        this.say([error.message, launch.recoveryMessage()].filter(Boolean).join(" "), "error");
      } finally {
        clearInterval(spinner);
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
      } else if (is("tui.select.up")) this.changeField(this.inputs[this.field] ? -1 : -this.fields().indexOf(this.field));
      else if (is("tui.select.down")) this.changeField(1);
      else if (this.inputs[this.field]) { if (!launch.spec) this.inputs[this.field].handleInput(data); }
      else if (matchesKey(data, "left") || matchesKey(data, "right")) {
        const chips = this.chips();
        const index = chips.indexOf(this.field) + (matchesKey(data, "left") ? -1 : 1);
        if (index >= 0 && index < chips.length) this.field = chips[index];
      }
      this.syncFocus();
      renderer.requestRender();
    }

    // Body (header, editor, options) scrolls; the status line and key hints stay
    // pinned to the bottom of the popup.
    render(width) {
      this.width = width;
      const rows = Math.max(1, renderer.terminal.rows);
      const fit = (line) => truncateToWidth(line, Math.max(1, width));
      if (width < 28 || rows < 12) {
        return [fit("Pi Tasks — enlarge this popup"), fit(style.dim(`${keyHint("app.interrupt")} cancels; your draft is kept.`))].slice(0, rows);
      }
      const { body, focus } = this.body(width);
      const bottom = this.bottom(width).map(fit);
      const space = rows - bottom.length;
      if (body.length <= space) return [...body.map(fit), ...Array(space - body.length).fill(""), ...bottom];
      // Keep the header; centre the focused line in what remains, with a marker line.
      const available = space - 2;
      const rest = body.slice(1);
      const offset = Math.max(0, Math.min(rest.length - available, focus - 1 - Math.floor(available / 2)));
      const more = `${offset ? "↑ " : ""}${offset + available < rest.length ? "↓ " : ""}more`;
      return [fit(body[0]), ...rest.slice(offset, offset + available).map(fit), fit(style.dim(more)), ...bottom];
    }

    header(width, right = "") {
      const left = ` ${style.accent("Pi task")}${style.dim(` · ${safe(repo.name)}`)}`;
      const gap = width - visibleWidth(left) - visibleWidth(right) - 1;
      return gap >= 2 ? left + " ".repeat(gap) + right : left;
    }

    body(width) {
      if (this.phase === "select") {
        const kind = this.selectorKind === "model" ? "model" : "effort";
        return { focus: 2, body: [this.header(width, style.dim(`choose ${kind}`)), "",
          ` ${this.search.render(width - 2)[0] ?? ""}`, "", ...this.list.render(width - 1).map((line) => ` ${line}`)] };
      }
      if (this.phase === "done") {
        const notes = wrapTextWithAnsi(safe(this.message ?? ""), Math.max(1, width - 3)).map((line) => `   ${style.warning(line)}`);
        return { focus: 2, body: [this.header(width), "", ` ${style.success("✓")} ${style.text("Pi is open")}`, ...notes] };
      }
      const naming = !launch.spec && !this.inputs.branch.getValue().trim() ? namer(this.model) : undefined;
      const right = launch.spec || this.inputs.branch.getValue().trim() ? ""
        : naming ? style.dim(`named by ${safe(shortModel(naming))}`) : style.warning("placeholder name");
      const editor = this.editor.render(width);
      if (!this.editor.getText() && editor.length >= 3) {
        // Placeholder instead of a label, drawn where the cursor sits.
        const hint = "Describe the task";
        const cursor = this.editor.focused ? `${lib.CURSOR_MARKER}${lib.renderFakeCursor(hint[0])}` : style.dim(hint[0]);
        editor[1] = ` ${cursor}${style.dim(hint.slice(1))}`;
      }
      const lines = [this.header(width, right), "", ...editor, this.chipLine()];
      let focus = this.field === "prompt" ? 2 + Math.max(0, editor.findIndex((line) => line.includes(lib.CURSOR_MARKER))) : lines.length - 1;
      if (this.advanced) {
        for (const [field, label, empty] of [["branch", "branch", "auto"], ["base", "base", "start point"], ["path", "path", "Herdr default"]]) {
          const value = launch.spec?.[field] ?? this.inputs[field].getValue();
          const name = this.field === field ? style.accent(label.padEnd(6)) : style.dim(label.padEnd(6));
          const shown = this.field === field && !launch.spec ? this.inputs[field].render(Math.max(1, width - 12))[0]
            : value ? style.muted(safe(value)) : style.dim(empty);
          if (this.field === field) focus = lines.length;
          lines.push(`   ${name}  ${shown}`);
        }
      }
      return { body: lines, focus };
    }

    chipLine() {
      const from = this.startFrom === "latest" ? `from ${safe(repo.upstream.remote)}/${safe(repo.upstream.branch)}`
        : `from ${safe(repo.branch ?? repo.head.slice(0, 7))}`;
      const labels = {
        model: this.model ? safe(shortModel(this.model)) : "choose model",
        thinking: this.thinking ?? "off",
        startFrom: from,
        changes: this.carry || launch.carried ? "bring changes" : "leave changes",
        advanced: this.advanced ? "less" : "more",
      };
      const chips = this.chips().map((field) => {
        const label = ` ${labels[field]} `;
        if (this.field === field) return style.selected(field === "thinking" ? this.thinkingStyle(label) : style.accent(label));
        if (field === "model" && !this.model) return style.warning(label);
        return field === "thinking" ? this.thinkingStyle(label) : style.muted(label);
      });
      return chips.join(style.dim("·"));
    }

    // What Enter (and other keys) do right now, then any status message.
    hints() {
      const action = launch.created ? "retry" : "start";
      const chip = {
        model: [["⏎", "choose model"]], thinking: [["⏎", "choose effort"], [keyHint("app.thinking.cycle"), "cycle"]],
        startFrom: !repo.upstream ? [["", "no origin default branch"]] : launch.spec ? [["", "locked for this attempt"]]
          : this.startFrom === "latest" ? [["⏎", `use current commit ${repo.head.slice(0, 7)}`]]
          : [["⏎", `use latest ${safe(repo.upstream.remote)}/${safe(repo.upstream.branch)} (fetched)`]],
        changes: this.carry ? [["⏎", `leave uncommitted changes in ${safe(repo.name)}`]] : [["⏎", "bring uncommitted changes into the task"]],
        advanced: [["⏎", this.advanced ? "hide branch, base and path" : "branch, base and path"]],
      }[this.field];
      if (chip) return [...chip, ["←→", "move"], ["↑", "back"], [keyHint("app.interrupt"), "close"]];
      if (this.inputs[this.field]) return [[keyHint("tui.input.submit"), action], ["↑↓", "fields"], [keyHint("app.interrupt"), "close"]];
      return [[keyHint("tui.input.submit"), action], [keyHint("tui.input.tab"), "options"], [keyHint("app.model.select"), "model"],
        [keyHint("app.thinking.cycle"), "effort"], [keyHint("app.interrupt"), "close"], ["@", "files"], ["/", "prompts"],
        [keyHint("app.clipboard.pasteImage"), "image"]];
    }

    bottom(width) {
      const tones = { info: style.muted, warning: style.warning, error: style.error };
      const message = this.message
        ? wrapTextWithAnsi(safe(this.message), Math.max(1, width - 2)).slice(0, 3).map((line) => ` ${(tones[this.tone] ?? style.muted)(line)}`) : [];
      if (this.busy) return [` ${style.accent(SPINNER[this.frame % SPINNER.length])} ${style.muted(safe(this.message))}`];
      if (this.phase === "select") {
        return [this.keys(width, [["", "type to filter"], [keyHint("tui.select.confirm"), "choose"], [keyHint("tui.select.cancel"), "back"]])];
      }
      if (this.phase === "done") return [this.keys(width, [[keyHint("tui.input.submit"), "close"]])];
      return [...message, this.keys(width, this.hints())];
    }

    // As many hints as fit, in priority order, never a cut-off one.
    keys(width, pairs) {
      let line = "";
      for (const [key, label] of pairs) {
        const item = `${key ? `${style.text(key)} ` : ""}${style.dim(label)}`;
        const next = line ? `${line}  ${item}` : ` ${item}`;
        if (visibleWidth(next) > width) break;
        line = next;
      }
      return line;
    }
  }();
}
