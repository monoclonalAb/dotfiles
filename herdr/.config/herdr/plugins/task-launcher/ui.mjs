import { chooseThinking, textLabel } from "./task.mjs";

// Built from Pi's existing Editor/Input/SelectList, but not an agent session.
// Dependency injection lets the same form run against installed TUI APIs in tests.
export function createTaskForm(lib, { renderer, repo, models, selection, launch, onClose, menu = true }) {
  const { Editor, Input, SelectList, matchesKey, truncateToWidth, wrapTextWithAnsi } = lib;
  const accent = (s) => `\x1b[36m${s}\x1b[39m`;
  const dim = (s) => `\x1b[2m${s}\x1b[22m`;
  const listTheme = { selectedPrefix: accent, selectedText: accent, description: dim, scrollInfo: dim, noMatch: dim };
  const safe = (value) => String(value).replace(/[\x00-\x1f\x7f-\x9f]/g, " ");

  return new class TaskForm {
    constructor() {
      this.phase = menu ? "menu" : "form";
      this.field = "prompt";
      this.advanced = false;
      this.model = selection.model;
      this.thinking = selection.thinking;
      this.message = selection.notice;
      this.busy = false;
      this._focused = false;
      // Bound prompt height to leave room for model/thinking/actions in a popup.
      this.editor = new Editor({
        terminal: { get rows() { return Math.min(renderer.terminal.rows, 16); } },
        requestRender: () => renderer.requestRender(),
      }, { borderColor: accent, selectList: listTheme }, { paddingX: 1 });
      this.inputs = { branch: new Input(), base: new Input(), path: new Input() };
      this.inputs.base.setValue(repo.head);
      this.search = new Input();
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
    fields() { return ["prompt", "model", "thinking", "advanced", ...(this.advanced ? ["branch", "base", "path"] : []), "start"]; }
    changeField(direction) {
      const fields = this.fields();
      this.field = fields[(fields.indexOf(this.field) + direction + fields.length) % fields.length];
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
      this.list = new SelectList(items, Math.max(1, Math.min(8, renderer.terminal.rows - 8)), listTheme);
      const current = kind === "model" ? this.model?.key : this.thinking;
      this.list.setSelectedIndex(Math.max(0, items.findIndex((item) => item.value === current)));
      this.list.onSelect = (item) => {
        if (kind === "model") {
          this.model = models.find((model) => model.key === item.value);
          this.thinking = chooseThinking(this.model, this.thinking);
        } else this.thinking = item.value;
        this.phase = "form";
        this.message = "";
      };
      this.list.onCancel = () => { this.phase = "form"; };
      this.phase = "select";
    }

    async submit() {
      if (this.busy || launch.launched) return;
      this.busy = true;
      this.message = "Starting task…";
      this.syncFocus();
      renderer.requestRender();
      try {
        const result = await launch.start({
          prompt: this.editor.getExpandedText(), model: this.model, thinking: this.thinking,
          branch: this.inputs.branch.getValue(), base: this.inputs.base.getValue(), path: this.inputs.path.getValue(),
        });
        if (result.warning) {
          this.phase = "done";
          this.message = result.warning;
        } else onClose();
      } catch (error) {
        this.message = [error.message, launch.recoveryMessage()].filter(Boolean).join(" ");
      } finally {
        this.busy = false;
        this.syncFocus();
        renderer.requestRender();
      }
    }

    handleInput(data) {
      if (this.busy) return; // Do not pretend to cancel an in-flight Git mutation.
      if (matchesKey(data, "ctrl+c")) { onClose(); return; }
      if (this.phase === "menu") {
        if (matchesKey(data, "escape")) onClose();
        else if (matchesKey(data, "t") || matchesKey(data, "enter")) this.phase = "form";
      } else if (this.phase === "done") {
        if (matchesKey(data, "escape") || matchesKey(data, "enter")) onClose();
      } else if (this.phase === "select") {
        if (["escape", "enter", "up", "down", "pageUp", "pageDown"].some((key) => matchesKey(data, key))) {
          this.list.handleInput(data);
        } else {
          this.search.handleInput(data);
          this.list.setFilter(this.search.getValue());
        }
      } else if (matchesKey(data, "escape")) onClose();
      else if (matchesKey(data, "tab")) this.changeField(1);
      else if (matchesKey(data, "shift+tab")) this.changeField(-1);
      else if (matchesKey(data, "ctrl+g")) {
        this.advanced = !this.advanced;
        if (!this.fields().includes(this.field)) this.field = "advanced";
      } else if (matchesKey(data, "enter") || (this.field !== "prompt" && !this.inputs[this.field] && matchesKey(data, "space"))) {
        if (this.field === "model" || this.field === "thinking") this.openSelector(this.field);
        else if (this.field === "advanced") this.advanced = !this.advanced;
        else void this.submit();
      } else if (this.field === "prompt") this.editor.handleInput(data);
      else if (this.inputs[this.field] && !launch.spec) this.inputs[this.field].handleInput(data);
      else if (matchesKey(data, "up")) this.changeField(-1);
      else if (matchesKey(data, "down")) this.changeField(1);
      this.syncFocus();
      renderer.requestRender();
    }

    render(width) {
      const fit = (line) => truncateToWidth(line, Math.max(1, width));
      const title = (name) => accent(name) + dim(`    ${safe(repo.name)}`);
      if (width < 28 || renderer.terminal.rows < 12) {
        return [fit("Pi Tasks — enlarge this popup"), fit("Esc cancels; input is retained.")];
      }
      if (this.phase === "menu") {
        return ["", fit(title("PI TASKS")), "", fit(accent("  t  Start a task")), "",
          fit(dim("  Pi + an isolated worktree")), "", fit(dim("  t / Enter open · Esc cancel"))];
      }
      if (this.phase === "select") {
        return [fit(title(this.selectorKind === "model" ? "MODEL" : "THINKING")), "",
          ...this.search.render(width).map(fit), "", ...this.list.render(width).map(fit), "",
          fit(dim("Type to filter · ↑↓ choose · Enter select · Esc back"))];
      }
      if (this.phase === "done") {
        return [fit(title("TASK OPENED")), "", ...wrapTextWithAnsi(safe(this.message), width).map(fit), "", fit("Enter / Esc close")];
      }
      const row = (field, label, value) => (this.field === field ? accent("› ") : "  ") + label + "  " + value;
      const lines = [fit(title("NEW TASK")), "", fit("What do you want to do?"),
        ...this.editor.render(width).map(fit), "",
        fit(row("model", "Model   ", `[ ${safe(this.model?.key ?? "Choose model")} ▾ ]`)),
        fit(row("thinking", "Thinking", `[ ${safe(this.thinking ?? "off")} ▾ ]`)),
        fit(row("advanced", "Advanced", this.advanced ? "▾" : "▸"))];
      if (this.advanced) {
        for (const [field, label] of [["branch", "Branch"], ["base", "Base"], ["path", "Path"]]) {
          const fixed = launch.spec?.[field];
          const value = fixed ?? this.inputs[field].getValue();
          if (this.field === field && !launch.spec) {
            lines.push(fit(row(field, label, "")), ...this.inputs[field].render(width).map(fit));
          } else {
            lines.push(fit(row(field, label, safe(value || (field === "branch" ? "Automatic task name" : "Herdr worktree directory")))));
          }
        }
      }
      lines.push("", fit(row("start", this.busy ? "Starting…" : launch.created ? "[ Retry Pi startup ]" : "[ Start task ]", "")),
        fit(dim(repo.dirty ? "Source has uncommitted edits; they stay here, not in the task." : "Starts from committed HEAD; the source checkout stays unchanged.")),
        fit(dim(this.busy ? "Please wait; checkout creation cannot be cancelled safely."
          : "Tab fields · Enter activate/start · Alt+Enter newline · Esc cancel")));
      if (launch.spec) lines.push(fit(dim("Git details locked for this attempt. Esc/reopen to change them.")));
      if (this.message) lines.push(...wrapTextWithAnsi(safe(this.message), width).slice(0, 5).map(fit));
      return lines;
    }
  }();
}
