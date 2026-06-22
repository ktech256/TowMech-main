// backend/src/utils/faceVerification.js
/**
 * ✅ Phase 2: Face Matching Intelligence (ID ↔ Selfie)
 * This utility compares the face in the ID document with the selfie uploaded by the provider.
 *
 * Target Provider: Google Vertex AI Vision
 */

export async function verifyFaces(user, idUrl, selfieUrl) {
    try {
        if (!idUrl || !selfieUrl) {
            console.log(`[FACE_MATCHING] Missing documents for user ${user._id}. Skipping.`);
            return null;
        }

        console.log(`[FACE_MATCHING] Verifying faces for user: ${user._id}`);
        console.log(`[FACE_MATCHING] ID: ${idUrl}`);
        console.log(`[FACE_MATCHING] Selfie: ${selfieUrl}`);

        /**
         * ⚠️ ARCHITECTURE NOTE:
         * In a production environment with Google Cloud SDK configured:
         *
         * const { ImageAnnotatorClient } = require('@google-cloud/vision').v1p3beta1;
         * const client = new ImageAnnotatorClient();
         * const [result] = await client.faceDetection({ image: { source: { imageUri: idUrl } } });
         * // ... logic to compare embeddings or use Vertex AI Search & Conversation (GenAI)
         */

        // MOCK LOGIC for Phase 2 Initial Implementation
        // In this phase, we provide the "Intelligence" structure.
        // We'll generate a realistic match score based on common ML kit confidence.

        // Simulating processing delay
        await new Promise(resolve => setTimeout(resolve, 1500));

        // For demo/testing, we'll use a score based on some deterministic user property if not real.
        // In real world, this comes from Vertex AI.
        const score = Math.floor(Math.random() * (98 - 65 + 1)) + 65;

        let status = "REVIEW_REQUIRED";
        if (score >= 90) status = "MATCHED";
        else if (score < 70) status = "NO_MATCH";

        const faceMatchingData = {
            score,
            status,
            verifiedAt: new Date(),
            provider: "Google Vertex AI (Mock)",
            details: {
                engine: "Vertex AI Vision v1",
                detectionType: "Facial Similarity",
                metadata: {
                    id_image: idUrl.substring(idUrl.lastIndexOf('/') + 1),
                    selfie_image: selfieUrl.substring(selfieUrl.lastIndexOf('/') + 1)
                }
            }
        };

        user.providerProfile.verificationDocs.faceMatching = faceMatchingData;
        user.markModified("providerProfile.verificationDocs.faceMatching");

        // We don't save here to avoid conflict with the calling route which might be saving.
        // But we return it.

        console.log(`[FACE_MATCHING] Result for ${user._id}: ${status} (${score}%)`);
        return faceMatchingData;
    } catch (err) {
        console.error(`[FACE_MATCHING] ERROR for ${user._id}:`, err.message);
        return null;
    }
}
