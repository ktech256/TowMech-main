import dotenv from "dotenv";
import { PredictionServiceClient } from '@google-cloud/aiplatform';

dotenv.config();

async function runAudit() {
    console.log("=== VERTEX AI PRIVATE KEY FORENSIC AUDIT ===");

    const rawKey = process.env.GOOGLE_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY;
    const projectId = process.env.GOOGLE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL;

    console.log(`1. Loading Method: process.env.GOOGLE_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY`);

    if (!rawKey) {
        console.error("❌ CRITICAL: Private key not found in environment.");
        return;
    }

    console.log(`2. Markers check:`);
    const hasBegin = rawKey.includes("-----BEGIN PRIVATE KEY-----");
    const hasEnd = rawKey.includes("-----END PRIVATE KEY-----");
    console.log(`   - BEGIN present: ${hasBegin}`);
    console.log(`   - END present: ${hasEnd}`);

    console.log(`3. Key length: ${rawKey.length}`);

    console.log(`4. Newline replacement check:`);
    const convertedKey = rawKey.replace(/\\n/g, '\n');
    console.log(`   - Contains literal \\n before replacement: ${rawKey.includes('\\n')}`);
    console.log(`   - Contains real \\n after replacement: ${convertedKey.includes('\n')}`);

    console.log(`5. Exact credential object structure (REDACTED):`);
    const credentials = {
        client_email: clientEmail,
        private_key: "[REDACTED]",
        projectId: projectId
    };
    console.log(JSON.stringify(credentials, null, 2));

    console.log(`6. Attempting PredictionServiceClient instantiation...`);
    try {
        const client = new PredictionServiceClient({
            apiEndpoint: 'us-central1-aiplatform.googleapis.com',
            credentials: {
                client_email: clientEmail,
                private_key: convertedKey,
            },
            projectId: projectId,
        });
        console.log("✅ SUCCESS: Client created successfully.");

        console.log("   Checking if client can execute a basic operation (getProjectId)...");
        // This usually triggers auth loading
        const actualProjectId = await client.getProjectId();
        console.log(`✅ SUCCESS: Auth verified. Project: ${actualProjectId}`);

    } catch (err) {
        console.error("❌ FAILED");
        console.error(`   Error Message: ${err.message}`);
        console.error(`   Error Code: ${err.code}`);
        if (err.message.includes("DECODER")) {
            console.error("   -> DIAGNOSIS: Malformed private key format. Usually caused by missing newlines or extra quotes in Render/Env variables.");
        }
    }

    process.exit(0);
}

runAudit();
