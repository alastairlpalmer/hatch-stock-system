-- 016: Case-insensitive emails — lowercase the rows created before the
-- backend started normalising (register/login/admin-create all lowercase
-- now). Run in the Supabase SQL editor BEFORE deploying the backend that
-- ships with this file. Idempotent: safe to re-run.
--
-- Note: if two accounts differ only by case (e.g. Bob@x.com and bob@x.com),
-- the unique constraint will make this UPDATE fail loudly — delete the
-- duplicate account in Support → Users first, then re-run.
UPDATE users SET email = lower(email) WHERE email <> lower(email);
