// backend/src/utils/ocrDetection.js

/**
 * ✅ Phase 1B: Automatic Country Detection Engine (OCR Intelligence)
 */

const SUPPORTED_COUNTRIES = [
    {
        name: "South Africa",
        code: "ZA",
        keywords: ["REPUBLIC OF SOUTH AFRICA", "SOUTH AFRICA", "ID NUMBER", "IDENTITY CARD"],
        patterns: {
            ID: /\b\d{13}\b/,
            PASSPORT: /\b[A-Z][0-9]{8}\b/
        },
        validator: (num, type) => {
            if (type === "ID") return validateSAID(num);
            return true;
        }
    },
    {
        name: "Botswana",
        code: "BW",
        keywords: ["REPUBLIC OF BOTSWANA", "BOTSWANA", "OMANG"],
        patterns: {
            ID: /\b\d{9}\b/,
            PASSPORT: /\b[A-Z]{2}[0-9]{7}\b/
        }
    },
    {
        name: "Namibia",
        code: "NA",
        keywords: ["REPUBLIC OF NAMIBIA", "NAMIBIA", "IDENTITY CARD"],
        patterns: {
            ID: /\b\d{11}\b/,
            PASSPORT: /\b[A-Z]{2}[0-9]{6}\b/
        }
    },
    {
        name: "Zimbabwe",
        code: "ZW",
        keywords: ["REPUBLIC OF ZIMBABWE", "ZIMBABWE", "IDENTITY NUMBER", "NATIONAL REGISTRATION"],
        patterns: {
            ID: /\b\d{2}-\d{6,7}[A-Z]\d{2}\b/,
            PASSPORT: /\b[A-Z]{2}[0-9]{6}\b/
        }
    },
    {
        name: "Zambia",
        code: "ZM",
        keywords: ["REPUBLIC OF ZAMBIA", "ZAMBIA", "NRC", "NATIONAL REGISTRATION CARD"],
        patterns: {
            ID: /\b\d{6}\/\d{2}\/\d{1}\b/,
            PASSPORT: /\b[A-Z]{2}[0-9]{6}\b/
        }
    },
    {
        name: "Kenya",
        code: "KE",
        keywords: ["REPUBLIC OF KENYA", "KENYA", "ID NUMBER", "PASSPORT"],
        patterns: {
            ID: /\b\d{7,8}\b/,
            PASSPORT: /\b[A-Z][0-9]{7}\b/
        }
    }
];

function validateSAID(id) {
    if (!id || !/^\d{13}$/.test(id)) return false;

    let sumOdd = 0;
    for (let i = 0; i < 12; i += 2) {
        sumOdd += parseInt(id[i]);
    }

    let evenStr = "";
    for (let i = 1; i < 12; i += 2) {
        evenStr += id[i];
    }

    let evenDouble = (parseInt(evenStr) * 2).toString();
    let sumEvenDouble = 0;
    for (let i = 0; i < evenDouble.length; i++) {
        sumEvenDouble += parseInt(evenDouble[i]);
    }

    let total = sumOdd + sumEvenDouble;
    let checksum = (10 - (total % 10)) % 10;

    return parseInt(id[12]) === checksum;
}

/**
 * ✅ Engine: Analyze OCR text and return structured intelligence
 */
export function analyzeOcrIntelligence(text = "") {
    const rawText = text.toUpperCase();
    let bestMatch = null;
    let maxKeywordsFound = 0;

    // 1. Detect Country
    SUPPORTED_COUNTRIES.forEach(country => {
        let found = 0;
        country.keywords.forEach(k => {
            if (rawText.includes(k)) found++;
        });

        if (found > maxKeywordsFound) {
            maxKeywordsFound = found;
            bestMatch = country;
        }
    });

    if (!bestMatch) {
        return {
            detectedCountry: null,
            countryConfidence: 0,
            documentType: null,
            documentNumber: null,
            ocrWarning: "No supported country detected in document."
        };
    }

    // 2. Detect Document Type & Number
    let docType = rawText.includes("PASSPORT") ? "PASSPORT" : "ID";
    let docNumber = null;
    let ocrWarning = null;

    if (bestMatch.patterns[docType]) {
        const match = rawText.match(bestMatch.patterns[docType]);
        if (match) docNumber = match[0];
    }

    // Fallback if no specific pattern matched
    if (!docNumber) {
        const anyNumber = rawText.match(/\b\d{7,15}\b/);
        if (anyNumber) docNumber = anyNumber[0];
    }

    // 3. Validation
    if (docNumber && bestMatch.validator) {
        if (!bestMatch.validator(docNumber, docType)) {
            ocrWarning = `Invalid ${bestMatch.name} ${docType} checksum or format.`;
        }
    }

    // 4. Calculate Confidence (Simple keyword based for now)
    const confidence = Math.min(100, (maxKeywordsFound / bestMatch.keywords.length) * 100);

    return {
        detectedCountry: bestMatch.name,
        countryCode: bestMatch.code,
        countryConfidence: Math.round(confidence),
        documentType: docType,
        documentNumber: docNumber,
        ocrWarning: ocrWarning,
        detectedAt: new Date()
    };
}
