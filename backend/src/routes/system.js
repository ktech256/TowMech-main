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

export default router;
