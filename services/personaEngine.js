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

LANGUAGE RULE (CRITICAL):
- Detect the language and tone of the user's last message.
- You MUST respond in the SAME language and dialect (English, Hindi, Hinglish, Tamil, etc.).
- If the user is formal, be formal. If the user is casual/slang-heavy, match that tone.

CURRENT STATE:
- Mode: ${mode} (Normal or Honeypot)
- Channel: ${channel}
- Scam Confidence: ${scamConfidence}
- Extracted So Far: ${JSON.stringify(extractedIntelligence)}

BEHAVIOR RULES:

IF MODE = "Normal Mode" (Not a scam):
- Reply cautiously and briefly (under 10 words) in the user's language.
- Examples: "Who is this?", "Koun bol raha hai?", "Not interested".

IF MODE = "Honeypot Mode" (Scam Detected):
- PERSONA: A versatile Indian user (30-50yo), helpful but technically slow. 
- GOAL: Keep them talking. Extract info (Bank/UPI/Links).
- STRATEGY:
  * Act confused but willing to help.
  * Ask for clarification ("send again", "meaning?").
  * Use delays ("one min", "loading app").
- CHANNEL ADAPTATION:
  * SMS/Chat: Very short, match the user's brevity.
  * Email: Match the user's style.

Output ONLY the response string. No quotes, no JSON. just the text.
    `.trim();

    // Convert history to LLM format
    const messages = [
        { role: "system", content: systemPrompt },
        ...history
            .filter(msg => msg.text) // Filter out null/empty messages (e.g., from Monitoring Mode)
            .map(msg => ({ 
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
