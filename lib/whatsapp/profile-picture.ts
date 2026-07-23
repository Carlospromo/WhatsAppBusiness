import { prisma } from "@/lib/prisma";
import { isTrustedProfilePictureUrl } from "./profile-picture-url";

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

type ProfilePictureSocket = {
  getProfilePicUrl: (chatId: string) => Promise<string | undefined>;
};

async function needsRefresh(accountId: string, jid: string) {
  if (!jid.endsWith("@c.us")) return false;
  const contact = await prisma.contact.findUnique({
    where: { accountId_jid: { accountId, jid } },
    select: { profilePictureUpdatedAt: true },
  });
  return Boolean(contact && (!contact.profilePictureUpdatedAt || contact.profilePictureUpdatedAt.getTime() < Date.now() - REFRESH_INTERVAL_MS));
}

export async function refreshContactProfilePicture(accountId: string, socket: ProfilePictureSocket, jid: string) {
  if (!await needsRefresh(accountId, jid)) return;
  let profilePictureUrl: string | null = null;
  try {
    const candidate = await socket.getProfilePicUrl(jid);
    profilePictureUrl = candidate && isTrustedProfilePictureUrl(candidate) ? candidate : null;
  } catch {
    // Profile pictures are optional and unavailable for many WhatsApp contacts.
  }
  await prisma.contact.updateMany({
    where: { accountId, jid },
    data: { profilePictureUrl, profilePictureUpdatedAt: new Date() },
  });
}

export async function refreshRecentContactProfilePictures(accountId: string, socket: ProfilePictureSocket, limit = 12) {
  const conversations = await prisma.conversation.findMany({
    where: { accountId, type: "DIRECT", contactId: { not: null } },
    select: { contact: { select: { jid: true } } },
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  for (const conversation of conversations) {
    if (conversation.contact) await refreshContactProfilePicture(accountId, socket, conversation.contact.jid);
  }
}
