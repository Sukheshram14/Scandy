const inquirer = require('inquirer');
const chalk = require('chalk');
const axios = require('axios');
const EventSource = require('eventsource');

const BASE_URL = 'http://localhost:3000';
const SESSION_ID = 'cli-session-' + Date.now();
let history = [];

console.clear();
console.log(chalk.cyan.bold('HoneyPot AI - CLI Client Interface'));
console.log(chalk.gray('-------------------------------------'));

const mainMenu = async () => {
    const { choice } = await inquirer.prompt([
        {
            type: 'list',
            name: 'choice',
            message: 'Select Mode:',
            choices: [
                'Test API (Interactive Chat)',
                'Live Logs (Stream Server Events)',
                'Health Check',
                'Exit'
            ]
        }
    ]);

    switch (choice) {
        case 'Test API (Interactive Chat)':
            await startChat();
            break;
        case 'Live Logs (Stream Server Events)':
            await streamLogs();
            break;
        case 'Health Check':
            await checkHealth();
            break;
        case 'Exit':
            process.exit(0);
            break;
    }
};

const checkHealth = async () => {
    try {
        const response = await axios.get(BASE_URL);
        console.log(chalk.green('✔ Server is ONLINE'));
        console.log(`Response: ${response.data}`);
    } catch (error) {
        console.log(chalk.red('✖ Server is OFFLINE or unreachable'));
        console.log(error.message);
    }
    await waitForEnter();
    mainMenu();
};

const streamLogs = async () => {
    console.clear();
    console.log(chalk.yellow('Connecting to log stream... (Press Ctrl+C to stop, waiting for logs...)'));
    
    try {
        const evtSource = new EventSource(`${BASE_URL}/api/events`);

        evtSource.onopen = () => {
            console.log(chalk.green('✔ Connected to Log Stream'));
            console.log(chalk.gray('---------------------------'));
        };

        evtSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                const time = data.timestamp.split('T')[1].split('.')[0];
                let msg = `[${time}] ${data.message}`;

                if (data.type === 'error') console.log(chalk.red(msg));
                else if (data.type === 'alert') console.log(chalk.bgRed.white(msg));
                else console.log(chalk.blue(msg));
            } catch (e) {
                console.log(event.data);
            }
        };

        evtSource.onerror = (err) => {
            if (err) {
                 // EventSource error handling is tricky in Node, often just reconnects
                 console.log(chalk.red('Connection lost. Reconnecting...'));
            }
        };

    } catch (e) {
        console.log(chalk.red('Failed to connect to SSE stream.'));
    }
};

const startChat = async () => {
    console.clear();
    console.log(chalk.cyan('Interactive Chat Mode'));
    console.log(chalk.gray(`Session ID: ${SESSION_ID}`));
    console.log(chalk.gray("Type 'exit' to return to menu."));
    console.log('');

    while (true) {
        const { text } = await inquirer.prompt([
            {
                type: 'input',
                name: 'text',
                message: chalk.green('You (Scammer):')
            }
        ]);

        if (text.toLowerCase() === 'exit') break;

        const payload = {
            sessionId: SESSION_ID,
            message: {
                sender: 'scammer',
                text: text,
                timestamp: new Date().toISOString()
            },
            conversationHistory: history,
            metadata: { channel: 'CLI' }
        };

        try {
            process.stdout.write(chalk.gray('Sending... '));
            const start = Date.now();
            const response = await axios.post(`${BASE_URL}/api/chat`, payload, {
                headers: { 'x-api-key': 'GUVI_SECRET_KEY' }
            });
            const duration = Date.now() - start;
            process.stdout.write(chalk.gray(`(${duration}ms)\n`));

            const data = response.data;
            
            // Display Response
            const replyColor = data.scamDetected ? chalk.magenta : chalk.white;
            console.log(`${chalk.bold('HoneyPot AI')}: ${replyColor(data.reply)}`);
            
            if (data.scamDetected) {
                console.log(chalk.red(`[ALERT] Scam Detected! Confidence: ${data.confidence}`));
            }
            
            if (data.extractedIntelligence) {
                const intel = data.extractedIntelligence;
                const hasIntel = intel.upiIds.length > 0 || intel.phishingLinks.length > 0 || intel.bankAccounts.length > 0 || intel.suspiciousKeywords.length > 0;
                
                if (hasIntel) {
                    console.log(chalk.yellow('Extracted Intel:'));
                    if(intel.suspiciousKeywords.length > 0) console.log(chalk.red(`  Keywords: ${intel.suspiciousKeywords.join(', ')}`));
                    if(intel.upiIds.length > 0) console.log(chalk.cyan(`  UPI: ${intel.upiIds.join(', ')}`));
                    if(intel.bankAccounts.length > 0) console.log(chalk.cyan(`  Bank: ${intel.bankAccounts.join(', ')}`));
                    if(intel.phishingLinks.length > 0) console.log(chalk.red(`  Links: ${intel.phishingLinks.join(', ')}`));
                }
            }

            console.log(''); // Newline

            // Update history
            history.push({ sender: 'scammer', text: text, timestamp: payload.message.timestamp });
            history.push({ sender: 'user', text: data.reply, timestamp: new Date().toISOString() });

        } catch (error) {
            console.log(chalk.red(`\nError: ${error.message}`));
        }
    }

    mainMenu();
};

const waitForEnter = async () => {
    await inquirer.prompt([{ type: 'plain', name: 'wait', message: 'Press Enter to continue...' }]);
};

// Start
mainMenu();
