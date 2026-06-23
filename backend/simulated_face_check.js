import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import User from "./src/models/User.js";

async function getLogic() {
    return await import("./src/utils/faceVerification.js");
}

async function simulate() {
    try {
        await mongoose.connect(process.env.MONGO_URI);

        const providerId = "6a395282cc8ab6edc5d32352";
        const user = await User.findById(providerId);

        if (!user) {
            console.log("Provider not found.");
            process.exit(0);
        }

        const { performFaceCheck } = await getLogic();
        const liveSelfieUrl = user.providerProfile.biometricTemplate.sourceImage;

        console.log("--- STARTING LIVE FACE CHECK SIMULATION ---");
        console.log(`[STEP 1] performFaceCheck triggered for user ${providerId}`);

        const result = await performFaceCheck(user, liveSelfieUrl);

        console.log("\n--- SIMULATION RESULTS ---");
        console.log(JSON.stringify(result, null, 2));

        process.exit(0);
    } catch (err) {
        console.error("Simulation failed:", err.message);
        process.exit(1);
    }
}

simulate();
