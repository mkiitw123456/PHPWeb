export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function requireAdmin(profile) {
  if (profile?.role !== "admin" || profile.disabled)
    throw new HttpError(403, "Forbidden");
}
export function canCategory(profile, id) {
  return (
    !!profile &&
    !profile.disabled &&
    (profile.role === "admin" || (profile.category_ids || []).includes(id))
  );
}
export function validId(value) {
  if (typeof value !== "string" || !/^[-a-zA-Z0-9_]{1,128}$/.test(value))
    throw new HttpError(400, "Invalid identifier");
  return value;
}
export function nameValue(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 60)
    throw new HttpError(400, "Invalid name");
  return value.trim();
}
export function imageBytes(base64) {
  if (
    typeof base64 !== "string" ||
    base64.length > 4194327 ||
    !/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(base64)
  )
    throw new HttpError(400, "Invalid WebP image");
  const bytes = Buffer.from(base64.split(",")[1], "base64");
  if (
    bytes.length > 3 * 1024 * 1024 ||
    bytes.length < 12 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP"
  )
    throw new HttpError(400, "Invalid WebP image");
  return bytes;
}
export function messageInput(input) {
  const id = validId(input.id),
    channel_id = validId(input.channel_id);
  if (
    typeof input.body !== "string" ||
    input.body.length > 4000 ||
    (!input.body.trim() && !input.image)
  )
    throw new HttpError(400, "Invalid message");
  return {
    id,
    channel_id,
    body: input.body.trim(),
    bytes: input.image ? imageBytes(input.image) : null,
  };
}
