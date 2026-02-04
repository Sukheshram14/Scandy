const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../services/encryption');

const MessageSchema = new mongoose.Schema({
    sender: String,
    text: String,
    timestamp: { type: Date, default: Date.now }
}, { _id: true });

const SessionSchema = new mongoose.Schema({
    sessionId: { type: String, required: true, unique: true },
    scamDetected: { type: Boolean, default: false },
    metrics: {
        score: { type: Number, default: 0 },
        reason: { type: String, default: "" }
    },
    extractedIntelligence: {
        bankAccounts: [String],
        upiIds: [String],
        phishingLinks: [String],
        phoneNumbers: [String],
        suspiciousKeywords: [String]
    },
    conversationHistory: [MessageSchema],
    agentNotes: String,
    lastInteraction: { type: Date, default: Date.now }
}, { 
    timestamps: true 
});

// Encryption Middleware
SessionSchema.pre('save', function() {
    const session = this;

    if (session.extractedIntelligence) {
        if (session.extractedIntelligence.bankAccounts) session.extractedIntelligence.bankAccounts = session.extractedIntelligence.bankAccounts.map(encrypt);
        if (session.extractedIntelligence.upiIds) session.extractedIntelligence.upiIds = session.extractedIntelligence.upiIds.map(encrypt);
        if (session.extractedIntelligence.phishingLinks) session.extractedIntelligence.phishingLinks = session.extractedIntelligence.phishingLinks.map(encrypt);
        if (session.extractedIntelligence.phoneNumbers) session.extractedIntelligence.phoneNumbers = session.extractedIntelligence.phoneNumbers.map(encrypt);
    }

    if (session.conversationHistory) {
        session.conversationHistory.forEach(msg => {
            if (msg.text && !msg.text.includes(':')) msg.text = encrypt(msg.text);
        });
    }

    if (session.agentNotes && !session.agentNotes.includes(':')) {
        session.agentNotes = encrypt(session.agentNotes);
    }
});

// Decryption Method
SessionSchema.methods.decryptData = function() {
    const session = this;
    
    if (session.extractedIntelligence) {
        session.extractedIntelligence.bankAccounts = session.extractedIntelligence.bankAccounts.map(decrypt);
        session.extractedIntelligence.upiIds = session.extractedIntelligence.upiIds.map(decrypt);
        session.extractedIntelligence.phishingLinks = session.extractedIntelligence.phishingLinks.map(decrypt);
        session.extractedIntelligence.phoneNumbers = session.extractedIntelligence.phoneNumbers.map(decrypt);
    }

    if (session.conversationHistory) {
        session.conversationHistory.forEach(msg => {
            if (msg.text) msg.text = decrypt(msg.text);
        });
    }

    if (session.agentNotes) {
        session.agentNotes = decrypt(session.agentNotes);
    }

    return session;
};

module.exports = mongoose.model('Session', SessionSchema);
