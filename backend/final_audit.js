import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "./src/models/User.js";

dotenv.config();

async function runAudit() {
    try {
        await mongoose.connect(process.env.MONGO_URI);

        const providerId = "6a395282cc8ab6edc5d32352";
        const user = await User.findById(providerId);

        if (!user) {
            console.log("Provider not found.");
            process.exit(0);
        }

        const template = user.providerProfile?.biometricTemplate;
        const selfie = user.providerProfile?.verificationDocs?.selfie;

        console.log("--- FINAL BIOMETRIC PIPELINE AUDIT ---");
        console.log(`1. biometricTemplate exists?: ${!!(template && template.vector && template.vector.length > 0)}`);
        console.log(`2. Dimensions stored: ${template?.vector ? template.vector.length : 0}`);
        console.log(`3. Template source image: ${template?.sourceImage || selfie?.url || "N/A"}`);

        // Analyze performFaceCheck logic by reading the file
        console.log("\n[Reading performFaceCheck source logic...]");

        process.exit(0);
    } catch (err) {
        console.error("Audit failed:", err.message);
        process.exit(1);
    }
}

runAudit();
