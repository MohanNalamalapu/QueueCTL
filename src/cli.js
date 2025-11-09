#!/usr/bin/env node
const { Command } = require('commander');
const { enqueue, listByState, status, dlqList, dlqRetry } = require('./queue');
const { set, get, DEFAULTS } = require('./config');
const { getDb } = require('./db');
const { runWorkerLoop } = require('./worker');
const { startWorkers, stopWorkers } = require('./worker-manager');
const path = require('path');
const fs = require('fs');

const program = new Command();
program
    .name('queuectl')
    .description('CLI-based background job queue system')
    .version('0.1.0');

// Pretty banner for interactive runs (optional)
try {
    if (process.argv.length <= 2) {
        const figlet = require('figlet');
        const boxen = require('boxen');
        const chalk = require('chalk');
        const art = figlet.textSync('QUEUECTL', { horizontalLayout: 'default' });
        console.log(boxen(chalk.cyan(art) + '\n\n' + chalk.gray('CLI Version 0.1.0'), { padding: 1, margin: 0, borderStyle: 'round' }));
    }
} catch (e) {
    // ignore if optional deps not installed
}

// Ensure DB init on every run (async initialization)
(async () => {
    await getDb();
})();

program
    .command('enqueue')
    .argument('[json]', 'Job JSON payload')
    .option('--id <id>', 'Job id')
    .option('--command <cmd>', 'Command to execute')
    .option('--max-retries <n>', 'Max retries', '3')
    .option('--priority <n>', 'Priority', '0')
    .option('--run-at <datetime>', 'Schedule job for later (ISO datetime)')
    .action(async (json, options) => {
        let job;
        if (json) {
            try {
                job = JSON.parse(json);
            } catch (e) {
                console.error('Invalid JSON:', e.message);
                process.exit(1);
            }
        } else {
            job = {};
        }
        if (options.id) job.id = options.id;
        if (options.command) job.command = options.command;
        if (options.maxRetries) job.max_retries = parseInt(options.maxRetries);
        if (options.priority) job.priority = parseInt(options.priority);
        if (options.runAt) job.run_at = options.runAt;
        
        if (!job.command) {
            console.error('Error: --command is required');
            process.exit(1);
        }
        
        const id = await enqueue(job);
        console.log(`Job enqueued: ${id}`);
    });

program
    .command('list')
    .option('--state <state>', 'Filter by state (pending, processing, completed, failed, dead)', 'pending')
    .action(async (options) => {
        const jobs = await listByState(options.state);
        console.log(JSON.stringify(jobs, null, 2));
    });

program
    .command('status')
    .action(async () => {
        const stats = await status();
        console.log(JSON.stringify(stats, null, 2));
    });

// DLQ commands
const dlqCommand = program.command('dlq');
dlqCommand
    .command('list')
    .description('List dead letter queue items')
    .action(async () => {
        const items = await dlqList();
        console.log(JSON.stringify(items, null, 2));
    });

dlqCommand
    .command('retry')
    .argument('<id>', 'DLQ item id to retry')
    .description('Retry a job from the dead letter queue')
    .action(async (id) => {
        try {
            const jobId = await dlqRetry(id);
            console.log(`Job ${jobId} re-enqueued from DLQ`);
        } catch (e) {
            console.error('Error:', e.message);
            process.exit(1);
        }
    });

// Config commands
const configCommand = program.command('config');
configCommand
    .command('get')
    .argument('<key>', 'Config key')
    .action(async (key) => {
        // Support both kebab-case and snake_case
        const normalizedKey = key.replace(/-/g, '_');
        const value = await get(normalizedKey);
        console.log(value || '');
    });

configCommand
    .command('set')
    .argument('<key>', 'Config key')
    .argument('<value>', 'Config value')
    .action(async (key, value) => {
        // Support both kebab-case and snake_case
        const normalizedKey = key.replace(/-/g, '_');
        await set(normalizedKey, value);
        console.log(`Config set: ${key} = ${value}`);
    });

// Worker commands
const workerCommand = program.command('worker');
workerCommand
    .command('start')
    .option('--count <n>', 'Number of workers to start', '1')
    .description('Start one or more worker processes')
    .action(async (options) => {
        const count = parseInt(options.count, 10);
        if (isNaN(count) || count < 1) {
            console.error('Error: --count must be a positive integer');
            process.exit(1);
        }
        await startWorkers(count);
    });

workerCommand
    .command('stop')
    .description('Stop all running workers gracefully')
    .action(async () => {
        await stopWorkers();
    });

// Legacy worker command for backward compatibility (runs worker directly)
program
    .command('worker-direct')
    .description('Start a worker process directly (for testing)')
    .action(async () => {
        console.log('Starting worker...');
        await runWorkerLoop();
    });

program.parse();
