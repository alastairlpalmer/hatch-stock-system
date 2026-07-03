# Fix: make migration 012 pooler-safe (no temp table)

Running `manual-sql/012_vendlive_trust.sql` in the Supabase SQL editor failed with `42P01: relation "_vmm_dups" does not exist` — the editor runs through the transaction pooler, where each statement can land on a different session, so the TEMP TABLE created in one statement was gone by the next.

The duplicate-mapping merge is rewritten as a **single statement** using data-modifying CTEs (delete the sales-namespace duplicate and carry its id onto the keeper's `sales_machine_id` in one snapshot). Result is identical; still idempotent.

Docs-only change to a migration file — no code, no deploy behaviour. The corrected SQL has already been run in production (sales poll recovered); this PR just makes the repo copy the version that works, for anyone re-running it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
