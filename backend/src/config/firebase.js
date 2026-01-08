import admin from "firebase-admin";

let firebaseApp;

export const initFirebase = () => {
  if (firebaseApp) return firebaseApp; // ✅ prevent re-init

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  // ✅ NEW: Storage bucket for Firebase Storage
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Missing Firebase environment variables. Required: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY"
    );
  }

  // ✅ NEW: Ensure bucket exists for Storage uploads
  if (!storageBucket) {
    throw new Error(
      "Missing Firebase Storage bucket env var. Required: FIREBASE_STORAGE_BUCKET"
    );
  }

  // ✅ Render fix: replace literal \\n with actual new lines
  // ✅ remove quotes if Render adds them
  // ✅ trim whitespace
  privateKey = privateKey.replace(/\\n/g, "\n").replace(/"/g, "").trim();

  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),

    // ✅ NEW: Enables Firebase Storage
    storageBucket: storageBucket,
  });

  return firebaseApp;
};

export default admin;
