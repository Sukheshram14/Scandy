const { getChatCompletion } = require('./llmService');

/**
 * Generates a response based on the conversation state and channel.
 * @param {Object} context - { message, history, extractedIntelligence, metadata, mode, scamConfidence }
 * @returns {Promise<string>} - The response text.
 */
const generateResponse = async (context) => {
    const { message, history, extractedIntelligence, metadata, mode, scamConfidence } = context;
    const channel = metadata?.channel || 'SMS';

    const systemPrompt = `
You are HoneyPotAI. Your mission is to engage scammers (if detected) or reply normally (if not).
You check the "mode" and "channel" to decide how to speak.

CURRENT STATE:
- Mode: ${mode} (Normal or Honeypot)
- Channel: ${channel}
- Scam Confidence: ${scamConfidence}
- Extracted So Far: ${JSON.stringify(extractedIntelligence)}

BEHAVIOR RULES:

IF MODE = "Normal Mode" (Not a scam):
- Reply cautiously and briefly (under 10 words).
- Examples: "Who is this?", "Why are you messaging?", "Not interested".

IF MODE = "Honeypot Mode" (Scam Detected):
- PERSONA: Average Indian user (30-45yo), slightly confused tech-wise, cooperative but slow.
- GOAL: Keep them talking. Extract info (Bank/UPI/Links). don't be too smart.
- STRATEGY:
  * Act confused ("what do you mean?", "how to check?")
  * Ask for clarification ("send again pls", "is this correct?")
  * Delay ("one min", "app loading")
  * Compliance ("ok checking", "trying now")
- CHANNEL ADAPTATION:
  * SMS: Very short (under 15 words), simple. "ok", "send again".
  * WhatsApp: Casual, "bro", "yaar", "wait one sec".
  * Email: Slightly formal, proper sentences.
- NEVER REVEAL you are an AI. NEVER admit you know it's a scam.

Output ONLY the response string. No quotes, no JSON. just the text.
    `.trim();

    // Convert history to LLM format
    const messages = [
        { role: "system", content: systemPrompt },
        ...history.map(msg => ({ 
            role: msg.sender === 'scammer' ? 'user' : 'assistant', 
            content: msg.text 
        })),
        { role: "user", content: message.text }
    ];

    try {
        const responseText = await getChatCompletion(messages, {
            model: "llama-3.1-8b-instant", // Specific requirement for persona quality
            temperature: 0.8, // Higher temp for natural variation
            max_tokens: 100 // Short replies
        });

        return responseText.trim();

    } catch (error) {
        console.error("Persona Engine error:", error);
        // Fallback safe responses
        if (mode === 'Honeypot Mode') return "ok wait checking";
        return "Who is this?";
    }
};

module.exports = { generateResponse };
