// Run locally with server credentials; never shipped as a public admin bootstrap endpoint.
import { services } from "../server/firebase.mjs";
import { validId } from "../server/policy.mjs";
import { usernameEmail } from "../shared/identity.mjs";
const uid = validId(process.argv[2]);
const username = process.argv[3];
const email = usernameEmail(username);
const { auth, store } = services();
const user = await auth.getUser(uid);
const admins = await store
  .collection("profiles")
  .where("role", "==", "admin")
  .limit(1)
  .get();
if (!admins.empty)
  throw new Error("An admin already exists. Bootstrap is disabled.");
await auth.updateUser(uid, { email, displayName: username.trim() });
await store.runTransaction(async (tx) => {
  const lock = store.doc("system/bootstrap");
  if ((await tx.get(lock)).exists) throw new Error("Already bootstrapped");
  tx.create(store.doc(`profiles/${uid}`), {
    name: username.trim(),
    role: "admin",
    category_ids: [],
    disabled: false,
  });
  tx.create(store.doc("categories/general"), {
    id: "general",
    name: "團隊 / Team",
  });
  tx.create(store.doc("channels/general"), {
    id: "general",
    name: "一般交流 / General",
    category_id: "general",
  });
  tx.create(lock, { completedAt: new Date().toISOString() });
  tx.set(store.doc("system/workspace"), { revision: Date.now() });
});
console.log("Admin profile and initial channel created.");
