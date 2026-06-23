// backend/src/utils/faceVerification.js
import vision from '@google-cloud/vision';
import { PredictionServiceClient, helpers } from '@google-cloud/aiplatform';
import axios from 'axios';
import sharp from 'sharp';

/**
 * ✅ Phase 3: Field-Optimized Biometric Hardening
 *
 * Major Improvements:
 * 1. Face Cropping: Isolated facial features from background/clothing.
 * 2. Field-Ready Thresholds: Realistic margins for outdoor/low-light usage.
 * 3. Granular Statuses: MATCHED_WITH_WARNING and REVIEW_REQUIRED.
 */

/**
 * ✅ Fix: Initialize Vision client with explicit credentials from .env
 */
function getVisionClient() {
    const projectId = process.env.GOOGLE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL;
    const rawKey = process.env.GOOGLE_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY;

    let privateKey = rawKey;

    if (privateKey) {
        privateKey = privateKey.trim();
        if (privateKey.startsWith('"') && privateKey.endsWith('"')) privateKey = privateKey.slice(1, -1);
        if (privateKey.startsWith("'") && privateKey.endsWith("'")) privateKey = privateKey.slice(1, -1);
        privateKey = privateKey.replace(/\\n/g, '\n');
    }

    if (clientEmail && privateKey) {
        return new vision.ImageAnnotatorClient({
            credentials: {
                client_email: clientEmail,
                private_key: privateKey,
            },
            projectId,
        });
    }
    return new vision.ImageAnnotatorClient();
}

const visionClient = getVisionClient();

/**
 * ✅ Fix: Initialize Vertex AI client with explicit credentials from .env
 */
function getVertexClient() {
    const projectId = process.env.GOOGLE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL;
    const rawKey = process.env.GOOGLE_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY;

    let privateKey = rawKey;

    if (privateKey) {
        privateKey = privateKey.trim();
        if (privateKey.startsWith('"') && privateKey.endsWith('"')) privateKey = privateKey.slice(1, -1);
        if (privateKey.startsWith("'") && privateKey.endsWith("'")) privateKey = privateKey.slice(1, -1);
        privateKey = privateKey.replace(/\\n/g, '\n');
    }

    if (clientEmail && privateKey) {
        return new PredictionServiceClient({
            apiEndpoint: 'us-central1-aiplatform.googleapis.com',
            credentials: {
                client_email: clientEmail,
                private_key: privateKey,
            },
            projectId,
        });
    }

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
 * Helper: Detect and Crop Face from an image source (URL or Buffer)
 */
async function detectAndCropFace(source) {
    try {
        let inputBuffer;
        if (Buffer.isBuffer(source)) {
            inputBuffer = source;
        } else {
            const response = await axios.get(source, { responseType: 'arraybuffer' });
            inputBuffer = Buffer.from(response.data);
        }

        // 1. Detect face using Cloud Vision
        const [detection] = await visionClient.faceDetection(inputBuffer);
        const faces = detection.faceAnnotations;

        if (!faces || faces.length === 0) {
            console.warn("[BIOMETRIC_HARDENING] FACE_NOT_DETECTED for cropping.");
            return { buffer: inputBuffer, detected: false };
        }

        // 2. Calculate bounding box
        const vertices = faces[0].boundingPoly.vertices;
        const xCoords = vertices.map(v => v.x || 0);
        const yCoords = vertices.map(v => v.y || 0);

        const minX = Math.max(0, Math.min(...xCoords));
        const minY = Math.max(0, Math.min(...yCoords));
        const maxX = Math.max(0, Math.max(...xCoords));
        const maxY = Math.max(0, Math.max(...yCoords));

        let width = maxX - minX;
        let height = maxY - minY;

        // Add 25% safety padding around the face
        const paddingX = Math.round(width * 0.25);
        const paddingY = Math.round(height * 0.25);

        const metadata = await sharp(inputBuffer).metadata();

        const extractRegion = {
            left: Math.max(0, minX - paddingX),
            top: Math.max(0, minY - paddingY),
            width: Math.min(width + (paddingX * 2), metadata.width - Math.max(0, minX - paddingX)),
            height: Math.min(height + (paddingY * 2), metadata.height - Math.max(0, minY - paddingY))
        };

        // 3. Crop face region
        const croppedBuffer = await sharp(inputBuffer)
            .extract(extractRegion)
            .toBuffer();

        console.log(`[FACE_DETECTED] Face identified in source.`);
        console.log(`[FACE_CROPPED] Region extracted for isolation.`);
        console.log(`[CROPPED_IMAGE_DIMENSIONS] ${extractRegion.width}x${extractRegion.height}`);

        return { buffer: croppedBuffer, detected: true, region: extractRegion };
    } catch (err) {
        console.error("[BIOMETRIC_HARDENING] Cropping failed:", err.message);
        return { buffer: Buffer.isBuffer(source) ? source : null, detected: false };
    }
}

/**
 * Helper: Get Image Embedding from Vertex AI
 * Accepts URL or Buffer.
 */
export async function getImageEmbedding(source) {
    const projectId = process.env.GOOGLE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
    const location = 'us-central1';
    const model = 'multimodalembedding@001';
    const endpoint = `projects/${projectId}/locations/${location}/publishers/google/models/${model}`;

    let base64Image;
    if (Buffer.isBuffer(source)) {
        base64Image = source.toString('base64');
    } else {
        const response = await axios.get(source, { responseType: 'arraybuffer' });
        base64Image = Buffer.from(response.data).toString('base64');
    }

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

    const embedding = predictionResponse.predictions[0].structValue.fields.imageEmbedding.listValue.values.map(v => v.numberValue);
    console.log(`[EMBEDDING_GENERATED] Vector dimensions: ${embedding.length}`);
    return embedding;
}

/**
 * ✅ Phase 3: Updated Identity Verification with Cropping and Field Thresholds
 */
export async function verifyFaces(user, idUrl, selfieUrl) {
    try {
        if (!idUrl || !selfieUrl) {
            console.log(`[BIOMETRIC] Missing documents for user ${user._id}. Skipping.`);
            return null;
        }

        console.log(`[BIOMETRIC] Starting HARDENED Identity Verification for user: ${user._id}`);

        // 1. Detect and Crop Faces (Isolating facial features)
        const [idResult, selfieResult] = await Promise.all([
            detectAndCropFace(idUrl),
            detectAndCropFace(selfieUrl)
        ]);

        if (!idResult.detected || !selfieResult.detected) {
            console.warn(`[BIOMETRIC] Face isolation failed. ID detected: ${idResult.detected}, Selfie detected: ${selfieResult.detected}`);
            const failureData = {
                score: 0,
                similarityScore: 0,
                status: "IDENTITY_MISMATCH",
                verifiedAt: new Date(),
                provider: "Google Vertex AI + Sharp Face Isolation",
                details: { error: "Face could not be isolated in one or both images." }
            };
            user.providerProfile.verificationDocs.faceMatching = failureData;
            user.markModified("providerProfile.verificationDocs.faceMatching");
            return failureData;
        }

        // 2. Generate Biometric Embeddings from CROPPED images
        console.log(`[BIOMETRIC] Generating embeddings from cropped regions...`);
        const [idEmbedding, selfieEmbedding] = await Promise.all([
            getImageEmbedding(idResult.buffer),
            getImageEmbedding(selfieResult.buffer)
        ]);

        // 3. Calculate Similarity
        const similarity = cosineSimilarity(idEmbedding, selfieEmbedding);
        const similarityScore = Math.round(similarity * 100);

        // 4. Decision Thresholds (Phase 3 Optimized)
        let status = "IDENTITY_MISMATCH";
        if (similarityScore >= 90) status = "MATCHED";
        else if (similarityScore >= 75) status = "MATCHED_WITH_WARNING";
        else if (similarityScore >= 60) status = "REVIEW_REQUIRED";

        // ✅ Store Selfie as Primary Template on Match
        if (status === "MATCHED" || status === "MATCHED_WITH_WARNING") {
            user.providerProfile.biometricTemplate = {
                vector: selfieEmbedding,
                generatedAt: new Date(),
                version: "1.1", // Upgraded to cropped version
                sourceImage: selfieUrl
            };
            user.markModified("providerProfile.biometricTemplate");
        }

        const faceMatchingData = {
            score: similarityScore,
            similarityScore: similarityScore,
            status,
            verifiedAt: new Date(),
            provider: "Google Vertex AI + Sharp Face Isolation",
            model: "multimodalembedding@001",
            details: {
                algorithm: "Cosine Similarity",
                vectorSize: idEmbedding.length,
                rawSimilarity: similarity,
                croppingActive: true
            }
        };

        user.providerProfile.verificationDocs.faceMatching = faceMatchingData;
        user.markModified("providerProfile.verificationDocs.faceMatching");

        console.log(`[BIOMETRIC] Hardened Result for ${user._id}: ${status} (Similarity: ${similarityScore}%)`);
        return faceMatchingData;
    } catch (err) {
        console.error(`[BIOMETRIC] ERROR:`, err.message);
        const errorData = {
            score: 0,
            status: "VERTEX_API_ERROR",
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
 * ✅ Phase 3: Updated Face Check-In with Cropping and Field Thresholds
 */
export async function performFaceCheck(user, liveSelfieUrl) {
    try {
        console.log(`[FACECHECK_STARTED] User: ${user._id}`);

        let referenceEmbedding = user.providerProfile.biometricTemplate?.vector;

        // Auto-Migration/Fallback: Use onboarding selfie if template missing
        if (!referenceEmbedding || !Array.isArray(referenceEmbedding)) {
            const selfieUrl = user.providerProfile.verificationDocs.selfie?.url;
            if (!selfieUrl) return { status: "TEMPLATE_MISSING", message: "Verification template missing" };

            console.log(`[FACE_CHECK] Legacy provider: Generating reference embedding from verified selfie...`);
            const cropResult = await detectAndCropFace(selfieUrl);
            referenceEmbedding = await getImageEmbedding(cropResult.buffer);

            // Save migrated template
            user.providerProfile.biometricTemplate = {
                vector: referenceEmbedding,
                generatedAt: new Date(),
                version: "1.1",
                sourceImage: selfieUrl
            };
            user.markModified("providerProfile.biometricTemplate");
        }

        // 1. Detect and Crop LIVE face
        const liveResult = await detectAndCropFace(liveSelfieUrl);
        const liveEmbedding = await getImageEmbedding(liveResult.buffer);

        // 2. Similarity
        const similarity = cosineSimilarity(referenceEmbedding, liveEmbedding);
        const similarityScore = Math.round(similarity * 100);
        console.log(`[COSINE_SIMILARITY_RAW] ${similarity.toFixed(4)}`);
        console.log(`[FINAL_SCORE] ${similarityScore}`);

        // 3. Decision Thresholds (Phase 3 Optimized)
        let status = "IDENTITY_MISMATCH";
        if (similarityScore >= 90) status = "MATCHED";
        else if (similarityScore >= 75) status = "MATCHED_WITH_WARNING";
        else if (similarityScore >= 60) status = "REVIEW_REQUIRED";

        console.log(`[FINAL_STATUS] ${status}`);

        const result = {
            status,
            score: similarityScore,
            verifiedAt: new Date(),
            deviceId: user.lastPlatform || "Android",
        };

        // 4. Update user record
        // Only block and increment failures on IDENTITY_MISMATCH
        user.lastFaceCheck = {
            ...result,
            isRequired: false,
            failedAttempts: status === "IDENTITY_MISMATCH" ? (user.lastFaceCheck?.failedAttempts || 0) + 1 : (user.lastFaceCheck?.failedAttempts || 0)
        };

        user.markModified("lastFaceCheck");
        await user.save();

        return result;
    } catch (err) {
        console.error(`[FACE_CHECK] ERROR:`, err.message);
        return { status: "VERTEX_API_ERROR", score: 0, error: err.message };
    }
}

/**
 * ✅ Phase 3: Update Biometric Template from Verified Selfie
 */
export async function updateBiometricTemplate(user) {
    try {
        const selfieUrl = user.providerProfile.verificationDocs.selfie?.url;
        if (!selfieUrl) return null;

        console.log(`[BIOMETRIC] Generating primary template from verified selfie for: ${user._id}`);
        const cropResult = await detectAndCropFace(selfieUrl);
        const embedding = await getImageEmbedding(cropResult.buffer);

        user.providerProfile.biometricTemplate = {
            vector: embedding,
            generatedAt: new Date(),
            version: "1.1",
            sourceImage: selfieUrl
        };
        user.markModified("providerProfile.biometricTemplate");
        return embedding;
    } catch (err) {
        console.error(`[BIOMETRIC] Failed to update template:`, err.message);
        return null;
    }
}
