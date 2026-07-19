export function isTrustedProfilePictureUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && (host === "whatsapp.net" || host.endsWith(".whatsapp.net") || host === "fbcdn.net" || host.endsWith(".fbcdn.net") || host === "facebook.com" || host.endsWith(".facebook.com"));
  } catch {
    return false;
  }
}
