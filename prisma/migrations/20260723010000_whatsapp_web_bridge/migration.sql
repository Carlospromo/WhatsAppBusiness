-- Generated from the Prisma schema change for the whatsapp-web.js bridge.
-- Existing legacy sessions and data remain untouched; each old connection is
-- explicitly marked as legacy and requires an administrator-initiated relink.
CREATE TYPE "WhatsAppBridgeType" AS ENUM ('BAILEYS_LEGACY', 'WWEBJS');

ALTER TABLE "WhatsAppConnection"
  ADD COLUMN "bridgeType" "WhatsAppBridgeType" NOT NULL DEFAULT 'WWEBJS';

UPDATE "WhatsAppConnection"
SET "bridgeType" = 'BAILEYS_LEGACY',
    "status" = 'DISCONNECTED',
    "qrCode" = NULL,
    "qrExpiresAt" = NULL,
    "lastError" = 'La conexión anterior requiere una nueva vinculación con WhatsApp Web.';

CREATE TABLE "ConversationExternalIdentity" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "bridgeType" "WhatsAppBridgeType" NOT NULL,
  "externalChatId" TEXT NOT NULL,
  "type" "ConversationType" NOT NULL,
  "normalizedPhone" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConversationExternalIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConversationExternalIdentity_accountId_bridgeType_externalChatId_key"
  ON "ConversationExternalIdentity"("accountId", "bridgeType", "externalChatId");
CREATE INDEX "ConversationExternalIdentity_conversationId_idx"
  ON "ConversationExternalIdentity"("conversationId");
CREATE INDEX "ConversationExternalIdentity_accountId_normalizedPhone_idx"
  ON "ConversationExternalIdentity"("accountId", "normalizedPhone");

ALTER TABLE "ConversationExternalIdentity"
  ADD CONSTRAINT "ConversationExternalIdentity_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationExternalIdentity"
  ADD CONSTRAINT "ConversationExternalIdentity_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
