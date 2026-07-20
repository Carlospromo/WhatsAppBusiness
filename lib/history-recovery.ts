export function validRecoveryRange(from: unknown, to: unknown) {
  const fromAt = typeof from === "string" ? new Date(from) : null;
  const toAt = typeof to === "string" ? new Date(to) : null;
  if (!fromAt || !toAt || Number.isNaN(fromAt.getTime()) || Number.isNaN(toAt.getTime()) || fromAt > toAt || toAt > new Date() || toAt.getTime() - fromAt.getTime() > 31 * 86_400_000) return null;
  return { fromAt, toAt };
}
