import { test } from "node:test";
import assert from "node:assert/strict";
process.env.NODE_ENV = "test";
process.env.APP_ORIGIN = "https://chat.example.test";
const { default: handler } = await import("../api/workspace.mjs");
const { services } = await import("../server/firebase.mjs");
const { auth, store } = services();
async function token(uid) {
  const custom = await auth.createCustomToken(uid);
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    },
  );
  const data = await response.json();
  assert.ok(data.idToken, "emulator sign-in succeeds");
  return data.idToken;
}
async function call(action, jwt, body = {}, method = "POST") {
  const result = { headers: {}, status: 200 };
  const res = {
    setHeader(k, v) {
      result.headers[k] = v;
    },
    status(s) {
      result.status = s;
      return this;
    },
    json(data) {
      result.body = data;
      return this;
    },
    send(data) {
      result.body = data;
      return this;
    },
  };
  await handler(
    {
      url: `/api/workspace?action=${action}`,
      method,
      headers: {
        origin: process.env.APP_ORIGIN,
        ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
      },
      body,
    },
    res,
  );
  return result;
}
test("server API verifies identity, role, category, idempotency and revocation", async () => {
  const adminId = "api-admin",
    playerId = "api-player",
    outsiderId = "api-outsider";
  await Promise.all(
    [adminId, playerId, outsiderId].map((uid) => auth.createUser({ uid })),
  );
  await store
    .doc(`profiles/${adminId}`)
    .set({ name: "Admin", role: "admin", disabled: false, category_ids: [] });
  await store.doc(`profiles/${playerId}`).set({
    name: "Player",
    role: "player",
    disabled: false,
    category_ids: ["api-general"],
  });
  await store.doc("categories/api-general").set({ name: "General" });
  await store.doc("categories/api-secret").set({ name: "Secret" });
  await store
    .doc("channels/api-general")
    .set({ category_id: "api-general", name: "General" });
  await store
    .doc("channels/api-secret")
    .set({ category_id: "api-secret", name: "Secret" });
  await store
    .doc("images/api-secret")
    .set({ channel_id: "api-secret", driveId: "never-fetch-this" });
  const [admin, player, outsider] = await Promise.all(
    [adminId, playerId, outsiderId].map(token),
  );
  assert.equal((await call("snapshot")).status, 401);
  assert.equal((await call("snapshot", "bad-token")).status, 401);
  assert.equal((await call("snapshot", outsider)).status, 403);
  const visible = await call("snapshot", player);
  assert.equal(visible.status, 200);
  assert.equal(
    visible.body.channels.some((c) => c.id === "api-secret"),
    false,
  );
  assert.equal(
    (await call("category", player, { name: "Hacked" })).status,
    403,
  );
  assert.equal(
    (await call("create-user", player, { name: "Hacked" })).status,
    403,
  );
  assert.equal(
    (
      await call("send", player, {
        id: "bad",
        channel_id: "api-secret",
        body: "forbidden",
      })
    ).status,
    403,
  );
  assert.equal(
    (await call("image&id=api-secret", player, {}, "GET")).status,
    403,
  );
  const input = {
    id: "api-message",
    channel_id: "api-general",
    body: "hello",
    user_id: adminId,
  };
  const sent = await call("send", player, input);
  assert.equal(sent.status, 200);
  assert.equal(
    sent.body.message.user_id,
    playerId,
    "caller identity cannot be spoofed",
  );
  assert.equal(sent.body.notification, "not_configured");
  assert.deepEqual(
    (await call("send", player, input)).body.message,
    sent.body.message,
    "retries do not duplicate",
  );
  assert.equal((await call("send", admin, input)).status, 409);
  const created = await call("create-user", admin, {
    name: "Member",
    username: "Member",
    password: "test1234",
    role: "user",
    category_ids: ["api-general"],
  });
  assert.equal(created.status, 200);
  assert.equal(
    (await auth.getUser(created.body.id)).email,
    "member@login.harbor.invalid",
  );
  assert.equal(
    (
      await call("create-user", admin, {
        name: "Duplicate",
        username: "MEMBER",
        password: "test1234",
        role: "user",
      })
    ).status,
    409,
  );
  assert.equal(
    (await store.doc(`profiles/${created.body.id}`).get()).data().role,
    "user",
  );
  assert.equal(
    (
      await call("create-user", admin, {
        name: "No",
        username: "invalid_admin",
        password: "test-only-password-123",
        role: "admin",
      })
    ).status,
    400,
  );
  assert.equal(
    (await call("access", admin, { target: playerId, category_ids: [] }))
      .status,
    200,
  );
  assert.equal(
    (await call("send", player, { ...input, id: "api-after-revoke" })).status,
    403,
  );
  await store.doc(`profiles/${playerId}`).update({ disabled: true });
  assert.equal((await call("snapshot", player)).status, 403);
  await auth.updateUser(adminId, { disabled: true });
  assert.equal((await call("snapshot", admin)).status, 401);
});
