const { getChatCompletion } = require('./llmService');

/**
 * Detailed System Prompt based on User Spec.
 */
const SYSTEM_PROMPT = `
SYSTEM (DETAILED SPEC):

Goal:
- Only activate the honeypot when an interaction is confirmed malicious according to explicit rules below.
- After activation, fully extract all actionable intelligence (URLs, phone numbers, UPI IDs, account numbers, emails, IM handles, payment links, transaction refs, IPs) with evidence and confidence.

Definitions:
- "Interaction" = any inbound message, email, web request, chat, or attachment to be inspected.
- "Scam indicators" = lexical, structural, contextual or metadata patterns that indicate fraud.
- "Honeypot activation" = enabling monitoring/tracking/trace.

Detection rules (must be satisfied before activation):
1. Evidence-based scoring:
   - Compute a maliciousness score S in [0,1] from multiple signals.
2. Activation threshold:
   - Activate honeypot only if:
     a) S >= 0.80 AND
     b) At least TWO independent strong indicators found.
   - If 0.60 <= S < 0.80: FLAG for human review.
   - If S < 0.60: mark as benign/low-risk.

Extraction requirements:
- Extract and normalize fields: urls, phones, upi_ids, bank_accounts, emails, im_handles, payment_links, ips, transaction_refs.
- For each extraction include: { evidence_snippet, line_or_offset, confidence, detector_rule_ids }.

Output format (STRICT JSON):
{
  "id": "unique-event-id",
  "timestamp_utc": "ISO-8601",
  "maliciousness_score": <float 0-1>,
  "decision": "activate" | "flag_for_review" | "no_action",
  "decision_reasons": ["reason 1", "reason 2"],
  "extractions": {
    "urls": [{ "url": "...", "confidence": 0.9, "evidence_snippet": "..." }],
    "phones": [],
    "upi_ids": [],
    "bank_accounts": [],
    "emails": [],
    "im_handles": [],
    "payment_links": [],
    "ips": [],
    "transaction_refs": []
  },
  "raw_evidence": ["snippet1", "snippet2"],
  "audit_log": [],
  "recommended_next_steps": []
}

Output constraint: Output ONLY the JSON object.
`.trim();

/**
 * Analyzes the message using the detailed system spec.
 * @param {string} currentMessage - The latest message text.
 * @param {Array} history - The conversation history.
 * @returns {Promise<Object>} - The structured analysis result.
 */
const detectScam = async (currentMessage, history = []) => {
    // Context Construction
    const userPrompt = `
CURRENT INTERACTION:
Timestamp: ${new Date().toISOString()}
Message: "${currentMessage}"
History Count: ${history.length}
Previous: ${history.slice(-3).map(m => m.text).join(' | ')}
    `.trim();

    try {
        const responseText = await getChatCompletion([
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt }
        ], {
            model: "llama-3.1-8b-instant",
            temperature: 0.1,
            max_tokens: 1024, // Increased to prevent truncation of large JSON
            response_format: { type: "json_object" } // Force valid JSON
        });

        // Robust JSON Parsing
        let result;
        try {
            // 1. Try cleaning markdown fences
            let cleanJson = responseText.replace(/```json|```/g, '').trim();
            
            // 2. If it contains non-JSON text, try to extract the main object
            const firstBrace = cleanJson.indexOf('{');
            const lastBrace = cleanJson.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1) {
                cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);
            }

            result = JSON.parse(cleanJson);
        } catch (e) {
            console.error("JSON Parse Error in ScamDetector:", e.message);
            console.error("Raw Output Snippet:", responseText.substring(0, 200) + "..."); 
            // Fallback default
            return {
                maliciousness_score: 0.5,
                decision: "flag_for_review",
                decision_reasons: ["JSON Parse Failure"],
                extractions: {}
            };
        }
        
        return result;

    } catch (error) {
        console.error("Scam detection error:", error);
        return {
            maliciousness_score: 0,
            decision: "no_action",
            decision_reasons: [`Error: ${error.message}`],
            extractions: {}
        };
    }
};

module.exports = { detectScam };
