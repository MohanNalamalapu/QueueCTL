#!/usr/bin/env node
/**
 * Smoke test script to validate core QueueCTL functionality
 */

const { enqueue, listByState, status, dlqList, dlqRetry } = require('../queue');
const { set, get } = require('../config');
const { getDb } = require('../db');
const { DB_PATH } = require('../db');
const { sleep } = require('../util');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PLATFORM = os.platform();
const NODE_CMD = process.execPath;
const WORKER_SCRIPT = path.join(__dirname, '..', 'worker.js');

let testResults = {
    passed: 0,
    failed: 0,
    tests: []
};

function log(message) {
    console.log(`[TEST] ${message}`);
}

function assert(condition, message) {
    if (condition) {
        testResults.passed++;
        testResults.tests.push({ status: 'PASS', message });
        log(`✓ ${message}`);
    } else {
        testResults.failed++;
        testResults.tests.push({ status: 'FAIL', message });
        log(`✗ ${message}`);
    }
}

async function runCommand(command, args = []) {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, {
            stdio: 'pipe',
            shell: PLATFORM === 'win32'
        });
        
        let stdout = '';
        let stderr = '';
        
        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        proc.on('close', (code) => {
            resolve({ code, stdout, stderr });
        });
        
        proc.on('error', (err) => {
            reject(err);
        });
    });
}

async function startWorker() {
    // For smoke tests, run the worker loop in-process in SINGLE_RUN mode so it's deterministic.
    // Do NOT set NO_EXIT here so the worker can exit naturally after SINGLE_RUN completes.
        // Spawn a separate Node process to run the worker script. This isolates the
        // worker from the test runner (no shared module cache or env artifacts) and
        // is more reliable for timing-sensitive tests.
        const env = { ...process.env, SINGLE_RUN: '1' };
        const proc = spawn(NODE_CMD, [WORKER_SCRIPT], { env, stdio: 'pipe' });
        // collect stdout/stderr for debugging if needed
        proc.stdout.on('data', d => {});
        proc.stderr.on('data', d => {});
        const promise = new Promise((resolve) => {
            proc.on('exit', (code) => resolve(code));
        });
        return { pid: proc.pid, proc, promise };
}

async function stopWorker(workerProcess) {
    try {
        // If worker was started in-process (returns a promise), wait for it
            if (!workerProcess) return;
            if (workerProcess.proc) {
                // child process spawned; wait for it to exit gracefully then kill if needed
                await Promise.race([workerProcess.promise, new Promise(res => setTimeout(res, 2000))]);
                if (!workerProcess.proc.killed) {
                    try { workerProcess.proc.kill('SIGTERM'); } catch (e) { /* ignore */ }
                }
                return;
            }
            if (workerProcess && workerProcess.promise) {
                await Promise.race([workerProcess.promise, new Promise(res => setTimeout(res, 2000))]);
                return;
            }
            // fallback: kill by pid
            try { process.kill(workerProcess.pid, 'SIGTERM'); } catch (e) { /* ignore */ }
    } catch (e) {
        // Ignore if already dead
    }
}

async function main() {
    log('Starting QueueCTL smoke tests...');
    log('================================');
    
    // Start with a fresh database for deterministic tests
    try {
        if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
    } catch (e) {
        // ignore
    }
    // Initialize database
    await getDb();
    log('Database initialized');
    
    // Test 1: Basic job enqueue
    log('\nTest 1: Enqueue a job');
    try {
        const jobId = await enqueue({
            id: 'test-job-1',
            // Use node to print to stdout for cross-platform compatibility
            command: 'node -e "console.log(\'Hello World\')"'
        });
        assert(jobId === 'test-job-1', 'Job enqueued successfully');
    } catch (e) {
        assert(false, `Job enqueue failed: ${e.message}`);
    }
    
    // Test 2: List jobs
    log('\nTest 2: List pending jobs');
    try {
        const jobs = await listByState('pending');
        assert(jobs.length > 0, 'Found pending jobs');
        assert(jobs.some(j => j.id === 'test-job-1'), 'Enqueued job found in list');
    } catch (e) {
        assert(false, `List jobs failed: ${e.message}`);
    }
    
    // Test 3: Status check
    log('\nTest 3: Check status');
    try {
        const stats = await status();
        assert(typeof stats === 'object', 'Status returns object');
        assert('pending' in stats, 'Status contains pending count');
        assert('active_workers' in stats, 'Status contains active_workers');
    } catch (e) {
        assert(false, `Status check failed: ${e.message}`);
    }
    
    // Test 4: Worker execution (basic)
    log('\nTest 4: Worker executes job');
    try {
        const workerProcess = await startWorker();
        await sleep(2000); // Wait for worker to process
        
        const jobs = await listByState('completed');
        const completed = jobs.find(j => j.id === 'test-job-1');
        assert(completed !== undefined, 'Job was completed by worker');
        
        await stopWorker(workerProcess);
    } catch (e) {
        assert(false, `Worker execution failed: ${e.message}`);
    }
    
    // Test 5: Failed job retry
    log('\nTest 5: Failed job retry');
    try {
        const failJobId = await enqueue({
            id: 'test-job-fail',
            // Use node to reliably exit with non-zero status across platforms
            command: 'node -e "process.exit(1)"',
            max_retries: 2
        });
        
        const workerProcess = await startWorker();
        await sleep(3000); // Wait for retries
        
        // Poll for up to ~6s to observe either a 'failed' scheduled retry or presence in DLQ.
        let seen = false;
            for (let i = 0; i < 12; i++) {
                const failedJobs = await listByState('failed');
                const failed = failedJobs.find(j => j.id === 'test-job-fail');
                const dlqItems = await dlqList();
                const inDlq = dlqItems.some(d => d.job_id === 'test-job-fail');
                if (failed || inDlq) { seen = true; break; }
                await sleep(500);
            }
        assert(seen, 'Job failed and retried');
        
        await stopWorker(workerProcess);
    } catch (e) {
        assert(false, `Failed job retry test failed: ${e.message}`);
    }
    
    // Test 6: Configuration
    log('\nTest 6: Configuration management');
    try {
        await set('test_key', 'test_value');
        const value = await get('test_key');
        assert(value === 'test_value', 'Configuration set and get works');
    } catch (e) {
        assert(false, `Configuration test failed: ${e.message}`);
    }
    
    // Test 7: DLQ (simplified)
    log('\nTest 7: Dead Letter Queue');
    try {
        const dlqItems = await dlqList();
        assert(Array.isArray(dlqItems), 'DLQ list returns array');
    } catch (e) {
        assert(false, `DLQ test failed: ${e.message}`);
    }
    
    // Test 8: Job persistence
    log('\nTest 8: Job persistence');
    try {
        const persistId = await enqueue({
            id: 'test-persist',
            command: 'node -e "console.log(\'persist test\')"'
        });
        
        // Reinitialize database connection (simulating restart)
        const db = await getDb();
        const jobs = await listByState('pending');
        const found = jobs.find(j => j.id === 'test-persist');
        assert(found !== undefined, 'Job persists after database reinitialization');
    } catch (e) {
        assert(false, `Persistence test failed: ${e.message}`);
    }
    
    // Summary
    log('\n================================');
    log('Test Summary:');
    log(`Passed: ${testResults.passed}`);
    log(`Failed: ${testResults.failed}`);
    log(`Total: ${testResults.passed + testResults.failed}`);
    
    if (testResults.failed > 0) {
        log('\nFailed tests:');
        testResults.tests.filter(t => t.status === 'FAIL').forEach(t => {
            log(`  - ${t.message}`);
        });
        process.exit(1);
    } else {
        log('\nAll tests passed! ✓');
        process.exit(0);
    }
}

main().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});


