---
name: everyday-ai-frontend-styleguide
description: "Fonts, colours, and styles for Everyday AI frontend. Use when styling UI - typography, colors, radius, or theming. Reference: client/src/index.css."
---

# Everyday AI Frontend Styleguide

Fonts, colours, and styles only. Canonical token values are in
[`references/theme-tokens.css`](references/theme-tokens.css) (mirrors `client/src/index.css`).

## Fonts

| Role | Class / token | Use for |
|------|----------------|--------|
| Titles | `font-title` | Page and card titles (Family) |
| Body | `font-sans` (default) | Main content (Soehne) |
| Mono / subtext | `font-mono` or `text-muted-foreground` | Timestamps, IDs, tooltips (Basis Grotesque Mono) |

`.text-muted-foreground` is set to `var(--font-mono)` in CSS.

## Colours

Use semantic Tailwind classes only (`bg-card`, `text-muted-foreground`, …) — no raw hex in
classNames. The canonical token values are below and bundled in
[`references/theme-tokens.css`](references/theme-tokens.css) (copy that straight into your
stylesheet).

| Token | Light | Dark |
|-------|-------|------|
| `--background` | `#ffffff` | `#000000` |
| `--foreground` | `oklch(0.129 0.042 264.695)` | `#ffffff` |
| `--card` | `oklch(1 0 0)` (white) | `#0a0a0a` |
| `--card-foreground` | `oklch(0.129 0.042 264.695)` | `#ffffff` |
| `--popover` | `oklch(1 0 0)` | `#0a0a0a` |
| `--primary` | `oklch(0.208 0.042 265.755)` | `#F1EDE4` |
| `--primary-foreground` | `oklch(0.984 0.003 247.858)` | `#000000` |
| `--secondary` | `#F1EDE4` | `#1a1a1a` |
| `--muted` | `#F1EDE4` | `#141414` |
| `--muted-foreground` | `oklch(0.554 0.046 257.417)` | `#F1EDE4` |
| `--accent` | `#F1EDE4` | `#1a1a1a` |
| `--destructive` | `oklch(0.577 0.245 27.325)` | `#ef4444` |
| `--border` | `#E5E0D8` | `#2a2a2a` |
| `--input` | `#E5E0D8` | `#1a1a1a` |
| `--ring` | `oklch(0.704 0.04 256.788)` | `#F1EDE4` |
| `--chart-1…5` | see `references/theme-tokens.css` | see `references/theme-tokens.css` |

Common classes: surfaces `bg-background bg-card bg-popover bg-muted bg-primary bg-secondary
bg-accent bg-destructive`; text `text-foreground text-muted-foreground text-primary
text-primary-foreground text-destructive`; borders/ring `border-border border-input ring-ring`.

**Feel:** light = white surfaces, dark slate text, warm off-white `#F1EDE4` for secondary/muted/accent.
Dark = black/near-black surfaces, warm off-white `#F1EDE4` for primary/foreground/ring.

## Styles

- **Radius:** Base `--radius: 0.625rem`. Use `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-xl` (cards = `rounded-xl`).
- **Dark mode:** `@custom-variant dark` → use `dark:` in Tailwind. System preference is mirrored in `:root`; logo uses `.logo-theme-aware` and `dark:invert` where needed.
- **Rule:** Prefer semantic tokens (e.g. `bg-card`, `text-muted-foreground`) over hex or one-off colours.
