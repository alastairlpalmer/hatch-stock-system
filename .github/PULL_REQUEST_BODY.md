# Case-insensitive login emails

`Alastair@x.com` and `alastair@x.com` were two different accounts — emails were stored as typed and matched exactly (Postgres text equality is case-sensitive). Now every entry point normalises to lowercase: **register**, **login**, and **admin user creation** — so case (and stray spaces) no longer matter when signing in.

## ⚠️ Deploy steps (order matters)

1. **Run `hatch-backend/manual-sql/016_lowercase_emails.sql` in the Supabase SQL editor first** — lowercases the accounts already created. (If two accounts differ only by case, it fails loudly on the unique constraint — delete the duplicate in Support → Users, re-run.)
2. Deploy backend (Railway). Frontend unchanged.

After deploy, everyone signs in with their email in any casing. Passwords remain case-sensitive (as they should be).

## Verification

- Backend: 241/241 vitest tests green (2 new: schema lowercasing, normaliser trim/lowercase/null tolerance)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
