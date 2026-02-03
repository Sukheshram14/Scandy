# HoneyPot AI - Agentic Scam Detection System

An autonomous AI honeypot backend designed to detect scam messages, engage scammers with a believable persona, and extract actionable intelligence (UPI IDs, bank accounts, phishing links). Built for the India AI Impact Buildathon.

## Features

- **Multi-channel Support**: Adapts persona for SMS, WhatsApp, and Email.
- **Scam Detection**: Hybrid approach using Regex heuristics + LLM (Groq) semantic analysis.
- **Honeypot Persona**: Believable Indian user persona ("confused but cooperative") to keep scammers talking.
- **Intelligence Extraction**: Continuously scans for and aggregates critical info.
- **Secure**: Implements API Key Rotation for Groq to handle rate limits.
- **CLI Client**: Interactive terminal interface for testing and live log monitoring.

## Project Structure

- `server.js`: Main Express API entry point.
- `cli.js`: Interactive Client for testing and logging.
- `services/`: Core logic modules.
- `test_mock.js`: Simple test script.

## Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment**
   Update `.env` with your Groq API keys:
   ```env
   PORT=3000
   GROQ_API_KEY_1=gsk_...
   GROQ_API_KEY_2=gsk_...
   GROQ_API_KEY_3=gsk_...
   ```

3. **Start Server**
   ```bash
   npm start
   ```
   Server will run on `http://localhost:3000`.

## Using the CLI Client

The CLI allows you to interact with the API and view live logs.

1. **Run the tool** (in a separate terminal):
   ```bash
   node cli.js
   ```
2. **Select Mode**:
   - **Test API**: Chat properly with the bot as a scammer.
   - **Live Logs**: Watch server events in real-time (requires server running).
   - **Health Check**: Ping the server.

## API Usage

**Headers:**
- `Content-Type: application/json`
- `x-api-key: GUVI_SECRET_KEY` (Configurable in `.env`)

**Payload:**
```json
{
  "sessionId": "unique-session-id",
  "message": {
    "sender": "scammer",
    "text": "Your account is blocked. Verify now.",
    "timestamp": "2026-01-21T10:15:30Z"
  },
  "conversationHistory": [], 
  "metadata": {
    "channel": "SMS",
    "language": "English",
    "locale": "IN"
  }
}
```

**Response:**
```json
{
  "status": "success",
  "reply": "Wait, what happened to my account?"
}
```
