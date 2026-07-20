-- CreateEnum
CREATE TYPE "HistoryRecoveryStatus" AS ENUM ('PENDING', 'WAITING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "HistoryRecoveryRequest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "fromAt" TIMESTAMP(3) NOT NULL,
    "toAt" TIMESTAMP(3) NOT NULL,
    "status" "HistoryRecoveryStatus" NOT NULL DEFAULT 'PENDING',
    "anchorExternalId" TEXT NOT NULL,
    "anchorSentAt" TIMESTAMP(3) NOT NULL,
    "anchorFromMe" BOOLEAN NOT NULL DEFAULT false,
    "baileysRequestId" TEXT,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "receivedCount" INTEGER NOT NULL DEFAULT 0,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "safeError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "HistoryRecoveryRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HistoryRecoveryRequest_accountId_status_createdAt_idx" ON "HistoryRecoveryRequest"("accountId", "status", "createdAt");
CREATE INDEX "HistoryRecoveryRequest_conversationId_createdAt_idx" ON "HistoryRecoveryRequest"("conversationId", "createdAt");
CREATE INDEX "HistoryRecoveryRequest_baileysRequestId_idx" ON "HistoryRecoveryRequest"("baileysRequestId");

ALTER TABLE "HistoryRecoveryRequest" ADD CONSTRAINT "HistoryRecoveryRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HistoryRecoveryRequest" ADD CONSTRAINT "HistoryRecoveryRequest_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HistoryRecoveryRequest" ADD CONSTRAINT "HistoryRecoveryRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
