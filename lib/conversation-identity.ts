type AddressBookContact = { displayName: string; origin: string } | null;
type TechnicalContact = {
  id: string;
  displayName: string | null;
  pushName: string | null;
  phone: string | null;
  profilePictureUpdatedAt: Date | null;
  addressBookContact: AddressBookContact;
};

export function phoneFromConversationJid(jid: string) {
  if (!jid.endsWith("@s.whatsapp.net")) return null;
  const digits = jid.slice(0, jid.indexOf("@")).replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? `+${digits}` : null;
}

/**
 * Keeps the WhatsApp JID server-side while making legacy direct conversations
 * identifiable even when their technical Contact relation was not persisted.
 */
export function visibleConversation<T extends { jid: string; contact: TechnicalContact | null }>(conversation: T) {
  const { jid, contact, ...rest } = conversation;
  const phone = contact?.phone ?? phoneFromConversationJid(jid);
  return {
    ...rest,
    contact: contact
      ? { ...contact, phone }
      : phone
        ? { id: null, displayName: null, pushName: null, phone, profilePictureUpdatedAt: null, addressBookContact: null }
        : null,
  };
}
