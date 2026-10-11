/**
 * Pi extension event bus channel for a completed theme apply.
 *
 * `theme-sync` emits it after it installs a flavour. Extensions that store
 * theme-coloured text in UI state (for example `token-speed`'s footer status)
 * listen for it and repaint, instead of polling the shared state themselves.
 */
export const THEME_APPLIED_EVENT = "theme-sync:applied";