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

// ULTRA-ROBUST LOGGING MIDDLEWARE (at the very top)
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`\n>>> [${timestamp}] INCOMING ${req.method} ${req.url}`);
    console.log(`>>> Headers:`, JSON.stringify(req.headers, null, 2));

    // Intercept response to log what we send back
    const oldResJson = res.json;
    res.json = function(body) {
        console.log(`<<< [${new Date().toISOString()}] OUTGOING JSON (${res.statusCode}):`, JSON.stringify(body, null, 2));
        return oldResJson.apply(res, arguments);
    };

    const oldResSend = res.send;
    res.send = function(body) {
        if (typeof body === 'string' && body.startsWith('{')) {
             console.log(`<<< [${new Date().toISOString()}] OUTGOING STRING/JSON (${res.statusCode}):`, body);
        } else {
             console.log(`<<< [${new Date().toISOString()}] OUTGOING (${res.statusCode}) - [Content length: ${body ? body.length : 0}]`);
        }
        return oldResSend.apply(res, arguments);
    };

    next();
});

// Permissive CORS
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-api-key', 'ngrok-skip-browser-warning']
}));

// Robust Body Parsing with detailed error reporting
app.use((req, res, next) => {
    bodyParser.json()(req, res, (err) => {
        if (err) {
            console.error("!!! BODY PARSE ERROR !!!", err.message);
            // Even if parsing fails, we want to know what the raw stream look like if possible
            return res.status(400).json({ 
                status: "error", 
                message: "Invalid JSON format", 
                details: err.message,
                received: "See server logs for raw dump"
            });
        }
        if (req.method === 'POST') {
            console.log(">>> Parsed Body:", JSON.stringify(req.body, null, 2));
        }
        next();
    });
});

// Simple In-Memory Session Store
const sessions = new Map();

// SSE Clients
const sseClients = new Set();
const logToClients = (type, message) => {
    if (type === 'error') console.error(`[LOG] ERROR: ${message}`);
    else console.log(`[LOG] ${type.toUpperCase()}: ${message}`);
    const timestamp = new Date().toISOString();
    try {
        const eventData = JSON.stringify({ type, timestamp, message });
        sseClients.forEach(client => {
            client.write(`data: ${eventData}\n\n`);
        });
    } catch(e) { console.error("SSE Error:", e); }
};

// Root endpoint - Return JSON to be safe with automated testers
app.get('/', (req, res) => res.json({ 
    message: 'HoneyPot AI Backend is alive.', 
    version: '1.0.1-debug',
    branch: 'debug-guvi',
    time: new Date().toISOString()
}));

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
        bankAccounts: (detailedIntel.bank_accounts || []).map(i => i.raw || i),
        upiIds: (detailedIntel.upi_ids || []).map(i => i.raw || i),
        phishingLinks: (detailedIntel.urls || []).map(i => i.raw || i),
        phoneNumbers: (detailedIntel.phones || []).map(i => i.raw || i),
        suspiciousKeywords: (detailedIntel.suspiciousKeywords || []).map(i => i.raw || i)
    };
};

// Auth Middleware
const authenticate = (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.headers['X-API-KEY']; // Try both
    const validKey = process.env.API_KEY || 'GUVI_SECRET_KEY';
    
    console.log(`>>> Checking Auth. Received: "${apiKey}", Expected: "${validKey}"`);

    if (!apiKey || apiKey !== validKey) {
        console.error(`!!! AUTH FAILED !!! Key: ${apiKey}`);
        logToClients('error', `Unauthorized access attempt. Key: ${apiKey}`);
        return res.status(401).json({ status: "error", message: "Unauthorized: Invalid API Key" });
    }
    next();
};

// Route Handler with Trailing Slash Support
const handleChat = async (req, res) => {
    try {
        let { message, conversationHistory, sessionId, metadata } = req.body;
        
        // Robustness: Handle sessionId missing
        sessionId = sessionId || `anon-${Date.now()}`;

        // Robustness: Handle message being a string
        if (typeof message === 'string') {
            message = { text: message, sender: 'scammer', timestamp: new Date().toISOString() };
        }

        if (!message || (!message.text && typeof message !== 'string')) {
            console.error("!!! INVALID PAYLOAD !!!", JSON.stringify(req.body));
            return res.status(400).json({ status: "error", message: "Invalid payload: message.text is required" });
        }

        logToClients('info', `[${sessionId}] Incoming: "${message.text ? message.text.substring(0, 50) : 'No text'}..."`);

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
        const textToAnalyze = message.text || "";
        const regexIntel = extractIntelligence(textToAnalyze);
        session.extractedIntelligence = aggregateIntelligence(session.extractedIntelligence, regexIntel);

        // Log extraction details
        const foundKeywords = regexIntel.suspiciousKeywords.map(k => k.raw || k).join(', ');
        if (foundKeywords) {
            logToClients('alert', `[${sessionId}] ⚠ Suspicious Words Found: ${foundKeywords}`);
        }

        // 3. Deep Analysis (LLM - Scoring & Decision)
        const detailedAnalysis = await detectScam(textToAnalyze, conversationHistory || []);
        
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

            // Sanitization: Remove quotes if LLM accidentally included them
            if (replyText) {
                replyText = replyText.replace(/^["']|["']$/g, '').trim();
            }

            logToClients('info', `[${sessionId}] Reply: "${replyText}"`);
        } else {
            logToClients('info', `[${sessionId}] Monitoring Mode: No intervention (Score: ${session.metrics.score})`);
        }

        // 5. Mandatory Final Result Callback
        if (session.scamDetected) {
             const totalMessages = (conversationHistory?.length || 0) + 1;
             const flatIntel = flattenIntelligence(session.extractedIntelligence);

             const reportPayload = {
                sessionId: sessionId,
                scamDetected: true,
                totalMessagesExchanged: totalMessages,
                extractedIntelligence: flatIntel,
                agentNotes: `${session.metrics.reason} [Score: ${session.metrics.score}]`
            };

            console.log("[Background] Reporting Final Result Payload:", JSON.stringify(reportPayload, null, 2));

             reportFinalResult(reportPayload)
                .then(result => console.log(`[Reporting Success] Session: ${sessionId}`))
                .catch(e => console.error(`[Reporting Failure] Session: ${sessionId}, Error: ${e.message}`));
        }

        // 6. Response - STRICTLY matching Spec Section 8
        res.json({
            status: "success",
            reply: replyText || "" 
        });

    } catch (error) {
        console.error("!!! FATAL ROUTE ERROR !!!", error);
        logToClients('error', `Error processing request: ${error.message}`);
        res.status(500).json({ status: "error", message: "Internal server error", debug: error.message });
    }
};

// Register routes with and without trailing slash
app.post('/api/chat', authenticate, handleChat);
app.post('/api/chat/', authenticate, handleChat);

// Global Error Handler
app.use((err, req, res, next) => {
    console.error("!!! UNHANDLED EXPRESS ERROR !!!", err);
    res.status(500).json({
        status: "error",
        message: "Something went wrong on the server",
        details: err.message
    });
});

app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`Server running (ULTRA-DEBUG) on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`API_KEY set: ${process.env.API_KEY ? 'YES' : 'NO (Using Default)'}`);
    console.log(`========================================\n`);
});
