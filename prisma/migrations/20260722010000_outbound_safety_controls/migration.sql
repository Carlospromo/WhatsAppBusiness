ALTER TABLE "WhatsAppConnection"
  ADD COLUMN "outboundPausedAt" TIMESTAMP(3),
  ADD COLUMN "outboundPauseEndsAt" TIMESTAMP(3),
  ADD COLUMN "outboundPauseReason" TEXT;
