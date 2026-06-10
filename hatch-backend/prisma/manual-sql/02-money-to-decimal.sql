-- Convert money columns from double precision (Prisma Float) to numeric(12,2).
--
-- DO NOT APPLY ON ITS OWN. This must land together with the matching
-- schema.prisma change (Float -> Decimal @db.Decimal(12,2) on each of these
-- fields) and a backend redeploy, because the generated Prisma client returns
-- Decimal objects once the schema says Decimal. Until both halves ship
-- together, leave the schema on Float.
--
-- Each ALTER takes an ACCESS EXCLUSIVE lock and rewrites the table — run in a
-- maintenance window, after a backup.

BEGIN;

ALTER TABLE "products"
  ALTER COLUMN "unit_cost"  TYPE numeric(12,2) USING ROUND("unit_cost"::numeric, 2),
  ALTER COLUMN "sale_price" TYPE numeric(12,2) USING ROUND("sale_price"::numeric, 2);

ALTER TABLE "orders"
  ALTER COLUMN "delivery_fee" TYPE numeric(12,2) USING ROUND("delivery_fee"::numeric, 2),
  ALTER COLUMN "total_amount" TYPE numeric(12,2) USING ROUND("total_amount"::numeric, 2);

ALTER TABLE "order_items"
  ALTER COLUMN "unit_price" TYPE numeric(12,2) USING ROUND("unit_price"::numeric, 2);

ALTER TABLE "sales"
  ALTER COLUMN "charged"        TYPE numeric(12,2) USING ROUND("charged"::numeric, 2),
  ALTER COLUMN "cost_price"     TYPE numeric(12,2) USING ROUND("cost_price"::numeric, 2),
  ALTER COLUMN "discount_value" TYPE numeric(12,2) USING ROUND("discount_value"::numeric, 2),
  ALTER COLUMN "vat_rate"       TYPE numeric(6,3)  USING ROUND("vat_rate"::numeric, 3),
  ALTER COLUMN "vat_amount"     TYPE numeric(12,2) USING ROUND("vat_amount"::numeric, 2);

ALTER TABLE "vendlive_stock_syncs"
  ALTER COLUMN "variance_cost" TYPE numeric(12,2) USING ROUND("variance_cost"::numeric, 2);

COMMIT;
