-- Retire the historical bridge enum from the active schema. Existing
-- conversation identities are retained; a collision is namespaced before
-- their transport value is normalised to the single supported bridge.
UPDATE "ConversationExternalIdentity" AS "legacy"
SET "externalChatId" = 'retired:' || "legacy"."externalChatId"
WHERE "legacy"."bridgeType" = 'BAILEYS_LEGACY'
  AND EXISTS (
    SELECT 1
    FROM "ConversationExternalIdentity" AS "current"
    WHERE "current"."accountId" = "legacy"."accountId"
      AND "current"."bridgeType" = 'WWEBJS'
      AND "current"."externalChatId" = "legacy"."externalChatId"
  );

CREATE TYPE "WhatsAppBridgeType_new" AS ENUM ('WWEBJS');

ALTER TABLE "WhatsAppConnection"
  ALTER COLUMN "bridgeType" DROP DEFAULT,
  ALTER COLUMN "bridgeType" TYPE "WhatsAppBridgeType_new"
    USING 'WWEBJS'::"WhatsAppBridgeType_new",
  ALTER COLUMN "bridgeType" SET DEFAULT 'WWEBJS';

ALTER TABLE "ConversationExternalIdentity"
  ALTER COLUMN "bridgeType" TYPE "WhatsAppBridgeType_new"
    USING 'WWEBJS'::"WhatsAppBridgeType_new";

DROP TYPE "WhatsAppBridgeType";
ALTER TYPE "WhatsAppBridgeType_new" RENAME TO "WhatsAppBridgeType";

ALTER TABLE "HistoryRecoveryRequest"
  RENAME COLUMN "baileysRequestId" TO "bridgeRequestId";
ALTER INDEX "HistoryRecoveryRequest_baileysRequestId_idx"
  RENAME TO "HistoryRecoveryRequest_bridgeRequestId_idx";
