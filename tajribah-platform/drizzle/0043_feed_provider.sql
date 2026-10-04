-- Product feeds: a store that does not link its platform gives its Google Merchant feed's link, or
-- uploads a sheet, and its products sync like a linked store's (server/connectors/feed). A new
-- provider value is expand-only: the running version never writes it and reads it as an unknown string.
ALTER TYPE "public"."provider" ADD VALUE IF NOT EXISTS 'feed';

-- ROLLBACK:
-- Postgres cannot drop an enum value; the value stays, unused. Feed connections and their products go
-- with the connections themselves (products keep their rows, unlinked):
-- UPDATE "products" SET "connection_id" = NULL WHERE "connection_id" IN (SELECT "id" FROM "store_connections" WHERE "provider" = 'feed');
-- DELETE FROM "store_connections" WHERE "provider" = 'feed';
