const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const { detectScam } = require('./services/scamDetector');
const { generateResponse } = require('./services/personaEngine');
const { extractIntelligence, aggregateIntelligence } = require('./services/intelligenceExtractor');
const { reportFinalResult } = require('./services/reportingService');
const { connectDB } = require('./services/db');
const Session = require('./models/Session');
const { encrypt, decrypt } = require('./services/encryption');

// Connect to MongoDB
connectDB();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

app.use((req, res, next) => {
    console.log(`[HTTP] ${req.method} ${req.url}`);
    next();
});

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
        const { message, conversationHistory, sessionId, metadata } = req.body;
        if (!sessionId || !message) return res.status(400).json({ status: "error", message: "Invalid payload" });

        logToClients('info', `[${sessionId}] Incoming: "${message.text ? message.text.substring(0, 50) : 'No text'}..."`);

        // 1. Session Retrieval (MongoDB)
        let sessionData = await Session.findOne({ sessionId });
        
        if (!sessionData) {
            sessionData = new Session({
                sessionId,
                scamDetected: false,
                metrics: { score: 0, reason: "" },
                extractedIntelligence: {
                    bankAccounts: [], upiIds: [], phishingLinks: [], phoneNumbers: [], suspiciousKeywords: []
                },
                conversationHistory: conversationHistory || []
            });
        } else {
            // Decrypt for application use
            sessionData.decryptData();
            // Update history from request if provided
            if (conversationHistory) {
                sessionData.conversationHistory = conversationHistory;
            }
        }

        // 2. Regex Extraction (Fast Pass)
        const regexIntel = extractIntelligence(message.text);
        
        // Map regex results back to DB format
        const currentIntel = flattenIntelligence(regexIntel);
        
        // Append new intel to sessionData
        sessionData.extractedIntelligence.bankAccounts = [...new Set([...sessionData.extractedIntelligence.bankAccounts, ...currentIntel.bankAccounts])];
        sessionData.extractedIntelligence.upiIds = [...new Set([...sessionData.extractedIntelligence.upiIds, ...currentIntel.upiIds])];
        sessionData.extractedIntelligence.phishingLinks = [...new Set([...sessionData.extractedIntelligence.phishingLinks, ...currentIntel.phishingLinks])];
        sessionData.extractedIntelligence.phoneNumbers = [...new Set([...sessionData.extractedIntelligence.phoneNumbers, ...currentIntel.phoneNumbers])];
        sessionData.extractedIntelligence.suspiciousKeywords = [...new Set([...sessionData.extractedIntelligence.suspiciousKeywords, ...currentIntel.suspiciousKeywords])];

        // Log extraction details
        const foundKeywords = regexIntel.suspiciousKeywords.map(k => k.raw).join(', ');
        if (foundKeywords) {
            logToClients('alert', `[${sessionId}] ⚠ Suspicious Words Found: ${foundKeywords}`);
        }

        // 3. Deep Analysis (LLM - Scoring & Decision)
        const detailedAnalysis = await detectScam(message.text, sessionData.conversationHistory);
        
        // Log detailed decision
        logToClients('info', `[${sessionId}] Analysis: Score=${detailedAnalysis.maliciousness_score}, Decision=${detailedAnalysis.decision}`);
        
        // Update Session State Logic based on rules
        if (detailedAnalysis.decision === 'activate' || detailedAnalysis.maliciousness_score >= 0.8) {
             if (!sessionData.scamDetected) {
                 sessionData.scamDetected = true;
                 logToClients('alert', `[${sessionId}] HONEYPOT ACTIVATED! (Score: ${detailedAnalysis.maliciousness_score})`);
             }
        }
        
        // Update metrics
        sessionData.metrics.score = detailedAnalysis.maliciousness_score;
        sessionData.metrics.reason = detailedAnalysis.decision_reasons?.[0] || "Detected by system";

        // 4. Generate Response (Persona Logic)
        let replyText = null;
        let mode = 'Monitoring Mode';

        if (sessionData.scamDetected) {
            mode = 'Honeypot Mode';
            
            replyText = await generateResponse({
                message,
                history: sessionData.conversationHistory,
                extractedIntelligence: sessionData.extractedIntelligence,
                metadata,
                mode,
                scamConfidence: sessionData.metrics.score
            });

            logToClients('info', `[${sessionId}] Reply: "${replyText}"`);
        } else {
            logToClients('info', `[${sessionId}] Monitoring Mode: No intervention (Score: ${sessionData.metrics.score})`);
        }

        // Add latest message to history
        sessionData.conversationHistory.push({
            sender: "scammer",
            text: message.text,
            timestamp: new Date()
        });
        if (replyText) {
            sessionData.conversationHistory.push({
                sender: "user",
                text: replyText,
                timestamp: new Date()
            });
        }

        sessionData.agentNotes = `${sessionData.metrics.reason} [Score: ${sessionData.metrics.score}]`;
        sessionData.lastInteraction = new Date();

        // 5. Mandatory Final Result Callback
        if (sessionData.scamDetected) {
             reportFinalResult({
                sessionId: sessionId,
                scamDetected: true,
                totalMessagesExchanged: sessionData.conversationHistory.length,
                extractedIntelligence: sessionData.extractedIntelligence,
                agentNotes: sessionData.agentNotes
            }).catch(e => logToClients('error', `Reporting failed: ${e.message}`));
        }

        // Save to MongoDB
        console.log(`[DB] Final Save for session: ${sessionId}`);
        await sessionData.save();

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
