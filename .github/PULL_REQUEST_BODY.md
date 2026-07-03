# Fix: app stuck in "server not connected" after signing in

With auth enabled, the app loaded all its data **once, on first mount — which is now the login page, before any token exists**. All twelve startup requests got 401, the app dropped into offline/cached mode ("Could not reach the server — showing locally cached data"), and after signing in nothing ever re-fetched — so the app looked disconnected even though the backend was healthy (verified: `/health`, `/health/db`, and authenticated endpoints all fine in production).

## Fix

The initial data load now waits for a session and re-runs the moment sign-in completes:

- Auth on + signed out → no doomed requests; in-memory data is also cleared (restocker phones can be shared — the previous user's cached view must not flash at the next person).
- Auth on + signed in (or the flip at login) → full data load, loading screen, live data.
- **Auth off → identical to before** (loads on mount), so local dev and the `AUTH_ENABLED=false` escape hatch behave exactly as they always did.

Frontend only — no migration, no backend change. Deploy: merge → Vercel redeploys.

## Verification

- Production build clean; flags-off behaviour verified unchanged in preview.
- After deploy: sign out, sign back in — dashboard should populate immediately without a manual refresh.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
