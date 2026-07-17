-- Persistent, restart-safe manual outgoing-message queue.
CREATE TABLE "OutboundMessageRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "safeError" TEXT,
  "externalId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "sentAt" DATETIME,
  CONSTRAINT "OutboundMessageRequest_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OutboundMessageRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OutboundMessageRequest_externalId_key" ON "OutboundMessageRequest"("externalId");
CREATE INDEX "OutboundMessageRequest_status_createdAt_idx" ON "OutboundMessageRequest"("status", "createdAt");
CREATE INDEX "OutboundMessageRequest_conversationId_idx" ON "OutboundMessageRequest"("conversationId");
