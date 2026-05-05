-- Add a unique index on Product.barcode that allows multiple NULLs.
-- Postgres treats NULLs as distinct in unique indexes, but we use a
-- partial index here to make the intent explicit and to keep the
-- index smaller (skips rows where barcode is unset).
--
-- IMPORTANT — pre-flight check before applying:
--   SELECT barcode, COUNT(*) FROM products
--   WHERE barcode IS NOT NULL
--   GROUP BY barcode HAVING COUNT(*) > 1;
-- Must return zero rows. Resolve any duplicates before deploy.

CREATE UNIQUE INDEX "products_barcode_key"
  ON "products" ("barcode")
  WHERE "barcode" IS NOT NULL;
