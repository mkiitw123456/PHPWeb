import { OAuth2Client } from "google-auth-library";
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { services } from "./firebase.mjs";
import { HttpError, requireAdmin } from "./policy.mjs";
export function origin() {
  const value = process.env.APP_ORIGIN;
  if (!value || !/^https:\/\/[^/]+$/.test(value))
    throw new HttpError(503, "APP_ORIGIN must be an HTTPS origin");
  return value;
}
function oauth() {
  if (
    !process.env.GOOGLE_DRIVE_CLIENT_ID ||
    !process.env.GOOGLE_DRIVE_CLIENT_SECRET
  )
    throw new HttpError(503, "Google Drive OAuth is not configured");
  return new OAuth2Client(
    process.env.GOOGLE_DRIVE_CLIENT_ID,
    process.env.GOOGLE_DRIVE_CLIENT_SECRET,
    `${origin()}/api/workspace?action=drive-callback`,
  );
}
function key() {
  const key = Buffer.from(
    process.env.DRIVE_TOKEN_ENCRYPTION_KEY || "",
    "base64",
  );
  if (key.length !== 32)
    throw new HttpError(503, "Drive encryption key is missing");
  return key;
}
export function seal(value) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}
export function unseal(value) {
  const bytes = Buffer.from(value, "base64");
  const cipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([
    cipher.update(bytes.subarray(28)),
    cipher.final(),
  ]).toString("utf8");
}
export async function startDrive(profile, res) {
  requireAdmin(profile);
  key();
  const client = oauth(),
    state = randomBytes(32).toString("hex"),
    verifier = randomBytes(32).toString("base64url");
  await services()
    .store.doc(`oauthStates/${state}`)
    .set({ uid: profile.id, verifier, expires: Date.now() + 600000 });
  res.setHeader(
    "Set-Cookie",
    `harbor_drive_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/workspace; Max-Age=600`,
  );
  return {
    url: client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent select_account",
      scope: ["https://www.googleapis.com/auth/drive.file"],
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }),
  };
}
export async function finishDrive(req, res) {
  const url = new URL(req.url, origin()),
    state = url.searchParams.get("state") || "",
    cookie =
      (req.headers.cookie || "")
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("harbor_drive_state="))
        ?.split("=")[1] || "";
  if (
    !/^[a-f0-9]{64}$/.test(state) ||
    cookie.length !== state.length ||
    !timingSafeEqual(Buffer.from(cookie), Buffer.from(state))
  )
    throw new HttpError(400, "Invalid OAuth state");
  const { store } = services(),
    ref = store.doc(`oauthStates/${state}`);
  let saved;
  await store.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    saved = s.data();
    if (!saved || saved.expires < Date.now())
      throw new HttpError(400, "OAuth request expired");
    tx.delete(ref);
  });
  requireAdmin((await store.doc(`profiles/${saved.uid}`).get()).data());
  if (url.searchParams.has("error"))
    throw new HttpError(400, "Drive permission was not granted");
  const code = url.searchParams.get("code");
  if (!code) throw new HttpError(400, "Missing authorization code");
  const client = oauth();
  const { tokens } = await client.getToken({
    code,
    codeVerifier: saved.verifier,
  });
  if (!tokens.refresh_token)
    throw new HttpError(400, "Reconnect Google Drive and grant offline access");
  client.setCredentials(tokens);
  const auth = await client.getAccessToken();
  const existing = (await store.doc("integrations/drive").get()).data();
  // Reconnection must retain access to the existing folder; never silently switch accounts.
  let folderId = existing?.folderId;
  if (folderId) {
    const check = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,trashed`,
      {
        headers: { Authorization: `Bearer ${auth.token}` },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!check.ok || (await check.json()).trashed)
      throw new HttpError(
        400,
        "Reconnect using the original Drive owner account",
      );
  } else {
    const r = await fetch(
      "https://www.googleapis.com/drive/v3/files?fields=id",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Harbor private chat images",
          mimeType: "application/vnd.google-apps.folder",
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!r.ok) throw new HttpError(502, "Could not create the Drive folder");
    folderId = (await r.json()).id;
  }
  await store.doc("integrations/drive").set({
    folderId,
    refreshToken: seal(tokens.refresh_token),
    connectedAt: new Date().toISOString(),
    connectedBy: saved.uid,
  });
  res.setHeader(
    "Set-Cookie",
    "harbor_drive_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/workspace; Max-Age=0",
  );
  res.writeHead(303, { Location: origin() + "/?drive=connected" });
  res.end();
}
async function authorized() {
  const record = (
    await services().store.doc("integrations/drive").get()
  ).data();
  if (!record?.refreshToken)
    throw new HttpError(503, "Google Drive is not connected");
  const client = oauth();
  client.setCredentials({ refresh_token: unseal(record.refreshToken) });
  const { token } = await client.getAccessToken();
  return { token, folderId: record.folderId };
}
export async function uploadImage(id, bytes) {
  const { token, folderId } = await authorized();
  const boundary = "harbor_" + randomBytes(16).toString("hex");
  const metadata = JSON.stringify({ name: `${id}.webp`, parents: [folderId] });
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: image/webp\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const r = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: payload,
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!r.ok) throw new HttpError(502, "Google Drive upload failed");
  return (await r.json()).id;
}
export async function downloadImage(id) {
  const { token } = await authorized();
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!r.ok) throw new HttpError(502, "Google Drive download failed");
  return Buffer.from(await r.arrayBuffer());
}
export async function trashImage(id) {
  const { token } = await authorized();
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ trashed: true }),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!r.ok) throw new HttpError(502, "Drive cleanup failed");
}
