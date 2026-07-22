ALTER TYPE "OutboundMessageStatus" ADD VALUE IF NOT EXISTS 'CANCELED';

ALTER TABLE "OutboundMessageRequest"
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3);

CREATE INDEX "OutboundMessageRequest_accountId_status_lastAttemptAt_idx"
  ON "OutboundMessageRequest"("accountId", "status", "lastAttemptAt");
