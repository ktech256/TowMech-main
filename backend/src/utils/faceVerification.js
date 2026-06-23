// backend/src/utils/faceVerification.js
import vision from '@google-cloud/vision';
import { PredictionServiceClient, helpers } from '@google-cloud/aiplatform';
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

/**
 * ✅ Fix: Initialize Vision client with explicit credentials from .env
 */
function getVisionClient() {
    const projectId = process.env.GOOGLE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = (process.env.GOOGLE_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY)?.replace(/\\n/g, '\n');

    console.log(`[VISION] Init: projectId=${projectId}, hasEmail=${!!clientEmail}, hasKey=${!!privateKey}`);

    if (clientEmail && privateKey) {
        console.log("[VISION] Using explicit credentials from environment.");
        return new vision.ImageAnnotatorClient({
            credentials: {
                client_email: clientEmail,
                private_key: privateKey,
            },
            projectId,
        });
    }
    console.warn("[VISION] No explicit credentials found. Falling back to ADC.");
    return new vision.ImageAnnotatorClient();
}

const visionClient = getVisionClient();

/**
 * ✅ Fix: Initialize Vertex AI client with explicit credentials from .env
 */
function getVertexClient() {
    const projectId = process.env.GOOGLE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = (process.env.GOOGLE_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY)?.replace(/\\n/g, '\n');

    console.log(`[VERTEX_AI] Init: projectId=${projectId}, hasEmail=${!!clientEmail}, hasKey=${!!privateKey}`);

    if (clientEmail && privateKey) {
        console.log("[VERTEX_AI] Using explicit credentials from environment.");
        return new PredictionServiceClient({
            apiEndpoint: 'us-central1-aiplatform.googleapis.com',
            credentials: {
                client_email: clientEmail,
                private_key: privateKey,
            },
            projectId,
        });
    }

    console.warn("[VERTEX_AI] No explicit credentials found. GOOGLE_APPLICATION_CREDENTIALS=" + process.env.GOOGLE_APPLICATION_CREDENTIALS);
    console.warn("[VERTEX_AI] Falling back to Application Default Credentials (ADC).");
    return new PredictionServiceClient({
        apiEndpoint: 'us-central1-aiplatform.googleapis.com',
    });
}

const vertexClient = getVertexClient();

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
export async function getImageEmbedding(imageUrl) {
    const projectId = process.env.GOOGLE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
    const location = 'us-central1';
    const model = 'multimodalembedding@001';
    const endpoint = `projects/${projectId}/locations/${location}/publishers/google/models/${model}`;

    // Download image and convert to base64
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const base64Image = Buffer.from(response.data).toString('base64');

    const instance = helpers.toValue({
        image: {
            bytesBase64Encoded: base64Image,
        },
    });
    const instances = [instance];
    const parameters = helpers.toValue({});

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

/**
 * ✅ Phase 3: Update Biometric Template from Verified Selfie
 */
export async function updateBiometricTemplate(user) {
    try {
        const selfieUrl = user.providerProfile.verificationDocs.selfie?.url;
        if (!selfieUrl) return null;

        console.log(`[BIOMETRIC] Generating primary template from verified selfie for: ${user._id}`);
        const embedding = await getImageEmbedding(selfieUrl);

        user.providerProfile.biometricTemplate = {
            vector: embedding,
            generatedAt: new Date(),
            version: "1.0",
            sourceImage: selfieUrl
        };
        user.markModified("providerProfile.biometricTemplate");
        return embedding;
    } catch (err) {
        console.error(`[BIOMETRIC] Failed to update template:`, err.message);
        return null;
    }
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

        // ✅ STORE THE SELFIE EMBEDDING AS THE PRIMARY TEMPLATE IMMEDIATELY ON MATCH
        if (status === "MATCHED" || status === "REVIEW_REQUIRED") {
            user.providerProfile.biometricTemplate = {
                vector: selfieEmbedding,
                generatedAt: new Date(),
                version: "1.0"
            };
            user.markModified("providerProfile.biometricTemplate");
        }

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
        const errorType = (err.message.includes("credentials") || err.message.includes("PERMISSION_DENIED"))
            ? "VERTEX_AUTH_ERROR"
            : "VERTEX_API_ERROR";

        // On error, do not match.
        const errorData = {
            score: 0,
            status: errorType,
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
 * Compares live selfie against PRIMARY BIOMETRIC TEMPLATE (Verified Selfie).
 * If template missing (legacy), falls back to generating from verification selfie URL.
 */
export async function performFaceCheck(user, liveSelfieUrl) {
    try {
        console.log(`[FACECHECK_STARTED] User: ${user._id}`);
        let referenceEmbedding = user.providerProfile.biometricTemplate?.vector;

        // Fallback: If no template stored, generate from verified onboarding selfie URL
        if (!referenceEmbedding || !Array.isArray(referenceEmbedding)) {
            const selfieUrl = user.providerProfile.verificationDocs.selfie?.url;
            console.log(`[FACE_CHECK] Biometric template missing. Template Source URL: ${selfieUrl}`);
            if (!selfieUrl) {
                console.log(`[FACE_CHECK] Missing PRIMARY TEMPLATE or ONBOARDING SELFIE for user ${user._id}`);
                return { status: "TEMPLATE_MISSING", message: "Verification template missing" };
            }
            console.log(`[FACE_CHECK] Legacy provider: Generating reference embedding from verified selfie URL...`);
            referenceEmbedding = await updateBiometricTemplate(user);
        }

        if (referenceEmbedding) {
            console.log(`[BIOMETRIC_TEMPLATE_FOUND] Length: ${referenceEmbedding.length}`);
        } else {
            console.log(`[FACE_CHECK] Reference template generation failed for user: ${user._id}`);
            return { status: "VERTEX_AUTH_ERROR", message: "Reference template generation failed" };
        }

        console.log(`[LIVE_FACE_CAPTURED] URL: ${liveSelfieUrl}`);

        // Generate embedding from live selfie
        console.log(`[VERTEX_REQUEST_SENT] Generating live embedding...`);
        const liveEmbedding = await getImageEmbedding(liveSelfieUrl);
        console.log(`[VERTEX_RESPONSE_RECEIVED] Live embedding length: ${liveEmbedding.length}`);

        // 2. Similarity
        const similarity = cosineSimilarity(referenceEmbedding, liveEmbedding);
        const similarityScore = Math.round(similarity * 100);
        console.log(`[COSINE_SIMILARITY_RAW] ${similarity.toFixed(4)}`);
        console.log(`[FINAL_SCORE] ${similarityScore}`);

        // 3. Status Rules
        let status = "IDENTITY_MISMATCH";
        if (similarityScore >= 95) status = "MATCHED";
        else if (similarityScore >= 80) status = "REVIEW_REQUIRED";

        console.log(`[FINAL_STATUS] ${status}`);

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
            failedAttempts: status === "IDENTITY_MISMATCH" ? (user.lastFaceCheck?.failedAttempts || 0) + 1 : (user.lastFaceCheck?.failedAttempts || 0)
        };

        user.markModified("lastFaceCheck");
        await user.save();

        console.log(`[FACE_CHECK] Result for ${user._id}: ${status} (${similarityScore}%)`);
        return result;
    } catch (err) {
        console.error(`[FACE_CHECK] ERROR:`, err.message);
        const errorType = (err.message.includes("credentials") || err.message.includes("PERMISSION_DENIED"))
            ? "VERTEX_AUTH_ERROR"
            : "VERTEX_API_ERROR";
        return { status: errorType, score: 0, error: err.message };
    }
}
