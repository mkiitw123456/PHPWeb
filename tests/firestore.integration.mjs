import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  updateDoc,
  documentId,
} from "firebase/firestore";
test("real Firestore rules protect chats, profiles, Drive secrets and all client writes", async () => {
  const env = await initializeTestEnvironment({
    projectId: "demo-harbor",
    firestore: { rules: await readFile("firestore.rules", "utf8") },
  });
  try {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await Promise.all([
        setDoc(doc(db, "profiles/admin"), {
          name: "Admin",
          role: "admin",
          category_ids: [],
          disabled: false,
        }),
        setDoc(doc(db, "profiles/player"), {
          name: "Player",
          role: "player",
          category_ids: ["general"],
          disabled: false,
        }),
        setDoc(doc(db, "profiles/disabled"), {
          name: "Disabled",
          role: "admin",
          category_ids: [],
          disabled: true,
        }),
        setDoc(doc(db, "channels/public"), { category_id: "general" }),
        setDoc(doc(db, "channels/private"), { category_id: "secret" }),
        setDoc(doc(db, "channels/public/messages/one"), {
          body: "visible",
          created_at: "2026-09-24T00:00:00.000Z",
        }),
        setDoc(doc(db, "channels/private/messages/two"), {
          body: "secret",
          created_at: "2026-09-24T00:00:00.000Z",
        }),
        setDoc(doc(db, "integrations/drive"), { refreshToken: "test-secret" }),
        setDoc(doc(db, "images/one"), { driveId: "hidden" }),
        setDoc(doc(db, "system/workspace"), { revision: 1 }),
      ]);
    });
    const user = env.authenticatedContext("player").firestore(),
      admin = env.authenticatedContext("admin").firestore(),
      outsider = env.authenticatedContext("self-registered").firestore(),
      anon = env.unauthenticatedContext().firestore();
    await assertSucceeds(
      getDocs(
        query(
          collection(user, "channels/public/messages"),
          orderBy("created_at", "desc"),
          orderBy(documentId(), "desc"),
          limit(40),
        ),
      ),
    );
    await assertFails(getDoc(doc(user, "channels/private/messages/two")));
    await assertSucceeds(getDoc(doc(user, "system/workspace")));
    await assertFails(getDoc(doc(outsider, "system/workspace")));
    await assertFails(
      updateDoc(doc(user, "system/workspace"), { revision: 2 }),
    );
    await assertSucceeds(getDoc(doc(admin, "channels/private/messages/two")));
    await assertFails(getDoc(doc(outsider, "channels/public/messages/one")));
    await assertFails(getDoc(doc(anon, "channels/public/messages/one")));
    await assertFails(
      getDoc(
        doc(
          env.authenticatedContext("disabled").firestore(),
          "channels/public/messages/one",
        ),
      ),
    );
    await assertFails(
      updateDoc(doc(user, "profiles/player"), { role: "admin" }),
    );
    await assertFails(
      setDoc(doc(user, "channels/public/messages/spoof"), { body: "spoof" }),
    );
    await assertFails(setDoc(doc(admin, "profiles/new"), { role: "admin" }));
    await assertFails(getDoc(doc(admin, "integrations/drive")));
    await assertFails(getDoc(doc(user, "images/one")));
    await env.withSecurityRulesDisabled((ctx) =>
      updateDoc(doc(ctx.firestore(), "profiles/player"), { category_ids: [] }),
    );
    await assertFails(getDoc(doc(user, "channels/public/messages/one")));
    assert.ok(true);
  } finally {
    await env.cleanup();
  }
});
