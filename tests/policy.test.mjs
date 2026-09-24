import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  canCategory,
  requireAdmin,
  messageInput,
  imageBytes,
  validId,
} from "../server/policy.mjs";
import { seal, unseal } from "../server/drive.mjs";
test("category ACL denies unknown, disabled and cross-category members", () => {
  assert.equal(canCategory(null, "private"), false);
  assert.equal(
    canCategory({ role: "user", category_ids: ["general"] }, "private"),
    false,
  );
  assert.equal(
    canCategory({ role: "player", category_ids: ["general"] }, "general"),
    true,
  );
  assert.equal(
    canCategory({ role: "admin", disabled: true }, "general"),
    false,
  );
  assert.equal(canCategory({ role: "admin" }, "private"), true);
  assert.throws(() => requireAdmin({ role: "player" }), /Forbidden/);
});
test("message and upload validation rejects empty, oversized, non-WebP and traversal inputs", () => {
  assert.throws(() => messageInput({ id: "a", channel_id: "b", body: "" }));
  assert.throws(() =>
    messageInput({ id: "a", channel_id: "b", body: "x".repeat(4001) }),
  );
  assert.throws(() => validId("../integrations/drive"));
  assert.throws(() =>
    imageBytes(
      "data:image/webp;base64," +
        Buffer.from("<html>not an image</html>").toString("base64"),
    ),
  );
  assert.throws(() =>
    imageBytes("data:image/webp;base64," + "A".repeat(4194304)),
  );
  assert.equal(
    messageInput({ id: "a", channel_id: "b", body: " hello " }).body,
    "hello",
  );
});
test("Drive refresh tokens encrypt and authenticate at rest", () => {
  process.env.DRIVE_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const secret = "test-only-refresh-token",
    encrypted = seal(secret);
  assert.equal(unseal(encrypted), secret);
  assert.notEqual(encrypted, seal(secret));
  const corrupted = Buffer.from(encrypted, "base64");
  corrupted[15] ^= 1;
  assert.throws(() => unseal(corrupted.toString("base64")));
  delete process.env.DRIVE_TOKEN_ENCRYPTION_KEY;
  assert.throws(() => seal(secret));
});
