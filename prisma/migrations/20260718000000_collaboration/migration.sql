ALTER TABLE "Conversation" ADD COLUMN "assignedToId" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "assignedAt" DATETIME;
CREATE INDEX "Conversation_assignedToId_idx" ON "Conversation"("assignedToId");
CREATE TABLE "ConversationNote" (
  "id" TEXT NOT NULL PRIMARY KEY, "conversationId" TEXT NOT NULL, "authorId" TEXT NOT NULL,
  "body" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ConversationNote_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConversationNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ConversationNote_conversationId_createdAt_idx" ON "ConversationNote"("conversationId", "createdAt");
CREATE TABLE "ConversationTag" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "color" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL);
CREATE UNIQUE INDEX "ConversationTag_name_key" ON "ConversationTag"("name");
CREATE TABLE "_ConversationToConversationTag" ("A" TEXT NOT NULL, "B" TEXT NOT NULL, CONSTRAINT "_ConversationToConversationTag_A_fkey" FOREIGN KEY ("A") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "_ConversationToConversationTag_B_fkey" FOREIGN KEY ("B") REFERENCES "ConversationTag"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE UNIQUE INDEX "_ConversationToConversationTag_AB_unique" ON "_ConversationToConversationTag"("A", "B");
CREATE INDEX "_ConversationToConversationTag_B_index" ON "_ConversationToConversationTag"("B");
