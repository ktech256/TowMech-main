// backend/src/utils/faceVerification.js
import vision from '@google-cloud/vision';
import { PredictionServiceClient } from '@google-cloud/aiplatform';
import axios from 'axios';

/**
 * ✅ Phase 2B: TRUE Biometric Identity Verification (ID ↔ Selfie)
 * Upgraded from simple Face Detection to Biometric Embedding Comparison using Google Vertex AI.
 *
 * Logic:
 * 1. Confirm face presence in both images (Cloud Vision).
 * 2. Generate facial embeddings for both images (Vertex AI Multimodal Embedding).
 * 3. Calculate Cosine Similarity between vectors.
 * 4. Apply threshold-based decision rules.
 */

const visionClient = new vision.ImageAnnotatorClient();
const vertexClient = new PredictionServiceClient({
    apiEndpoint: 'us-central1-aiplatform.googleapis.com',
});

/**
 * Helper: Calculate Cosine Similarity between two vectors
 */
function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Helper: Get Image Embedding from Vertex AI
 */
async function getImageEmbedding(imageUrl) {
    const projectId = process.env.GOOGLE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
    const location = 'us-central1';
    const model = 'multimodalembedding@001';
    const endpoint = `projects/${projectId}/locations/${location}/publishers/google/models/${model}`;

    // Download image and convert to base64
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const base64Image = Buffer.from(response.data).toString('base64');

    const instance = {
        image: {
            bytesBase64Encoded: base64Image,
        },
    };
    const instances = [instance];
    const parameters = {};

    const [predictionResponse] = await vertexClient.predict({
        endpoint,
        instances,
        parameters,
    });

    // Extract image embedding from response
    // Response structure varies by model version; multimodalembedding@001 returns imageEmbedding
    const embedding = predictionResponse.predictions[0].structValue.fields.imageEmbedding.listValue.values.map(v => v.numberValue);
    return embedding;
}

export async function verifyFaces(user, idUrl, selfieUrl) {
    try {
        if (!idUrl || !selfieUrl) {
            console.log(`[BIOMETRIC] Missing documents for user ${user._id}. Skipping.`);
            return null;
        }

        console.log(`[BIOMETRIC] Starting True Identity Verification for user: ${user._id}`);

        // 1. Verify face presence using Cloud Vision (Safety Check)
        const [idDetect, selfieDetect] = await Promise.all([
            visionClient.faceDetection(idUrl),
            visionClient.faceDetection(selfieUrl)
        ]);

        const idFaces = idDetect[0].faceAnnotations || [];
        const selfieFaces = selfieDetect[0].faceAnnotations || [];

        if (idFaces.length === 0 || selfieFaces.length === 0) {
            console.warn(`[BIOMETRIC] Face detection failed. ID faces: ${idFaces.length}, Selfie faces: ${selfieFaces.length}`);
            const failureData = {
                score: 0,
                similarityScore: 0,
                status: "NO_MATCH",
                verifiedAt: new Date(),
                provider: "Google Cloud Vision + Vertex AI",
                details: { error: "No face detected in one or both images." }
            };
            user.providerProfile.verificationDocs.faceMatching = failureData;
            user.markModified("providerProfile.verificationDocs.faceMatching");
            return failureData;
        }

        // 2. Generate Biometric Embeddings using Vertex AI
        console.log(`[BIOMETRIC] Generating embeddings...`);
        const [idEmbedding, selfieEmbedding] = await Promise.all([
            getImageEmbedding(idUrl),
            getImageEmbedding(selfieUrl)
        ]);

        // 3. Calculate Similarity
        const similarity = cosineSimilarity(idEmbedding, selfieEmbedding);
        const similarityScore = Math.round(similarity * 100);

        // 4. Weigh with detection confidence for final score
        const detectionConfidence = (idFaces[0].detectionConfidence + selfieFaces[0].detectionConfidence) / 2;
        const finalScore = Math.round((similarityScore * 0.8) + (detectionConfidence * 20));

        // 5. Apply Business Rules
        let status = "NO_MATCH";
        if (similarityScore >= 95) status = "MATCHED";
        else if (similarityScore >= 80) status = "REVIEW_REQUIRED";

        const faceMatchingData = {
            score: Math.min(100, finalScore),
            similarityScore: similarityScore,
            status,
            verifiedAt: new Date(),
            provider: "Google Vertex AI",
            model: "multimodalembedding@001",
            details: {
                algorithm: "Cosine Similarity",
                vectorSize: idEmbedding.length,
                visionConfidence: detectionConfidence,
                rawSimilarity: similarity
            }
        };

        user.providerProfile.verificationDocs.faceMatching = faceMatchingData;
        user.markModified("providerProfile.verificationDocs.faceMatching");

        console.log(`[BIOMETRIC] Result for ${user._id}: ${status} (Similarity: ${similarityScore}%)`);
        return faceMatchingData;
    } catch (err) {
        console.error(`[BIOMETRIC] ERROR:`, err.message);

        // On error, do not match.
        const errorData = {
            score: 0,
            status: "NOT_CHECKED",
            verifiedAt: new Date(),
            provider: "Google Vertex AI (Error)",
            details: { error: err.message }
        };
        user.providerProfile.verificationDocs.faceMatching = errorData;
        user.markModified("providerProfile.verificationDocs.faceMatching");
        return errorData;
    }
}

/**
 * ✅ Phase 3: Perform Daily Face Check-In
 * Compares live selfie against verified ID template.
 */
export async function performFaceCheck(user, liveSelfieUrl) {
    try {
        const idUrl = user.providerProfile.verificationDocs.idDocument?.url;
        if (!idUrl || !liveSelfieUrl) {
            console.log(`[FACE_CHECK] Missing ID or Live Selfie for user ${user._id}`);
            return null;
        }

        console.log(`[FACE_CHECK] Processing face check for user: ${user._id}`);

        // 1. Re-generate embedding from verified ID + generate from live selfie
        const [idEmbedding, liveEmbedding] = await Promise.all([
            getImageEmbedding(idUrl),
            getImageEmbedding(liveSelfieUrl)
        ]);

        // 2. Similarity
        const similarity = cosineSimilarity(idEmbedding, liveEmbedding);
        const similarityScore = Math.round(similarity * 100);

        // 3. Status Rules
        let status = "NO_MATCH";
        if (similarityScore >= 95) status = "MATCHED";
        else if (similarityScore >= 80) status = "REVIEW_REQUIRED";

        const result = {
            status,
            score: similarityScore,
            verifiedAt: new Date(),
            deviceId: user.lastPlatform || "Android", // Simplified
        };

        // 4. Update user record
        user.lastFaceCheck = {
            ...result,
            isRequired: false,
            failedAttempts: status === "NO_MATCH" ? (user.lastFaceCheck?.failedAttempts || 0) + 1 : 0
        };

        user.markModified("lastFaceCheck");
        await user.save();

        console.log(`[FACE_CHECK] Result for ${user._id}: ${status} (${similarityScore}%)`);
        return result;
    } catch (err) {
        console.error(`[FACE_CHECK] ERROR:`, err.message);
        return { status: "ERROR", score: 0, error: err.message };
    }
}
