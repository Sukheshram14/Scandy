const axios = require('axios');

/**
 * Sends the final analysis result to the GUVI evaluation endpoint.
 * @param {Object} payload - The results payload.
 */
const reportFinalResult = async (payload) => {
    const URL = "https://hackathon.guvi.in/api/updateHoneyPotFinalResult";

    console.log(`[Reporting] Sending final result for session ${payload.sessionId}...`);

    try {
        const response = await axios.post(URL, payload, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 5000 // 5 second timeout
        });

        console.log(`[Reporting] Success! Status: ${response.status}`);
        return response.data;

    } catch (error) {
        console.error(`[Reporting] Failed to report result.`);
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error(`Data:`, error.response.data);
        } else {
            console.error(error.message);
        }
        // In a real scenario, we might retry or queue this.
    }
};

module.exports = { reportFinalResult };
