// backend/src/routes/system.js
import express from "express";
import { PredictionServiceClient, helpers } from '@google-cloud/aiplatform';
import vision from '@google-cloud/vision';
import fs from 'fs';

const router = express.Router();

router.get("/vertex-health", async (req, res) => {
    const diagnostic = {
        authenticated: false,
        projectId: process.env.GOOGLE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "MISSING",
        serviceAccount: process.env.GOOGLE_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL || "MISSING",
        privateKeyPresence: !!(process.env.GOOGLE_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY),
        googleAppCredentialsEnv: process.env.GOOGLE_APPLICATION_CREDENTIALS || "NOT_SET",
        jsonFileExists: false,
        jsonFileReadable: false,
        modelReachable: false,
        embeddingTest: false,
        error: null
    };

    // Check if JSON file exists if ENV is set
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        try {
            diagnostic.jsonFileExists = fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS);
            if (diagnostic.jsonFileExists) {
                fs.accessSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, fs.constants.R_OK);
                diagnostic.jsonFileReadable = true;

                const content = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
                diagnostic.jsonDetails = {
                    projectId: content.project_id,
                    clientEmail: content.client_email,
                    hasPrivateKey: !!content.private_key
                };
            }
        } catch (e) {
            diagnostic.jsonFileReadable = false;
            diagnostic.error = "File access error: " + e.message;
        }
    }

    try {
        const clientEmail = process.env.GOOGLE_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL;
        const privateKey = (process.env.GOOGLE_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY)?.replace(/\\n/g, '\n');

        let client;
        if (clientEmail && privateKey) {
            try {
                client = new PredictionServiceClient({
                    apiEndpoint: 'us-central1-aiplatform.googleapis.com',
                    credentials: {
                        client_email: clientEmail,
                        private_key: privateKey,
                    },
                    projectId: diagnostic.projectId,
                });
                diagnostic.authenticated = true;
                diagnostic.authMethod = "Environment Variables (Explicit)";
            } catch (e) {
                diagnostic.error = "Explicit Client Init Failed: " + e.message;
                diagnostic.failingLine = "PredictionServiceClient constructor (Explicit)";
                throw e;
            }
        } else {
            try {
                client = new PredictionServiceClient({
                    apiEndpoint: 'us-central1-aiplatform.googleapis.com',
                });
                diagnostic.authMethod = "Application Default Credentials (ADC)";
                // Check if ADC can actually load
                await client.getProjectId();
                diagnostic.authenticated = true;
            } catch (e) {
                diagnostic.authenticated = false;
                diagnostic.error = "ADC failed to load: " + e.message;
                diagnostic.failingLine = "PredictionServiceClient constructor (ADC) or getProjectId()";
                throw e;
            }
        }

        if (diagnostic.authenticated) {
            const location = 'us-central1';
            const model = 'multimodalembedding@001';
            const endpoint = `projects/${diagnostic.projectId}/locations/${location}/publishers/google/models/${model}`;

            // 1x1 black pixel placeholder
            const placeholderBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

            const instance = helpers.toValue({
                image: {
                    bytesBase64Encoded: placeholderBase64,
                },
            });

            try {
                const [predictionResponse] = await client.predict({
                    endpoint,
                    instances: [instance],
                    parameters: helpers.toValue({}),
                });
                diagnostic.modelReachable = true;
                diagnostic.embeddingTest = true;
            } catch (e) {
                diagnostic.modelReachable = false;
                diagnostic.error = "Prediction failed: " + e.message;
            }
        }

    } catch (err) {
        diagnostic.error = "Initialization error: " + err.message;
    }

    return res.status(diagnostic.embeddingTest ? 200 : 500).json(diagnostic);
});

router.get("/vertex-auth-test", async (req, res) => {
    const rawKey = process.env.GOOGLE_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY;
    const projectId = process.env.GOOGLE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL;

    const diagnostic = {
        projectId: projectId || "MISSING",
        hasProjectId: !!projectId,
        hasClientEmail: !!clientEmail,
        hasPrivateKey: !!rawKey,
        keyLength: rawKey ? rawKey.length : 0,
        beginMarkerPresent: rawKey ? rawKey.includes("-----BEGIN PRIVATE KEY-----") : false,
        endMarkerPresent: rawKey ? rawKey.includes("-----END PRIVATE KEY-----") : false,
        containsLiteralNewline: rawKey ? rawKey.includes('\\n') : false,
        containsActualLineBreak: rawKey ? rawKey.includes('\n') : false,
        first30Chars: rawKey ? rawKey.substring(0, 30) : "N/A",
        last30Chars: rawKey ? rawKey.substring(rawKey.length - 30) : "N/A",
        authClientCreated: false,
        projectLookupSuccess: false,
        error: null,
        stack: null
    };

    if (!rawKey) {
        diagnostic.error = "No private key found in environment variables (GOOGLE_PRIVATE_KEY or FIREBASE_PRIVATE_KEY).";
        return res.status(500).json(diagnostic);
    }

    try {
        // Step 1: Normalize key (same logic as in faceVerification.js)
        let cleanedKey = rawKey.trim();
        if (cleanedKey.startsWith('"') && cleanedKey.endsWith('"')) cleanedKey = cleanedKey.slice(1, -1);
        if (cleanedKey.startsWith("'") && cleanedKey.endsWith("'")) cleanedKey = cleanedKey.slice(1, -1);
        cleanedKey = cleanedKey.replace(/\\n/g, '\n');

        diagnostic.processedKeyLength = cleanedKey.length;
        diagnostic.processedBeginMarkerPresent = cleanedKey.includes("-----BEGIN PRIVATE KEY-----");
        diagnostic.processedEndMarkerPresent = cleanedKey.includes("-----END PRIVATE KEY-----");
        diagnostic.processedActualLineBreakPresent = cleanedKey.includes('\n');

        // Step 2: Attempt Client Creation
        const client = new PredictionServiceClient({
            apiEndpoint: 'us-central1-aiplatform.googleapis.com',
            credentials: {
                client_email: clientEmail,
                private_key: cleanedKey,
            },
            projectId: projectId,
        });
        diagnostic.authClientCreated = true;

        // Step 3: Attempt Project Lookup (Auth Verification)
        try {
            const resolvedProjectId = await client.getProjectId();
            diagnostic.projectLookupSuccess = true;
            diagnostic.resolvedProjectId = resolvedProjectId;
        } catch (e) {
            diagnostic.projectLookupSuccess = false;
            diagnostic.error = "getProjectId failed: " + e.message;
            diagnostic.stack = e.stack;
        }

        // Step 4: Attempt Auth Client (Internal check)
        try {
            await client.auth.getClient();
            diagnostic.authGetClientSuccess = true;
        } catch (e) {
            diagnostic.authGetClientSuccess = false;
            if (!diagnostic.error) {
                diagnostic.error = "auth.getClient failed: " + e.message;
                diagnostic.stack = e.stack;
            }
        }

    } catch (err) {
        diagnostic.authClientCreated = false;
        diagnostic.error = err.message;
        diagnostic.stack = err.stack;
    }

    return res.status(diagnostic.projectLookupSuccess ? 200 : 500).json(diagnostic);
});

export default router;
