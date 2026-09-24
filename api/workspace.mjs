import { caller, services } from "../server/firebase.mjs";
import { usernameEmail } from "../shared/identity.mjs";
import {
  HttpError,
  requireAdmin,
  canCategory,
  validId,
  nameValue,
  messageInput,
} from "../server/policy.mjs";
import {
  startDrive,
  finishDrive,
  uploadImage,
  downloadImage,
  trashImage,
  origin,
} from "../server/drive.mjs";
export const config = { maxDuration: 60 };
const publicProfile = (p) => ({ id: p.id, name: p.name, role: p.role });
async function accessChannel(profile, id, tx) {
  const { store } = services();
  const ref = store.doc(`channels/${validId(id)}`);
  const doc = await (tx ? tx.get(ref) : ref.get());
  if (!doc.exists || !canCategory(profile, doc.data().category_id))
    throw new HttpError(403, "Forbidden");
  return doc.data();
}
async function validateCategories(ids) {
  if (!Array.isArray(ids) || ids.length > 100)
    throw new HttpError(400, "Invalid categories");
  const unique = [...new Set(ids.map(validId))];
  if (unique.length) {
    const docs = await services().store.getAll(
      ...unique.map((id) => services().store.doc(`categories/${id}`)),
    );
    if (docs.some((d) => !d.exists))
      throw new HttpError(400, "Unknown category");
  }
  return unique;
}
async function workspace(profile) {
  const { store } = services();
  const [ps, cs, chs] = await Promise.all(
    ["profiles", "categories", "channels"].map((c) =>
      store.collection(c).get(),
    ),
  );
  const categories = cs.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((c) => canCategory(profile, c.id));
  const ids = new Set(categories.map((c) => c.id));
  const people = ps.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter(
      (p) =>
        !p.disabled &&
        (profile.role === "admin" ||
          p.id === profile.id ||
          p.role === "admin" ||
          p.category_ids?.some((id) => ids.has(id))),
    );
  return {
    profiles: people.map(publicProfile),
    categories,
    channels: chs.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => ids.has(c.category_id)),
    grants: (profile.role === "admin" ? people : [profile]).flatMap((p) =>
      (p.category_ids || []).map((category_id) => ({
        user_id: p.id,
        category_id,
      })),
    ),
    messages: [],
  };
}
async function notify(message) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return "not_configured";
  if (!/^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(webhook))
    return "failed";
  const ref = services().store.doc(`notifications/${message.id}`);
  try {
    await ref.create({ status: "sending", created_at: message.created_at });
  } catch (e) {
    if (e.code === 6 || e.code === "already-exists") return "already_claimed";
    return "failed";
  }
  let status = "failed";
  try {
    const result = await fetch(webhook + "?wait=true", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Harbor",
        content: `Harbor 有新訊息 / May bagong mensahe.\n${origin()}`,
        allowed_mentions: { parse: [] },
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (result.ok) status = "sent";
  } catch {}
  await ref.update({ status });
  return status;
}
async function send(profile, input) {
  const value = messageInput(input),
    { store } = services(),
    ref = store.doc(`channels/${value.channel_id}/messages/${value.id}`),
    claim = store.doc(`submissions/${profile.id}_${value.id}`);
  await accessChannel(profile, value.channel_id);
  const old = await ref.get();
  if (old.exists) {
    if (old.data().user_id !== profile.id)
      throw new HttpError(409, "Message ID is already used");
    return { message: old.data(), notification: "already_claimed" };
  }
  await store.runTransaction(async (tx) => {
    const rate = store.doc(`rateLimits/${profile.id}`),
      [r, c] = await Promise.all([tx.get(rate), tx.get(claim)]);
    if (c.exists)
      throw new HttpError(
        409,
        "Message is still processing. Refresh before retrying.",
      );
    const recent = (r.data()?.times || []).filter(
      (t) => t > Date.now() - 10000,
    );
    if (recent.length >= 10) throw new HttpError(429, "傳送太快，請稍後再試");
    tx.set(rate, { times: [...recent, Date.now()] });
    tx.create(claim, { status: "pending", createdAt: Date.now() });
  });
  let driveId,
    committed = false;
  try {
    if (value.bytes) driveId = await uploadImage(value.id, value.bytes);
    const message = {
      id: value.id,
      channel_id: value.channel_id,
      user_id: profile.id,
      body: value.body,
      image_path: driveId ? value.id : null,
      created_at: new Date().toISOString(),
    };
    await store.runTransaction(async (tx) => {
      const fresh = (await tx.get(store.doc(`profiles/${profile.id}`))).data();
      await accessChannel(fresh, value.channel_id, tx);
      if (driveId)
        tx.create(store.doc(`images/${value.id}`), {
          channel_id: value.channel_id,
          driveId,
          user_id: profile.id,
        });
      tx.create(ref, message);
      tx.set(claim, { status: "sent", createdAt: Date.now() });
    });
    committed = true;
    let notification = "failed";
    try {
      notification = await notify(message);
    } catch {}
    return { message, notification };
  } catch (e) {
    if (!committed) {
      if (driveId) {
        try {
          await trashImage(driveId);
        } catch {
          console.error("Orphan image cleanup required", value.id);
          await store
            .doc(`cleanup/${value.id}`)
            .set({ driveId, createdAt: Date.now() });
        }
      }
      await claim.delete();
    }
    throw e;
  }
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const action =
    new URL(req.url, "https://local.invalid").searchParams.get("action") ||
    req.query?.action;
  try {
    if (action === "drive-callback" && req.method === "GET")
      return await finishDrive(req, res);
    if (req.method !== "POST" && !(req.method === "GET" && action === "image"))
      throw new HttpError(405, "Method not allowed");
    if (
      req.headers.origin &&
      req.headers.origin !== process.env.APP_ORIGIN &&
      process.env.NODE_ENV !== "development"
    )
      throw new HttpError(403, "Origin not allowed");
    const profile = await caller(req),
      { store, auth } = services();
    const input =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    if (action === "snapshot")
      return res.status(200).json(await workspace(profile));
    if (action === "send")
      return res.status(200).json(await send(profile, input));
    if (action === "image") {
      const id = validId(
        new URL(req.url, "https://local.invalid").searchParams.get("id"),
      );
      const img = (await store.doc(`images/${id}`).get()).data();
      if (!img) throw new HttpError(404, "Image not found");
      await accessChannel(profile, img.channel_id);
      const bytes = await downloadImage(img.driveId);
      if (bytes.length > 3 * 1024 * 1024)
        throw new HttpError(502, "Image exceeds size limit");
      res.setHeader("Content-Type", "image/webp");
      return res.status(200).send(bytes);
    }
    requireAdmin(profile);
    if (action === "drive-status")
      return res.status(200).json({
        connected: (await store.doc("integrations/drive").get()).exists,
      });
    if (action === "drive-start")
      return res.status(200).json(await startDrive(profile, res));
    if (action === "category" || action === "channel") {
      const name = nameValue(input.name),
        ref = store
          .collection(action === "category" ? "categories" : "channels")
          .doc();
      const item = { id: ref.id, name };
      if (action === "channel") {
        item.category_id = validId(input.category_id);
        if (!(await store.doc(`categories/${item.category_id}`).get()).exists)
          throw new HttpError(400, "Unknown category");
      }
      const batch = store.batch();
      batch.create(ref, item);
      batch.set(store.doc("system/workspace"), { revision: Date.now() });
      await batch.commit();
      return res.status(200).json(item);
    }
    if (action === "access") {
      const target = validId(input.target),
        ids = await validateCategories(input.category_ids);
      await store.runTransaction(async (tx) => {
        const ref = store.doc(`profiles/${target}`),
          doc = await tx.get(ref);
        if (!doc.exists || doc.data().role === "admin")
          throw new HttpError(400, "Invalid member");
        tx.update(ref, { category_ids: ids });
        tx.set(store.doc("system/workspace"), { revision: Date.now() });
      });
      return res.status(200).json({ ok: true });
    }
    if (action === "create-user") {
      let email;
      try {
        email = usernameEmail(input.username);
      } catch (e) {
        throw new HttpError(400, e.message);
      }
      const name = nameValue(input.name),
        ids = await validateCategories(input.category_ids || []);
      if (
        !["user", "player"].includes(input.role) ||
        typeof input.password !== "string" ||
        input.password.length < 8 ||
        input.password.length > 128
      )
        throw new HttpError(400, "請填寫帳號、姓名及至少 8 字元密碼");
      let user;
      try {
        user = await auth.createUser({
          email,
          password: input.password,
          displayName: name,
          emailVerified: false,
        });
        const batch = store.batch();
        batch.create(store.doc(`profiles/${user.uid}`), {
          name,
          role: input.role,
          category_ids: ids,
          disabled: false,
        });
        batch.set(store.doc("system/workspace"), { revision: Date.now() });
        await batch.commit();
        return res.status(200).json({ id: user.uid });
      } catch (e) {
        if (user) await auth.deleteUser(user.uid);
        if (e.code === "auth/email-already-exists")
          throw new HttpError(409, "帳號已存在");
        throw e;
      }
    }
    throw new HttpError(404, "Unknown action");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    console.error("Workspace API failed:", action, e.code || e.name);
    return res
      .status(status)
      .json({ error: status === 500 ? "Server request failed" : e.message });
  }
}
