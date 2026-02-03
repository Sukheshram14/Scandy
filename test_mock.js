const axios = require('axios');

const API_URL = 'http://localhost:3000/api/chat';
const SESSION_ID = 'test-session-' + Date.now();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const runTest = async () => {
    console.log(`Starting test for Session: ${SESSION_ID}`);

    const history = [];

    const messages = [
        { text: "Hi, is this Amit?", expectedScam: false }, // Normal
        { text: "Your bank account ending in 8899 is blocked. Click here https://bit.ly/fake to verify.", expectedScam: true }, // Scam
        { text: "Please send the otp to unblock immediately.", expectedScam: true } // Follow up
    ];

    for (const msg of messages) {
        console.log(`\nSending: "${msg.text}"`);
        
        const payload = {
            sessionId: SESSION_ID,
            message: {
                sender: 'scammer',
                text: msg.text,
                timestamp: new Date().toISOString()
            },
            conversationHistory: history,
            metadata: {
                channel: 'SMS',
                language: 'English',
                locale: 'IN'
            }
        };

        try {
            const start = Date.now();
            const response = await axios.post(API_URL, payload);
            const duration = Date.now() - start;

            const data = response.data;
            console.log(`Response (${duration}ms):`);
            console.log(`- Reply: "${data.reply}"`);
            console.log(`- Scam Detected: ${data.scamDetected}`);
            console.log(`- Confidence: ${data.confidence}`);
            console.log(`- Extracted:`, JSON.stringify(data.extractedIntelligence));

            // Verify expectations
            if (msg.expectedScam !== data.scamDetected) {
                console.warn(`[WARNING] Expected scamDetected=${msg.expectedScam}, got ${data.scamDetected}`);
            }

            // Update history for next turn (as the platform would)
            history.push({ sender: 'scammer', text: msg.text, timestamp: payload.message.timestamp });
            history.push({ sender: 'user', text: data.reply, timestamp: new Date().toISOString() });

            await sleep(1000); // Simulate network delay

        } catch (error) {
            console.error("Request failed:", error.message);
            if (error.response) console.error(error.response.data);
        }
    }
};

runTest();
