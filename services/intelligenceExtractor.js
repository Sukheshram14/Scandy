/**
 * Intelligence Extractor Service (Regex Based)
 * Now extracts structured evidence objects.
 */

const PATTERNS = {
    upiIds: /[a-zA-Z0-9.\-_]{2,256}@(paytm|ybl|okaxis|oksbi|axl|ibl|upi|okhdfcbank|okicici|barodampay|idbi|aubank|axisbank|bandhan|federal|hdfcbank|icici|indus|kbl|kotak|paywiz|rbl|sbi|sc|sib|uco|unionbank|yesbank)/gi,
    bankAccounts: /\b\d{9,18}\b/g,
    phoneNumbers: /(?:\+91[\-\s]?)?[6-9]\d{9}\b/g,
    phishingLinks: /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi,
    keywords: [
        "blocked", "suspended", "verify", "kyc", "urgency", "urgent", "immediate", 
        "expire", "lapse", "refund", "lottery", "winner", "prize", "password", "otp", 
        "pin", "cvv", "atm card", "credit card", "debit card", "click here", "link",
        "police", "arrest", "jail", "cbi", "customs", "suicide", "died", "killed",
        "accident", "hospital", "drugs", "illegal", "fbi", "income tax", "seized"
    ]
};

/**
 * Helpers to format regex match into evidence object.
 */
const formatMatch = (match, type, confidence = 0.8) => ({
    raw: match,
    normalized: match.trim(),
    confidence: confidence,
    evidence_snippet: match,
    type: type
});

const extractIntelligence = (text) => {
    if (!text) return { urls: [], phones: [], upi_ids: [], bank_accounts: [], suspiciousKeywords: [] };

    // Direct Regex Extraction
    const bankMatches = (text.match(PATTERNS.bankAccounts) || []).map(m => formatMatch(m, 'bank_account', 0.85));
    const upiMatches = (text.match(PATTERNS.upiIds) || []).map(m => formatMatch(m, 'upi_id', 0.95));
    const linkMatches = (text.match(PATTERNS.phishingLinks) || []).map(m => formatMatch(m, 'url', 0.90));
    const phoneMatches = (text.match(PATTERNS.phoneNumbers) || []).map(m => formatMatch(m, 'phone', 0.70)); // Phones are noisy
    
    // Keywords
    const foundKeywords = PATTERNS.keywords
        .filter(k => text.toLowerCase().includes(k.toLowerCase()))
        .map(k => formatMatch(k, 'keyword', 0.6));

    return {
        // Map to new schema keys
        bank_accounts: bankMatches,
        upi_ids: upiMatches,
        urls: linkMatches, // "phishingLinks" -> "urls"
        phones: phoneMatches, // "phoneNumbers" -> "phones"
        suspiciousKeywords: foundKeywords
    };
};

/**
 * Aggregates intelligence arrays.
 * Merges detailed objects based on 'raw' value uniqueness.
 */
const aggregateIntelligence = (current, newIntel) => {
    const merge = (arr1 = [], arr2 = []) => {
        const combined = [...arr1, ...arr2];
        const unique = [];
        const seen = new Set();
        
        for (const item of combined) {
            if (!seen.has(item.raw)) {
                seen.add(item.raw);
                unique.push(item);
            }
        }
        return unique;
    };

    return {
        bank_accounts: merge(current.bank_accounts, newIntel.bank_accounts),
        upi_ids: merge(current.upi_ids, newIntel.upi_ids),
        urls: merge(current.urls, newIntel.urls),
        phones: merge(current.phones, newIntel.phones),
        suspiciousKeywords: merge(current.suspiciousKeywords, newIntel.suspiciousKeywords)
    };
};

module.exports = {
    extractIntelligence,
    aggregateIntelligence
};
