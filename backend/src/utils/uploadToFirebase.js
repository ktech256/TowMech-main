import admin, { initFirebase } from "../config/firebase.js";

/**
 * Uploads a file buffer to Firebase Storage and returns a public URL.
 */
export async function uploadToFirebase(fileBuffer, fileName, mimeType) {
  initFirebase();

  const bucket = admin.storage().bucket();
  const file = bucket.file(fileName);

  await file.save(fileBuffer, {
    metadata: {
      contentType: mimeType,
    },
  });

  // ✅ make it publicly readable (simple MVP)
  await file.makePublic();

  return `https://storage.googleapis.com/${bucket.name}/${file.name}`;
}
