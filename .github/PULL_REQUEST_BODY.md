# Auth & roles: server-side enforcement, lockout-proof rollout

Adds real role enforcement to the API and the account UX around it. **Everything in this PR is inert until you flip the environment flags** — merging and deploying changes nothing about how the app behaves today, and setting `AUTH_ENABLED=false` in Railway at any point instantly reverts the whole API to no-auth (the permanent lockout escape hatch).

**No DB migration.**

## The permission model

Two roles (the existing `admin` / `user` field):

- **Everyone signed in**: all reads, plus the operational writes a restocker needs on a phone — stock checks, restocks, removals, pick lists (generate/tick/complete/return), receiving deliveries (incl. fresh-meal flavour allocation), per-location VendLive stock sync, changing their own password.
- **Admin only**: every other write — products, suppliers, warehouses, locations, routes, orders, buying lists, VendLive config/quarantine, batches/transfers, reports, user management.

Enforced **server-side** in one auditable policy table (`rolePolicy` in `middleware/auth.js`) applied to all `/api` routes — not scattered per-route. 7 new unit tests pin the policy down (no-op while disabled, reads open, ops allowlist, receive-pattern can't leak to order delete, query strings ignored).

## Login & session fixes

- `GET /api/auth/setup-status` (public): the login page now only offers "create admin account" while **no user exists** — the permanent dead-end button is gone.
- Expired tokens are detected client-side (JWT `exp`) → straight to login instead of a broken app waiting for its first 401.
- `/auth/me` re-sync on load: a role change or deleted account takes effect on next load; network blips do **not** log you out (only real 401/403s do).
- **Env-flag mismatch banner**: if the backend requires login but the frontend build has `VITE_AUTH_ENABLED` off, the app now shows a red banner explaining exactly which flag to set where, instead of silently breaking.

## Account UX

- New **Support → Account** tab (visible only with auth on): who you're signed in as, role badge, **change your own password** (requires current password — a stolen unlocked phone can't silently take over), sign out.
- **Support → Settings** (the Admin page) is now admin-gated in the router AND hidden from restockers — backed by the server policy either way.
- Users page: password reset via a proper masked inline form (was a plain-text `window.prompt`), delete via two-tap confirm (was `window.confirm`).
- Existing protections kept: can't delete yourself, can't delete the last admin, registration is admin-only once any user exists.

## 🔐 Switch-on checklist (do in this order — lockout-proof)

1. **Merge + deploy with flags untouched.** Nothing changes; use the app normally.
2. **Create your admin account while auth is still off**: visit `/login` directly (type the URL), use "First-time setup? Create admin account". First account ever created = admin. Verify you can sign in.
3. **Railway**: set `JWT_SECRET` to a long random string (e.g. 64 hex chars) **first**, then set `AUTH_ENABLED=true`. (The backend deliberately refuses to boot with auth on and no secret.)
4. **Vercel**: set `VITE_AUTH_ENABLED=true`, redeploy the frontend.
5. Sign in as your admin. Create restocker logins in **Support → Users** (they get the `user` role automatically).
6. Give restockers their email + starting password; they can change it in **Support → Account**.

**If anything goes wrong at any step**: set `AUTH_ENABLED=false` in Railway → the API is instantly open again exactly as today; fix at leisure. Forgotten admin password later: same flag off → sign in not required → reset via the API/Users page → flag back on. Changing `JWT_SECRET` logs everyone out (7-day sessions re-issued at next login) — harmless.

## Verification

- Backend: 239/239 vitest tests green (7 new role-policy tests)
- Frontend: production build clean; verified in preview that with flags OFF the app is pixel-identical to today (Settings reachable, no Account/Users tabs, no login prompt)
- Auth-ON behaviour is enforced by the unit-tested policy; final end-to-end check happens during the switch-on checklist with the escape hatch armed

🤖 Generated with [Claude Code](https://claude.com/claude-code)
