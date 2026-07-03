# Mobile bottom navigation + phone-first reorganisation

A 4-tab bottom bar on phones — **Locations / Orders / Restock / Other** — with the desktop experience untouched (sidebar, all pages, all routes exactly as before). Frontend-only: no migration, no backend change.

## The four tabs

- **Locations → `/home` (new composite page)**: headline sales stats (This week / This month toggle, reusing the analytics dashboard's numbers), one card per machine (units / capacity, red "out" + amber "low" counts, "expiring soon" chips), and a recent-transactions digest with "Open full sales →". Each section loads and fails independently — if the analytics API is down, machines and sales digest still render.
- **Orders**: the existing area (Purchase Orders, Buying Lists, Receive, Warehouse) plus a new **Pick Lists** tab cross-linking to the pick-list pages.
- **Restock**: a new action hub on mobile — four big tap targets: **Today's Run, Stock Check, Pick Lists, Log a Restock**, plus a current-run pill. Desktop `/restock` still shows the 3-step workflow (same URL, conditional render).
- **Other → `/more`**: role-gated menu of everything else (Dashboard, Full Sales, Location Stock, Docs, History, Shrinkage, Remove Stock, Select Route, Account/Settings/Users per role) with an identity + sign-out + sync footer.

## Architecture notes

- The bar is rendered **in normal flow** below the scroll container, not `position:fixed` — so the pages' existing `sticky bottom-0` action bars ("Mark packed", stock-check save) stack above it with zero z-index or offset changes, and content can never be clipped behind it. Verified geometrically in preview (nav bottom = viewport bottom; main ends exactly at nav top).
- The mobile hamburger/drawer is removed — the Other tab supersedes it (its unique features — identity, logout, sync state — moved to `/more`). Desktop sidebar untouched.
- iOS support: `h-[100dvh]` (collapsing Safari toolbar), `viewport-fit=cover` + `env(safe-area-inset-bottom)` (home-indicator padding in PWA mode).
- Active-tab matrix: Restock and Orders own their URL areas; Locations lights for `/home`, `/locations`, `/sales`; Other is the fallback bucket.

## Verification

- Preview at 375×812: bar renders with 4 tabs, hamburger gone, `/home` sections render/fail independently, `/restock` shows the hub, `/more` gating correct with auth off, Orders shows the 5th Pick Lists tab, active states match the matrix, nav hugs the viewport bottom with `<main>` ending exactly above it.
- Desktop 1280×800: bar absent, sidebar intact, `/restock` shows the 3-step workflow.
- `npm run build` clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
