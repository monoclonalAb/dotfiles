// Stand-in for the app's herdr module (every export of herdr.d.ts, 0.1.12):
// empty live data, inert actions.
const none = () => [];
const never = () => new Promise(() => {});
const nothing = () => null;
export const agents = none, terminals = none, panes = none, spaces = none, machines = none, layouts = none, keys = none;
export const commands = none, themes = none, fonts = none;
export const focused = nothing, layout = nothing, props = nothing, placement = nothing;
export const window = () => ({ active: false, platform: "macos" });
export const theme = () => ({}), settings = () => ({}), shared = () => undefined, home = () => "/home", appHome = () => "/home/.config/herdr-app";
export const updates = () => ({ app: {}, core: {}, notes: [] }), telemetry = () => ({});
export const run = nothing, notify = () => "", setShared = nothing, setAgentOrder = nothing, playSound = nothing, presentUpdateNotes = nothing;
export const openOverlay = () => "", closeOverlay = nothing;
export const nextCommand = never, watchFolder = never;
export const exec = async () => ({ code: 0, stdout: "", stderr: "" }), hc = exec;
export const readTextFile = async () => null, writeTextFile = async () => null;
export const knownAgents = async () => [], pickFolder = async () => null;
export const feedbackPreview = () => ({ body: null, available: false }), feedbackPasteImage = nothing, feedbackPickImages = async () => [];
export const feedbackAttachImages = none, feedbackClearImages = nothing, sendFeedback = async () => null;
