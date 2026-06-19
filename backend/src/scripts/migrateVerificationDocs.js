import mongoose from "mongoose";
import dotenv from "dotenv";
import User, { USER_ROLES } from "../models/User.js";

dotenv.config();

const migrate = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB ✅");

    const providers = await User.find({
      role: { $in: [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK] },
      "providerProfile.verificationDocs": { $exists: true }
    });

    console.log(`Found ${providers.length} providers to check for migration.`);

    let migratedCount = 0;

    for (const p of providers) {
      const profile = p.providerProfile;
      const docs = profile.verificationDocs;
      const overallStatus = profile.verificationStatus === "APPROVED" ? "APPROVED" : "PENDING";

      let changed = false;

      const mapLegacy = (oldKey, newKey) => {
        if (docs[oldKey] && !docs[newKey]?.url) {
          docs[newKey] = {
            url: docs[oldKey],
            status: overallStatus,
            updatedAt: new Date()
          };
          changed = true;
        }
      };

      mapLegacy("idDocumentUrl", "idDocument");
      mapLegacy("licenseUrl", "driverLicense");
      mapLegacy("vehicleProofUrl", "proofOfVehicle");
      mapLegacy("workshopProofUrl", "selfie"); // mapped to selfie because it was used as profile pic

      // Ensure other fields exist as NOT_SUBMITTED if missing
      const fields = ["vehicleRC1", "huruCriminalCheck", "proofOfResidence", "vehicleLicenseDisc"];
      for (const f of fields) {
        if (!docs[f]) {
          docs[f] = { status: "NOT_SUBMITTED", url: null, updatedAt: new Date() };
          changed = true;
        }
      }

      if (changed) {
        p.markModified("providerProfile.verificationDocs");
        await p.save();
        migratedCount++;
      }
    }

    console.log(`Migration complete. Migrated ${migratedCount} providers.`);
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
};

migrate();
