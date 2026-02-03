const Groq = require('groq-sdk');
require('dotenv').config();

// Load API keys from environment variables
const API_KEYS = [
    process.env.GROQ_API_KEY_1,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3
].filter(key => key); // Filter out undefined keys

if (API_KEYS.length === 0) {
    console.warn("WARNING: No Groq API keys found in environment variables.");
}

let currentKeyIndex = 0;
// Map to store client instances for each key to avoid re-initializing
const groqClients = API_KEYS.map(key => new Groq({ apiKey: key }));

const getClient = () => {
    return groqClients[currentKeyIndex];
};

const rotateKey = () => {
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    console.log(`Switched to API Key Index: ${currentKeyIndex}`);
};

/**
 * Generates a chat completion using Groq with automatic key rotation on failure.
 * @param {Array} messages - Array of message objects {role: 'system'|'user', content: string}
 * @param {Object} options - Optional parameters (model, temperature, max_tokens, etc.)
 * @returns {Promise<string>} - The content of the response.
 */
const getChatCompletion = async (messages, options = {}) => {
    const maxRetries = API_KEYS.length; // Try each key once
    let attempt = 0;

    const defaultParams = {
        model: "llama-3.1-8b-instant",
        temperature: 0.75,
        max_tokens: 100,
        top_p: 0.9,
        stream: false
    };

    const params = { ...defaultParams, ...options };

    while (attempt < maxRetries) {
        try {
            const client = getClient();
            const completion = await client.chat.completions.create({
                messages: messages,
                ...params
            });

            return completion.choices[0]?.message?.content || "";

        } catch (error) {
            console.error(`Error with API Key Index ${currentKeyIndex}:`, error.message);
            
            // Check for rate limit (429) or other retryable errors
            if (error.status === 429 || error.code === 'rate_limit_exceeded') {
                console.log("Rate limit exceeded. Rotating key...");
                rotateKey();
                attempt++;
            } else {
                // If it's a different error (e.g., invalid request), maybe simple retry isn't enough, 
                // but for redundancy we will rotate and try again unless we are out of keys.
                // For now, let's treat most network/server errors as reasons to rotate.
                console.log("Encountered error. Rotating key to retry...");
                rotateKey();
                attempt++;
            }
        }
    }

    throw new Error("All API keys and retries exhausted.");
};

module.exports = {
    getChatCompletion
};
