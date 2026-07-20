-- CreateEnum
CREATE TYPE "ReadReceiptStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "receiptParticipant" TEXT;

-- CreateTable
CREATE TABLE "ReadReceiptRequest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "ReadReceiptStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "safeError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "ReadReceiptRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadReceiptMessage" (
    "requestId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,

    CONSTRAINT "ReadReceiptMessage_pkey" PRIMARY KEY ("requestId", "messageId")
);

-- CreateIndex
CREATE INDEX "ReadReceiptRequest_accountId_status_createdAt_idx" ON "ReadReceiptRequest"("accountId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ReadReceiptRequest_conversationId_idx" ON "ReadReceiptRequest"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "ReadReceiptMessage_messageId_key" ON "ReadReceiptMessage"("messageId");

-- AddForeignKey
ALTER TABLE "ReadReceiptRequest" ADD CONSTRAINT "ReadReceiptRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadReceiptRequest" ADD CONSTRAINT "ReadReceiptRequest_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadReceiptRequest" ADD CONSTRAINT "ReadReceiptRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadReceiptMessage" ADD CONSTRAINT "ReadReceiptMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ReadReceiptRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadReceiptMessage" ADD CONSTRAINT "ReadReceiptMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
