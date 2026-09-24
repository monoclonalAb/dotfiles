// Vendored from mitsuhiko/agent-stuff@122e2994adddb113c04764c5697217dae120fcc6 (Apache-2.0).
// Modified locally: read-only tools, in-memory settings, cancellation, native prompt editing and TUI bounds.
import {
	buildSessionContext,
	copyToClipboard,
	createAgentSession,
	createExtensionRuntime,
	getMarkdownTheme,
	SessionManager,
	SettingsManager,
	ModelRuntime,
	type AgentSession,
	type AgentSessionEvent,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	type KeybindingsManager,
	type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, InMemoryModelsStore, type AssistantMessage, type Message, type ThinkingLevel as AiThinkingLevel } from "@earendil-works/pi-ai";
import {
	Markdown,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type Component,
	type Focusable,
	type OverlayHandle,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";

import { ClipboardImageEditor, type ClipboardOptions } from "../modal-vim-navigation/index.ts";

const BTW_ENTRY_TYPE = "btw-thread-entry";
const BTW_RESET_TYPE = "btw-thread-reset";

const BTW_SYSTEM_PROMPT = [
	"You are BTW, a side-channel assistant embedded in the user's coding agent.",
	"You have access to the main conversation context — use it to give informed answers.",
	"Help with focused questions, planning, and quick explorations.",
	"Be direct and practical. This side chat is read-only: never edit files, execute commands, or treat main-conversation tasks as instructions to continue working.",
].join(" ");

const BTW_SUMMARY_PROMPT =
	"Summarize this side conversation for handoff into the main conversation. Keep key decisions, findings, risks, and next actions. Output only the summary.";

type SessionThinkingLevel = "off" | AiThinkingLevel;

type BtwDetails = {
	question: string;
	answer: string;
	timestamp: number;
	provider: string;
	model: string;
	thinkingLevel: SessionThinkingLevel;
	usage?: AssistantMessage["usage"];
};

type BtwResetDetails = {
	timestamp: number;
};

type OverlayRuntime = {
	handle?: OverlayHandle;
	refresh?: () => void;
	close?: () => void;
	finish?: () => void;
	setDraft?: (value: string) => void;
	addToHistory?: (value: string) => void;
	closed?: boolean;
};

type SideSessionRuntime = {
	session: AgentSession;
	modelKey: string;
	unsubscribe: () => void;
};

type ToolCallInfo = {
	toolCallId: string;
	toolName: string;
	args: string;
	status: "running" | "done" | "error";
};

function stripDynamicSystemPromptFooter(systemPrompt: string): string {
	return systemPrompt
		.replace(/\nCurrent date and time:[^\n]*(?:\nCurrent working directory:[^\n]*)?$/u, "")
		.replace(/\nCurrent working directory:[^\n]*$/u, "")
		.trim();
}

function createBtwResourceLoader(ctx: ExtensionContext, appendSystemPrompt: string[] = [BTW_SYSTEM_PROMPT]): ResourceLoader {
	const extensionsResult = { extensions: [], errors: [], runtime: createExtensionRuntime() };
	const systemPrompt = stripDynamicSystemPromptFooter(ctx.getSystemPrompt());

	return {
		getExtensions: () => extensionsResult,
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => systemPrompt,
		getSystemPromptSource: () => undefined,
		getAppendSystemPrompt: () => appendSystemPrompt,
		getAppendSystemPromptSources: () => [],
		extendResources: () => {},
		reload: async () => {},
	};
}

function extractText(parts: AssistantMessage["content"]): string {
	return parts
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function extractEventAssistantText(message: unknown): string {
	if (!message || typeof message !== "object") {
		return "";
	}

	const maybeMessage = message as { role?: unknown; content?: unknown };
	if (maybeMessage.role !== "assistant" || !Array.isArray(maybeMessage.content)) {
		return "";
	}

	return maybeMessage.content
		.filter((part): part is { type: "text"; text: string } => {
			return !!part && typeof part === "object" && (part as { type?: unknown }).type === "text";
		})
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function getLastAssistantMessage(session: AgentSession): AssistantMessage | null {
	for (let i = session.state.messages.length - 1; i >= 0; i--) {
		const message = session.state.messages[i];
		if (message.role === "assistant") {
			return message as AssistantMessage;
		}
	}

	return null;
}

function buildSeedMessages(ctx: ExtensionContext, thread: BtwDetails[]): Message[] {
	const seed: Message[] = [];

	try {
		const contextMessages = buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId()).messages;
		seed.push(...(contextMessages.filter((message) => "role" in message) as Message[]));
	} catch {
		// Ignore context seed failures and continue with an empty side thread.
	}

	for (const item of thread) {
		seed.push(
			{
				role: "user",
				content: [{ type: "text", text: item.question }],
				timestamp: item.timestamp,
			},
			{
				role: "assistant",
				content: [{ type: "text", text: item.answer }],
				provider: item.provider,
				model: item.model,
				api: ctx.model?.api ?? "openai-responses",
				usage:
					item.usage ??
					{
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
				stopReason: "stop",
				timestamp: item.timestamp,
			},
		);
	}

	return seed;
}

function formatThread(thread: BtwDetails[]): string {
	return thread
		.map((item) => `User: ${item.question.trim()}\nAssistant: ${item.answer.trim()}`)
		.join("\n\n---\n\n");
}

function notify(ctx: ExtensionContext | ExtensionCommandContext, message: string, level: "info" | "warning" | "error"): void {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
	}
}


type BtwPromptOptions = {
	history?: string[];
	copy?: (text: string) => Promise<void>;
	readClipboard?: ClipboardOptions["read"];
	notify?: (message: string, level: "info" | "warning" | "error") => void;
};

export class BtwOverlay implements Component, Focusable {
	private readonly input: ClipboardImageEditor;
	private readonly tui: TUI;
	private readonly theme: ExtensionContext["ui"]["theme"];
	private readonly keybindings: KeybindingsManager;
	private readonly getTranscript: (width: number, theme: ExtensionContext["ui"]["theme"]) => string[];
	private readonly getStatus: () => string;
	private readonly onSubmitCallback: (value: string) => void;
	private readonly onDismissCallback: () => void;
	private scrollTop = 0;
	private transcriptHeight = 6;
	private transcriptLineCount = 0;
	private followingLatest = true;
	private inputRow = 0;
	private inputHeight = 0;
	private disposed = false;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.input.focused = value;
	}

	constructor(
		tui: TUI,
		theme: ExtensionContext["ui"]["theme"],
		keybindings: KeybindingsManager,
		getTranscript: (width: number, theme: ExtensionContext["ui"]["theme"]) => string[],
		getStatus: () => string,
		onSubmit: (value: string) => void,
		onDismiss: () => void,
		private readonly promptOptions: BtwPromptOptions = {},
	) {
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
		this.getTranscript = getTranscript;
		this.getStatus = getStatus;
		this.onSubmitCallback = onSubmit;
		this.onDismissCallback = onDismiss;

		const accent = (text: string) => theme.fg("accent", text);
		const dim = (text: string) => theme.fg("dim", text);
		// Native wrapping, paste expansion, undo and history; cap the viewport at
		// five text rows so the prompt cannot push the thread out of the panel.
		this.input = new ClipboardImageEditor({
			terminal: { get rows() { return Math.min(tui.terminal.rows, 16); } },
			requestRender: () => tui.requestRender(),
		} as TUI, {
			borderColor: accent,
			selectList: { selectedPrefix: accent, selectedText: accent, description: dim, scrollInfo: dim, noMatch: dim },
		}, keybindings, {
			read: promptOptions.readClipboard,
			write: (text) => this.writeDraft(text),
			reportError: () => promptOptions.notify?.("Clipboard paste failed; check Pi's clipboard support", "warning"),
		});
		this.input.setPaddingX(1);
		for (const question of promptOptions.history ?? []) this.input.addToHistory(question);
		this.input.onChange = () => this.tui.requestRender();
		this.input.onSubmit = (value) => {
			// Native submit clears first. Restore until the command accepts it so
			// Enter during streaming never loses the next draft.
			this.input.setText(value);
			this.onSubmitCallback(value);
		};
		this.input.onEscape = () => this.onDismissCallback();
		this.input.onCtrlD = () => this.onDismissCallback();
		// ClipboardImageEditor copies the draft around Pi's routed clear action.
		this.input.onAction("app.clear", () => this.setDraft(""));
		this.input.onExtensionShortcut = (data) => {
			if (matchesKey(data, "alt+shift+c") || data === "\x1bC") {
				void this.copyDraft(false);
				return true;
			}
			// Command on terminals that forward Super (Kitty keyboard protocol).
			if (matchesKey(data, "super+c")) {
				void this.copyDraft(true);
				return true;
			}
			return false;
		};
	}

	private async copyDraft(clear: boolean): Promise<void> {
		const draft = this.input.getExpandedText();
		if (!draft) {
			if (!clear) this.promptOptions.notify?.("Prompt is empty", "warning");
			return;
		}
		// Clear synchronously like the main editor, with native undo recovery.
		if (clear) this.setDraft("");
		await this.writeDraft(draft);
	}

	private async writeDraft(draft: string): Promise<void> {
		try {
			await (this.promptOptions.copy ?? copyToClipboard)(draft);
			if (!this.disposed) this.promptOptions.notify?.("Prompt copied to clipboard", "info");
		} catch {
			if (!this.disposed) this.promptOptions.notify?.("Could not copy prompt; use editor undo to recover a cleared draft", "error");
		}
	}

	private getDialogHeight(): number {
		return Math.min(30, Math.floor((this.tui.terminal.rows ?? 30) * 0.75));
	}

	handleInput(data: string): void {
		if (this.disposed) return;
		// Escape cancels immediately, including during an asynchronous clipboard read.
		if (this.keybindings.matches(data, "app.interrupt")) {
			this.onDismissCallback();
			return;
		}
		if (this.getDialogHeight() < 15 || this.tui.terminal.columns < 10) {
			return; // Never submit a draft whose editor is hidden by a tiny terminal.
		}
		if (this.keybindings.matches(data, "tui.altScreen.pageUp")) {
			this.scrollBy(-Math.max(1, this.transcriptHeight - 2));
			return;
		}
		if (this.keybindings.matches(data, "tui.altScreen.pageDown")) {
			this.scrollBy(Math.max(1, this.transcriptHeight - 2));
			return;
		}
		if (this.keybindings.matches(data, "tui.altScreen.lineUp")) {
			this.scrollBy(-1);
			return;
		}
		if (this.keybindings.matches(data, "tui.altScreen.lineDown")) {
			this.scrollBy(1);
			return;
		}

		this.input.handleInput(data);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "wheel" && event.wheelDelta) {
			this.scrollBy(event.wheelDelta);
			return { handled: true, focus: true };
		}
		if (event.y >= this.inputRow && event.y < this.inputRow + this.inputHeight) {
			const result = this.input.handleMouse({
				...event,
				x: Math.max(0, event.x - 1),
				y: event.y - this.inputRow,
				width: Math.max(1, event.width - 2),
				height: this.inputHeight,
			});
			return result ? { ...result, focus: true } : undefined;
		}
		return undefined;
	}

	private scrollBy(lines: number): void {
		const maxScrollTop = Math.max(0, this.transcriptLineCount - this.transcriptHeight);
		const start = this.followingLatest ? maxScrollTop : this.scrollTop;
		const next = Math.max(0, Math.min(maxScrollTop, start + Math.trunc(lines)));
		const followingLatest = next === maxScrollTop;
		if (next === this.scrollTop && followingLatest === this.followingLatest) return;
		this.scrollTop = next;
		this.followingLatest = followingLatest;
		this.tui.requestRender();
	}

	setDraft(value: string): void {
		this.input.setText(value);
		this.tui.requestRender();
	}

	getDraft(): string {
		return this.input.getExpandedText();
	}

	addToHistory(value: string): void {
		this.input.addToHistory(value);
	}

	dispose(): void {
		this.disposed = true;
		this.input.disposeClipboard();
	}

	invalidate(): void {
		this.input.invalidate();
	}

	private frameLine(content: string, innerWidth: number): string {
		const truncated = truncateToWidth(content, innerWidth, "");
		const padding = Math.max(0, innerWidth - visibleWidth(truncated));
		return `${this.theme.fg("borderMuted", "│")}${truncated}${" ".repeat(padding)}${this.theme.fg("borderMuted", "│")}`;
	}

	private borderLine(innerWidth: number, edge: "top" | "bottom"): string {
		const left = edge === "top" ? "┌" : "└";
		const right = edge === "top" ? "┐" : "┘";
		return this.theme.fg("borderMuted", `${left}${"─".repeat(innerWidth)}${right}`);
	}

	render(width: number): string[] {
		this.inputHeight = 0;
		if (width < 10 || this.getDialogHeight() < 15) return [truncateToWidth("BTW: enlarge terminal · Esc close", width)];
		const innerWidth = Math.max(1, width - 2);
		const inputLines = this.input.render(innerWidth);
		this.inputHeight = inputLines.length;
		const transcriptHeight = Math.max(1, this.getDialogHeight() - 7 - inputLines.length);

		// Markdown renders to innerWidth already — no manual wrapping needed.
		const transcript = this.getTranscript(innerWidth, this.theme);
		this.transcriptHeight = transcriptHeight;
		this.transcriptLineCount = transcript.length;
		const maxScrollTop = Math.max(0, transcript.length - transcriptHeight);
		if (this.followingLatest) {
			this.scrollTop = maxScrollTop;
		} else {
			this.scrollTop = Math.max(0, Math.min(maxScrollTop, this.scrollTop));
			if (this.scrollTop === maxScrollTop) this.followingLatest = true;
		}
		const visibleTranscript = transcript.slice(this.scrollTop, this.scrollTop + transcriptHeight);
		const transcriptPadding = Math.max(0, transcriptHeight - visibleTranscript.length);
		const linesAbove = this.scrollTop;
		const linesBelow = Math.max(0, maxScrollTop - this.scrollTop);
		const scrollInfo = maxScrollTop === 0 ? "all visible" : `↑ ${linesAbove} · ↓ ${linesBelow}`;
		this.inputRow = transcriptHeight + 5;

		const status = this.getStatus();

		const lines = [
			this.borderLine(innerWidth, "top"),
			this.frameLine(this.theme.fg("accent", this.theme.bold(" BTW side chat ")), innerWidth),
			this.frameLine(this.theme.fg("dim", `Separate side conversation · ${scrollInfo}`), innerWidth),
			this.theme.fg("borderMuted", `├${"─".repeat(innerWidth)}┤`),
		];

		for (const line of visibleTranscript) {
			lines.push(this.frameLine(line, innerWidth));
		}
		for (let i = 0; i < transcriptPadding; i++) {
			lines.push(this.frameLine("", innerWidth));
		}

		lines.push(this.frameLine(this.theme.fg("warning", status), innerWidth));
		// Native rows are already padded/bounded; keep the cursor marker intact.
		for (const line of inputLines) {
			lines.push(`${this.theme.fg("borderMuted", "│")}${line}${this.theme.fg("borderMuted", "│")}`);
		}
		lines.push(this.frameLine(this.theme.fg("dim", "↑↓ history · Ctrl+J newline · PgUp/PgDn scroll · Esc close"), innerWidth));
		lines.push(this.borderLine(innerWidth, "bottom"));

		return lines;
	}
}

export default function (pi: ExtensionAPI) {
	let thread: BtwDetails[] = [];
	let promptHistory: string[] = [];
	let pendingQuestion: string | null = null;
	let pendingAnswer = "";
	let pendingError: string | null = null;
	let pendingToolCalls: ToolCallInfo[] = [];
	let sideBusy = false;
	let overlayStatus = "Ready";
	let overlayDraft = "";
	let overlayRuntime: OverlayRuntime | null = null;
	let activeSideSession: SideSessionRuntime | null = null;
	let overlayRefreshTimer: ReturnType<typeof setTimeout> | null = null;
	let generation = 0;
	let summaryController: AbortController | undefined;

	const mdTheme = getMarkdownTheme();

	function getModelKey(ctx: ExtensionContext): string {
		const model = ctx.model;
		const readTools = pi.getAllTools().filter((tool) => tool.sourceInfo.source === "builtin"
			&& ["read", "grep", "find", "ls"].includes(tool.name)
			&& pi.getActiveTools().includes(tool.name)).map((tool) => tool.name).sort();
		return model ? `${model.provider}/${model.id}:${pi.getThinkingLevel()}:${readTools.join(",")}` : "none";
	}

	function renderMarkdownLines(text: string, width: number): string[] {
		if (!text) return [];
		try {
			const md = new Markdown(text, 0, 0, mdTheme);
			return md.render(width);
		} catch {
			// Fall back to plain text wrapping if Markdown rendering fails
			return text.split("\n").flatMap((line) => {
				if (!line) return [""];
				const wrapped: string[] = [];
				for (let i = 0; i < line.length; i += width) {
					wrapped.push(line.slice(i, i + width));
				}
				return wrapped.length > 0 ? wrapped : [""];
			});
		}
	}

	function formatToolArgs(toolName: string, args: unknown): string {
		if (!args || typeof args !== "object") return "";
		const a = args as Record<string, unknown>;
		switch (toolName) {
			case "bash":
				return typeof a.command === "string" ? truncateToWidth(a.command.split("\n")[0], 50, "…") : "";
			case "read":
			case "write":
			case "edit":
				return typeof a.path === "string" ? a.path : "";
			default: {
				const first = Object.values(a)[0];
				return typeof first === "string" ? truncateToWidth(first.split("\n")[0], 40, "…") : "";
			}
		}
	}

	function renderToolCallLines(toolCalls: ToolCallInfo[], theme: ExtensionContext["ui"]["theme"], width: number): string[] {
		const lines: string[] = [];
		for (const tc of toolCalls) {
			const icon = tc.status === "running" ? "⚙" : tc.status === "error" ? "✗" : "✓";
			const color = tc.status === "error" ? "error" : tc.status === "done" ? "success" : "dim";
			const label = theme.fg(color, `${icon} `) + theme.fg("toolTitle", tc.toolName);
			const argsText = tc.args ? theme.fg("dim", ` ${tc.args}`) : "";
			lines.push(truncateToWidth(`  ${label}${argsText}`, width, ""));
		}
		return lines;
	}

	function getTranscriptLines(width: number, theme: ExtensionContext["ui"]["theme"]): string[] {
		try {
			return getTranscriptLinesInner(width, theme);
		} catch (error) {
			return [theme.fg("error", `Render error: ${error instanceof Error ? error.message : String(error)}`)];
		}
	}

	function getTranscriptLinesInner(width: number, theme: ExtensionContext["ui"]["theme"]): string[] {
		if (thread.length === 0 && !pendingQuestion && !pendingAnswer && !pendingError) {
			return [theme.fg("dim", "No BTW messages yet. Type a question below.")];
		}

		const questionLines = (question: string) => wrapTextWithAnsi(question.trim(), Math.max(1, width - 5))
			.map((line, index) => (index === 0 ? theme.fg("accent", theme.bold("You: ")) : "     ") + line);
		const lines: string[] = [];
		for (const item of thread) {
			lines.push(...questionLines(item.question));
			lines.push("");

			// Assistant message rendered as markdown
			const mdLines = renderMarkdownLines(item.answer, width);
			lines.push(...mdLines);
			lines.push("");
		}

		if (pendingQuestion) {
			lines.push(...questionLines(pendingQuestion));

			// Show tool calls inline
			if (pendingToolCalls.length > 0) {
				lines.push(...renderToolCallLines(pendingToolCalls, theme, width));
			}

			if (pendingError) {
				lines.push(theme.fg("error", `❌ ${pendingError}`));
			} else if (pendingAnswer) {
				lines.push("");
				const mdLines = renderMarkdownLines(pendingAnswer, width);
				lines.push(...mdLines);
			} else if (pendingToolCalls.length === 0) {
				lines.push(theme.fg("dim", "…"));
			}
		}

		// Trim trailing empty line
		while (lines.length > 0 && lines[lines.length - 1] === "") {
			lines.pop();
		}
		return lines;
	}

	function syncOverlay(): void {
		overlayRuntime?.refresh?.();
	}

	function scheduleOverlayRefresh(): void {
		if (overlayRefreshTimer) {
			return;
		}

		overlayRefreshTimer = setTimeout(() => {
			overlayRefreshTimer = null;
			syncOverlay();
		}, 16);
	}

	function setOverlayStatus(status: string, throttled = false): void {
		overlayStatus = status;
		if (throttled) {
			scheduleOverlayRefresh();
		} else {
			syncOverlay();
		}
	}

	function dismissOverlay(): void {
		overlayRuntime?.close?.();
		overlayRuntime = null;
		if (overlayRefreshTimer) {
			clearTimeout(overlayRefreshTimer);
			overlayRefreshTimer = null;
		}
	}

	function setOverlayDraft(value: string): void {
		overlayDraft = value;
		overlayRuntime?.setDraft?.(value);
	}

	async function disposeSideSession(): Promise<void> {
		const current = activeSideSession;
		activeSideSession = null;
		if (!current) {
			return;
		}

		try {
			current.unsubscribe();
		} catch {
			// Ignore unsubscribe errors during cleanup.
		}

		try {
			await current.session.abort();
		} catch {
			// Ignore abort errors during cleanup.
		}
		current.session.dispose();

		if (overlayRefreshTimer) {
			clearTimeout(overlayRefreshTimer);
			overlayRefreshTimer = null;
		}
	}

	async function resetThread(ctx: ExtensionContext | ExtensionCommandContext, persist = true): Promise<void> {
		generation++;
		summaryController?.abort();
		thread = [];
		promptHistory = [];
		pendingQuestion = null;
		pendingAnswer = "";
		pendingError = null;
		pendingToolCalls = [];
		sideBusy = false;
		setOverlayDraft("");
		setOverlayStatus("Ready");
		await disposeSideSession();
		if (persist) {
			const details: BtwResetDetails = { timestamp: Date.now() };
			pi.appendEntry(BTW_RESET_TYPE, details);
		}
		syncOverlay();
	}

	async function restoreThread(ctx: ExtensionContext): Promise<void> {
		generation++;
		summaryController?.abort();
		dismissOverlay();
		await disposeSideSession();
		thread = [];
		pendingQuestion = null;
		pendingAnswer = "";
		pendingError = null;
		pendingToolCalls = [];
		sideBusy = false;
		overlayStatus = "Ready";
		overlayDraft = "";
		const branch = ctx.sessionManager.getBranch();
		let lastResetIndex = -1;
		for (let i = 0; i < branch.length; i++) {
			const entry = branch[i];
			if (entry.type === "custom" && entry.customType === BTW_RESET_TYPE) {
				lastResetIndex = i;
			}
		}

		for (const entry of branch.slice(lastResetIndex + 1)) {
			if (entry.type !== "custom" || entry.customType !== BTW_ENTRY_TYPE) {
				continue;
			}
			const details = entry.data as BtwDetails | undefined;
			if (!details?.question || !details.answer) {
				continue;
			}
			thread.push(details);
		}
		promptHistory = thread.slice(-100).map((item) => item.question);

		syncOverlay();
	}

	async function createSideSession(ctx: ExtensionCommandContext): Promise<SideSessionRuntime | null> {
		if (!ctx.model) {
			return null;
		}

		// Reuse the effective provider via public APIs, resolving auth through the parent.
		// No second credential store on disk, fallback provider, or extension loading.
		const model = ctx.model;
		const provider = ctx.modelRegistry.getProvider(model.provider);
		if (!provider) throw new Error(`BTW: provider ${model.provider} is unavailable`);
		const modelRuntime = await ModelRuntime.create({
			credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
			modelsPath: null, allowModelNetwork: false, refreshOnCreate: false,
		});
		modelRuntime.registerNativeProvider({
			id: provider.id, name: provider.name, baseUrl: provider.baseUrl, headers: provider.headers,
			getModels: () => [model],
			auth: { apiKey: {
				name: "Parent session authentication",
				check: async () => ({ type: "api_key", source: "parent session" }),
				resolve: async ({ signal }) => {
					signal.throwIfAborted();
					const auth = await ctx.modelRegistry.getProviderAuth(model.provider);
					signal.throwIfAborted();
					return auth;
				},
			} },
			stream: (m, context, options) => provider.stream(m, context, options),
			streamSimple: (m, context, options) => provider.streamSimple(m, context, options),
		});
		const { session } = await createAgentSession({
			cwd: ctx.cwd,
			sessionManager: SessionManager.inMemory(ctx.cwd),
			settingsManager: SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } }),
			model: ctx.model,
			modelRuntime,
			thinkingLevel: pi.getThinkingLevel() as SessionThinkingLevel,
			tools: pi.getAllTools().filter((tool) => tool.sourceInfo.source === "builtin"
				&& ["read", "grep", "find", "ls"].includes(tool.name)
				&& pi.getActiveTools().includes(tool.name)).map((tool) => tool.name),
			resourceLoader: createBtwResourceLoader(ctx),
		});

		// Pi 0.87+: SessionManager owns request history; assigning agent state no longer seeds it.
		const seedMessages = buildSeedMessages(ctx, thread);
		if (seedMessages.length > 0) {
			for (const message of seedMessages) session.sessionManager.appendMessage(message);
			session.refreshContext();
		}

		const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
			if (!sideBusy || !pendingQuestion) {
				return;
			}

			switch (event.type) {
				case "message_start":
				case "message_update":
				case "message_end": {
					const streamed = extractEventAssistantText(event.message);
					if (streamed) {
						pendingAnswer = streamed;
						pendingError = null;
					}
					setOverlayStatus(event.type === "message_end" ? "Finalizing side response..." : "Streaming side response...", true);
					return;
				}
				case "tool_execution_start": {
					const toolName = (event as { toolName?: string }).toolName ?? "unknown";
					try {
						pendingToolCalls.push({
							toolCallId: (event as { toolCallId?: string }).toolCallId ?? "",
							toolName,
							args: formatToolArgs(toolName, (event as { args?: unknown }).args),
							status: "running",
						});
					} catch {
						// Ignore tool tracking failures
					}
					setOverlayStatus(`Running tool: ${toolName}...`, true);
					return;
				}
				case "tool_execution_end": {
					const endToolName = (event as { toolName?: string }).toolName ?? "unknown";
					const tc = pendingToolCalls.find(
						(t) => t.toolName === endToolName && t.status === "running",
					);
					if (tc) {
						tc.status = (event as { isError?: boolean }).isError ? "error" : "done";
					}
					setOverlayStatus("Streaming side response...", true);
					return;
				}
				case "turn_end": {
					setOverlayStatus("Finalizing side response...", true);
					return;
				}
				default:
					return;
			}
		});

		return {
			session,
			modelKey: getModelKey(ctx),
			unsubscribe,
		};
	}

	async function ensureSideSession(ctx: ExtensionCommandContext): Promise<SideSessionRuntime | null> {
		if (!ctx.model) {
			return null;
		}

		const expectedModelKey = getModelKey(ctx);
		if (activeSideSession && activeSideSession.modelKey === expectedModelKey) {
			return activeSideSession;
		}

		const epoch = generation;
		await disposeSideSession();
		const created = await createSideSession(ctx);
		if (epoch !== generation) {
			created?.unsubscribe();
			created?.session.dispose();
			return null;
		}
		activeSideSession = created;
		return activeSideSession;
	}

	async function ensureOverlay(ctx: ExtensionCommandContext | ExtensionContext): Promise<void> {
		if (ctx.mode !== "tui") return;

		if (overlayRuntime?.handle) {
			overlayRuntime.handle.setHidden(false);
			overlayRuntime.handle.focus();
			overlayRuntime.refresh?.();
			return;
		}

		const runtime: OverlayRuntime = {};
		const closeRuntime = () => {
			if (runtime.closed) {
				return;
			}
			runtime.closed = true;
			runtime.handle?.hide();
			if (overlayRuntime === runtime) {
				overlayRuntime = null;
			}
			runtime.finish?.();
		};
		runtime.close = closeRuntime;
		overlayRuntime = runtime;

		void ctx.ui
			.custom<void>(
				async (tui, theme, keybindings, done) => {
					runtime.finish = () => done();

					const overlay = new BtwOverlay(
						tui,
						theme,
						keybindings,
						(width, t) => getTranscriptLines(width, t),
						() => overlayStatus,
						(value) => {
							void submitFromOverlay(ctx, value);
						},
						() => {
							void closeOverlayFlow(ctx);
						},
						{ history: promptHistory, notify: (message, level) => notify(ctx, message, level) },
					);

					overlay.focused = true;
					overlay.setDraft(overlayDraft);
					runtime.setDraft = (value) => overlay.setDraft(value);
					runtime.addToHistory = (value) => overlay.addToHistory(value);
					runtime.refresh = () => {
						overlay.focused = runtime.handle?.isFocused() ?? false;
						tui.requestRender();
					};
					runtime.close = () => {
						overlayDraft = overlay.getDraft();
						closeRuntime();
					};

					if (runtime.closed) {
						done();
					}

					return overlay;
				},
				{
					overlay: true,
					overlayOptions: {
						width: "80%",
						minWidth: 20,
						maxHeight: "78%",
						anchor: "top-center",
						margin: { top: 1, left: 2, right: 2 },
					},
					onHandle: (handle) => {
						runtime.handle = handle;
						handle.focus();
						if (runtime.closed) {
							closeRuntime();
						}
					},
				},
			)
			.catch((error) => {
				if (overlayRuntime === runtime) {
					overlayRuntime = null;
				}
				notify(ctx, error instanceof Error ? error.message : String(error), "error");
			});
	}

	async function summarizeThread(ctx: ExtensionContext, items: BtwDetails[]): Promise<string> {
		const model = ctx.model;
		if (!model) {
			throw new Error("No active model selected.");
		}

		const controller = new AbortController();
		summaryController = controller;
		try {
			const response = await ctx.modelRegistry.complete(model, {
				systemPrompt: BTW_SUMMARY_PROMPT,
				messages: [{ role: "user", content: formatThread(items), timestamp: Date.now() }],
			}, { maxTokens: 4096, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]) });
			if (response.stopReason !== "stop") throw new Error(response.errorMessage || `Summary ended: ${response.stopReason}`);
			return extractText(response.content) || "(No summary generated)";
		} finally {
			if (summaryController === controller) summaryController = undefined;
		}
	}

	async function injectSummaryIntoMain(ctx: ExtensionContext | ExtensionCommandContext): Promise<void> {
		if (thread.length === 0) {
			notify(ctx, "No BTW thread to summarize.", "warning");
			return;
		}

		const epoch = generation;
		setOverlayStatus("Summarizing BTW thread for injection...");
		try {
			const summary = await summarizeThread(ctx, thread);
			if (epoch !== generation) return;
			const message = `Summary of my BTW side conversation:\n\n${summary}`;
			if (ctx.isIdle()) {
				pi.sendUserMessage(message);
			} else {
				pi.sendUserMessage(message, { deliverAs: "followUp" });
			}

			await resetThread(ctx);
			notify(ctx, "Injected BTW summary into main chat.", "info");
		} catch (error) {
			if (epoch === generation) notify(ctx, error instanceof Error ? error.message : String(error), "error");
		}
	}

	async function closeOverlayFlow(ctx: ExtensionContext | ExtensionCommandContext): Promise<void> {
		dismissOverlay();
		generation++;
		summaryController?.abort();
		await disposeSideSession();
		sideBusy = false;
		pendingQuestion = null;
		pendingAnswer = "";
		pendingError = null;
		if (!ctx.hasUI) return;

		if (thread.length === 0) {
			return;
		}

		const choice = await ctx.ui.select("Close BTW:", ["Keep side thread", "Inject summary into main chat"]);
		if (choice === "Inject summary into main chat") {
			await injectSummaryIntoMain(ctx);
		}
	}

	async function runBtwPrompt(ctx: ExtensionCommandContext, question: string): Promise<void> {
		const model = ctx.model;
		if (!model) {
			setOverlayStatus("No active model selected.");
			notify(ctx, "No active model selected.", "error");
			return;
		}

		if (sideBusy) {
			notify(ctx, "BTW is still processing the previous message.", "warning");
			return;
		}

		if (promptHistory.at(-1) !== question) {
			promptHistory.push(question);
			promptHistory = promptHistory.slice(-100);
		}
		overlayRuntime?.addToHistory?.(question);
		sideBusy = true;
		const epoch = generation;
		let deadline: ReturnType<typeof setTimeout> | undefined;
		pendingQuestion = question;
		pendingAnswer = "";
		pendingError = null;
		pendingToolCalls = [];
		setOverlayStatus("Streaming side response...");
		syncOverlay();

		try {
			const side = await ensureSideSession(ctx);
			if (epoch !== generation) return;
			if (!side) throw new Error("Unable to create BTW side session.");
			deadline = setTimeout(() => { void side.session.abort(); }, 90_000);
			await side.session.prompt(question, { source: "extension", expandPromptTemplates: false });
			if (epoch !== generation) return;
			const response = getLastAssistantMessage(side.session);
			if (!response) {
				throw new Error("BTW request finished without a response.");
			}
			if (response.stopReason === "aborted") {
				throw new Error("BTW request aborted.");
			}
			if (response.stopReason === "error") {
				throw new Error(response.errorMessage || "BTW request failed.");
			}

			const answer = extractText(response.content) || "(No text response)";
			pendingAnswer = answer;
			const details: BtwDetails = {
				question,
				answer,
				timestamp: Date.now(),
				provider: model.provider,
				model: model.id,
				thinkingLevel: pi.getThinkingLevel() as SessionThinkingLevel,
				usage: response.usage,
			};
			thread.push(details);
			pi.appendEntry(BTW_ENTRY_TYPE, details);

			pendingQuestion = null;
			pendingAnswer = "";
			pendingToolCalls = [];
			setOverlayStatus("Ready for the next side question.");
		} catch (error) {
			if (epoch !== generation) return;
			const message = error instanceof Error ? error.message : String(error);
			pendingError = message;
			setOverlayStatus("BTW request failed.");
			notify(ctx, message, "error");
		} finally {
			clearTimeout(deadline);
			if (epoch === generation) { sideBusy = false; syncOverlay(); }
		}
	}

	async function submitFromOverlay(ctx: ExtensionContext | ExtensionCommandContext, rawValue: string): Promise<void> {
		if (sideBusy || summaryController) {
			notify(ctx, "BTW is still processing; the draft was kept", "warning");
			return;
		}
		const question = rawValue.trim();
		if (!question) {
			setOverlayStatus("Enter a question first.");
			return;
		}

		if (!("waitForIdle" in ctx)) {
			setOverlayStatus("BTW submit requires command context. Re-open with /btw.");
			return;
		}

		if (!ctx.model) {
			setOverlayStatus("No active model selected; the draft was kept.");
			return;
		}
		setOverlayDraft("");
		await runBtwPrompt(ctx, question);
	}

	pi.registerCommand("btw", {
		description: "Open a simple BTW side-chat popover. `/btw <text>` asks immediately, `/btw` opens the side thread.",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") { notify(ctx, "BTW requires interactive mode", "error"); return; }
			if (sideBusy || summaryController) { notify(ctx, "BTW is still processing; Esc cancels it", "warning"); return; }
			const question = args.trim();

			if (!question) {
				if (thread.length > 0 && ctx.hasUI) {
					const choice = await ctx.ui.select("BTW side chat:", [
						"Continue previous conversation",
						"Start fresh",
					]);
					if (choice === "Continue previous conversation") {
						// Dispose session so it's recreated with fresh main context on next submit
						await disposeSideSession();
						setOverlayStatus("Continuing BTW thread.");
						await ensureOverlay(ctx);
					} else if (choice === "Start fresh") {
						await resetThread(ctx, true);
						setOverlayStatus("Ready");
						await ensureOverlay(ctx);
					}
					// null = user cancelled (Esc), do nothing
				} else {
					await resetThread(ctx, true);
					setOverlayStatus("Ready");
					await ensureOverlay(ctx);
				}
				return;
			}

			await ensureOverlay(ctx);
			await runBtwPrompt(ctx, question);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		await restoreThread(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		await restoreThread(ctx);
	});

	pi.on("model_select", async (_event, ctx) => { await restoreThread(ctx); });
	pi.on("session_shutdown", async () => {
		generation++;
		summaryController?.abort();
		await disposeSideSession();
		dismissOverlay();
	});
}
