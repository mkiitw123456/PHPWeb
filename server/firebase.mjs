import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { HttpError } from "./policy.mjs";
export function services() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (
      process.env.NODE_ENV === "test" &&
      process.env.FIRESTORE_EMULATOR_HOST &&
      process.env.FIREBASE_AUTH_EMULATOR_HOST
    )
      initializeApp({ projectId: "demo-harbor" });
    else {
      if (!raw) throw new HttpError(503, "Server setup is incomplete");
      initializeApp({ credential: cert(JSON.parse(raw)) });
    }
  }
  return { auth: getAuth(), store: getFirestore() };
}
export async function caller(req) {
  const { auth, store } = services();
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer "))
    throw new HttpError(401, "Sign in required");
  let token;
  try {
    token = await auth.verifyIdToken(header.slice(7), true);
  } catch {
    throw new HttpError(401, "Session expired");
  }
  const doc = await store.doc(`profiles/${token.uid}`).get();
  const profile = doc.data();
  if (!profile || profile.disabled)
    throw new HttpError(403, "Workspace access is not enabled");
  return { ...profile, id: token.uid };
}
