// Stand-in for the app's herdr module (every export of herdr.d.ts, 0.1.12):
// empty live data, inert actions.
const none = () => [];
const never = () => new Promise(() => {});
const nothing = () => null;
// A test can stand in for some of them: globalThis.herdrStub = { spaces: () => [...] }.
const live = (name, fallback) => (...args) => (globalThis.herdrStub?.[name] ?? fallback)(...args);
export const agents = none, terminals = none, machines = none, layouts = none, keys = none;
export const spaces = live("spaces", none), panes = live("panes", none);
export const commands = none, themes = none, fonts = none;
export const focused = nothing, layout = nothing, placement = nothing;
export const props = live("props", nothing);
export const window = live("window", () => ({ active: false, platform: "macos" }));
export const theme = () => ({}), settings = () => ({}), shared = live("shared", () => undefined), home = () => "/home", appHome = () => "/home/.config/herdr-app";
export const updates = () => ({ app: {}, core: {}, notes: [] }), telemetry = () => ({});
export const run = nothing, notify = () => "", setShared = live("setShared", nothing), setAgentOrder = nothing, playSound = nothing, presentUpdateNotes = nothing;
export const openOverlay = () => "", closeOverlay = nothing;
export const nextCommand = never, watchFolder = never;
export const checking = () => false;
export const exec = live("exec", async () => ({ code: 0, stdout: "", stderr: "" })), hc = exec;
export const readTextFile = live("readTextFile", async () => null), writeTextFile = live("writeTextFile", async () => null);
export const knownAgents = async () => [], pickFolder = async () => null;
export const feedbackPreview = () => ({ body: null, available: false }), feedbackPasteImage = nothing, feedbackPickImages = async () => [];
export const feedbackAttachImages = none, feedbackClearImages = nothing, sendFeedback = async () => null;
