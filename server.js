const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const { detectScam } = require('./services/scamDetector');
const { generateResponse } = require('./services/personaEngine');
const { extractIntelligence, aggregateIntelligence } = require('./services/intelligenceExtractor');
const { reportFinalResult } = require('./services/reportingService');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Simple In-Memory Session Store
const sessions = new Map();

// SSE Clients
const sseClients = new Set();
const logToClients = (type, message) => {
    if (type === 'error') console.error(message);
    else console.log(message);
    const timestamp = new Date().toISOString();
    try {
        const eventData = JSON.stringify({ type, timestamp, message });
        sseClients.forEach(client => {
            client.write(`data: ${eventData}\n\n`);
        });
    } catch(e) { console.error("SSE Error:", e); }
};

app.get('/', (req, res) => res.send('HoneyPot AI Backend is running.'));
app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    sseClients.add(res);
    logToClients('info', 'Client connected to log stream.');
    req.on('close', () => sseClients.delete(res));
});

// Helper to convert detailed evidence to simple string arrays for API output
const flattenIntelligence = (detailedIntel) => {
    return {
        bankAccounts: (detailedIntel.bank_accounts || []).map(i => i.raw),
        upiIds: (detailedIntel.upi_ids || []).map(i => i.raw),
        phishingLinks: (detailedIntel.urls || []).map(i => i.raw),
        phoneNumbers: (detailedIntel.phones || []).map(i => i.raw),
        suspiciousKeywords: (detailedIntel.suspiciousKeywords || []).map(i => i.raw)
    };
};

// Auth Middleware
const authenticate = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    const validKey = process.env.API_KEY || 'GUVI_SECRET_KEY';
    
    if (!apiKey || apiKey !== validKey) {
        logToClients('error', `Unauthorized access attempt. Key: ${apiKey}`);
        return res.status(401).json({ status: "error", message: "Unauthorized: Invalid API Key" });
    }
    next();
};

// Apply Auth to specific routes
app.post('/api/chat', authenticate, async (req, res) => {
    try {
        let { message, conversationHistory, sessionId, metadata } = req.body;
        
        // Robustness: Handle sessionId missing
        sessionId = sessionId || `anon-${Date.now()}`;

        // Robustness: Handle message being a string (Fixes INVALID_REQUEST_BODY in some tools)
        if (typeof message === 'string') {
            message = { text: message, sender: 'scammer', timestamp: new Date().toISOString() };
        }

        if (!sessionId || !message || !message.text) {
             return res.status(400).json({ status: "error", message: "Invalid payload: message and sessionId are required" });
        }

        logToClients('info', `[${sessionId}] Incoming: "${message.text.substring(0, 50)}..."`);

        // 1. Session Init
        let session = sessions.get(sessionId);
        if (!session) {
            session = {
                sessionId,
                scamDetected: false,
                metrics: { score: 0, reason: "" },
                extractedIntelligence: { // regex based
                    bank_accounts: [], upi_ids: [], urls: [], phones: [], suspiciousKeywords: []
                },
                llmExtractions: {} // store deep extractions
            };
            sessions.set(sessionId, session);
        }

        // 2. Regex Extraction (Fast Pass)
        const regexIntel = extractIntelligence(message.text);
        session.extractedIntelligence = aggregateIntelligence(session.extractedIntelligence, regexIntel);

        // Log extraction details
        const foundKeywords = regexIntel.suspiciousKeywords.map(k => k.raw).join(', ');
        if (foundKeywords) {
            logToClients('alert', `[${sessionId}] ⚠ Suspicious Words Found: ${foundKeywords}`);
        }

        // 3. Deep Analysis (LLM - Scoring & Decision)
        const detailedAnalysis = await detectScam(message.text, conversationHistory || []);
        
        // Log detailed decision
        logToClients('info', `[${sessionId}] Analysis: Score=${detailedAnalysis.maliciousness_score}, Decision=${detailedAnalysis.decision}`);
        
        // Update Session State Logic based on rules
        if (detailedAnalysis.decision === 'activate' || detailedAnalysis.maliciousness_score >= 0.8) {
             if (!session.scamDetected) {
                 session.scamDetected = true;
                 logToClients('alert', `[${sessionId}] HONEYPOT ACTIVATED! (Score: ${detailedAnalysis.maliciousness_score})`);
             }
        }
        
        // Update metrics
        session.metrics.score = detailedAnalysis.maliciousness_score;
        session.metrics.reason = detailedAnalysis.decision_reasons?.[0] || "Detected by system";

        // 4. Generate Response (Persona Logic)
        let replyText = null;
        let mode = 'Monitoring Mode';

        if (session.scamDetected) {
            mode = 'Honeypot Mode';
            const flatIntel = flattenIntelligence(session.extractedIntelligence);
            
            replyText = await generateResponse({
                message,
                history: conversationHistory || [],
                extractedIntelligence: flatIntel,
                metadata,
                mode,
                scamConfidence: session.metrics.score
            });

            // Clean formatting: Strip any AI-generated quotes
            if (replyText) {
                replyText = replyText.replace(/^["']|["']$/g, '').trim();
            }

            logToClients('info', `[${sessionId}] Reply: "${replyText}"`);
        } else {
            logToClients('info', `[${sessionId}] Monitoring Mode: No intervention (Score: ${session.metrics.score})`);
        }

        // 5. Mandatory Final Result Callback
        // Based on Section 12, we report if scam is detected. 
        if (session.scamDetected) {
             const totalMessages = (conversationHistory?.length || 0) + 1;
             const flatIntel = flattenIntelligence(session.extractedIntelligence);

             reportFinalResult({
                sessionId: sessionId,
                scamDetected: true,
                totalMessagesExchanged: totalMessages,
                extractedIntelligence: flatIntel,
                agentNotes: `${session.metrics.reason} [Score: ${session.metrics.score}]`
            }).catch(e => logToClients('error', `Reporting failed: ${e.message}`));
        }

        // 6. Response - STRICTLY matching Spec Section 8
        res.json({
            status: "success",
            reply: replyText 
        });

    } catch (error) {
        logToClients('error', `Error processing request: ${error.message}`);
        res.status(500).json({ status: "error", message: "Internal server error" });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
