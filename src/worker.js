const { exec } = require('child_process');
const { promisify } = require('util');
const { getDb } = require('./db');
const { getInt } = require('./config');
const { nowISO, addSeconds, sleep, backoff } = require('./util');
const { nanoid } = require('nanoid');

const execAsync = promisify(exec);
const WORKER_ID = `worker_${nanoid(8)}`;
const SINGLE_RUN = process.env.SINGLE_RUN === '1';
let STOPPING = false;
let currentJob = null;

async function executeCommand(command) {
    try {
        const { stdout, stderr } = await execAsync(command, { timeout: 30000 });
        return { ok: true, stdout, stderr };
    } catch (err) {
        return { ok: false, error: err.message, stderr: err.stderr || '', code: err.code || 1 };
    }
}

async function heartbeat(db) {
    const now = nowISO();
    const pid = process.pid || 0;
    try {
        db.prepare(`INSERT OR REPLACE INTO workers(id, pid, started_at, heartbeat_at) VALUES(?, ?, COALESCE((SELECT started_at FROM workers WHERE id = ?), ?), ?)`)
            .run(WORKER_ID, pid, WORKER_ID, now, now);
    } catch (e) {
        // ignore heartbeat errors
    }
}

async function refreshLock(db) {
    if (!currentJob) return;
    const extend = addSeconds(nowISO(), 60);
    try {
        db.prepare(`UPDATE jobs SET lock_until = ? WHERE id = ? AND locked_by = ?`).run(extend, currentJob.id, WORKER_ID);
    } catch (e) {
        // ignore
    }
}

async function claimJob(db) {
    const now = nowISO();
    const lockUntil = addSeconds(now, 60);

    // Atomically claim one eligible job and increment attempts
    const upd = db.prepare(
        `UPDATE jobs SET state = 'processing', locked_by = ?, lock_until = ?, attempts = attempts + 1, updated_at = ? 
         WHERE id = (
             SELECT id FROM jobs
             WHERE state IN ('pending','failed') AND (run_at IS NULL OR run_at <= ?) AND (lock_until IS NULL OR lock_until <= ?)
             ORDER BY priority DESC, created_at ASC
             LIMIT 1
         )`
    ).run(WORKER_ID, lockUntil, now, now, now);

    if (!upd || upd.changes === 0) return null;
    const job = db.prepare("SELECT * FROM jobs WHERE locked_by = ? AND state = 'processing' ORDER BY updated_at DESC LIMIT 1").get(WORKER_ID);
    return job || null;
}

async function processJob(db, job) {
    currentJob = job;
    // refresh lock periodically
    const refresher = setInterval(() => refreshLock(db), 10000);
    try {
        const base = await getInt('backoff_base') || 2;
        const maxRetries = job.max_retries ?? 3;

        // attempts was incremented at claim time
        const attemptsNow = job.attempts || 1;
        console.log(`Worker ${WORKER_ID} executing job ${job.id} attempt ${attemptsNow}/${maxRetries}`);

        const res = await executeCommand(job.command);
        const now = nowISO();
        if (res.ok) {
            db.prepare(`UPDATE jobs SET state = 'completed', updated_at = ?, locked_by = NULL, lock_until = NULL, last_error = NULL WHERE id = ?`).run(now, job.id);
            return;
        }

        if (attemptsNow < maxRetries) {
            const delay = backoff(base, attemptsNow);
            const runAt = addSeconds(now, delay);
            // schedule next try by setting run_at and marking as failed until it's due
            db.prepare(`UPDATE jobs SET state = 'failed', attempts = ?, run_at = ?, updated_at = ?, last_error = ?, locked_by = NULL, lock_until = ? WHERE id = ?`)
                .run(attemptsNow, runAt, now, `exit=${res.code}: ${(res.error || res.stderr || '').slice(0,200)}`, runAt, job.id);
            console.log(`Job ${job.id} failed (attempt ${attemptsNow}); scheduled at ${runAt}`);
            return;
        }

        // exhausted -> DLQ
        const deadAt = nowISO();
        const payload = JSON.stringify({ id: job.id, command: job.command, max_retries: job.max_retries, priority: job.priority });
        const tx = db.transaction(() => {
            db.prepare(`INSERT INTO dlq(id, job_id, payload, dead_at) VALUES(?, ?, ?, ?)`).run(`dlq_${job.id}`, job.id, payload, deadAt);
            db.prepare(`UPDATE jobs SET state = 'dead', updated_at = ?, locked_by = NULL, lock_until = NULL, last_error = ? WHERE id = ?`).run(deadAt, `exit=${res.code}: ${(res.error || res.stderr || '').slice(0,200)}`, job.id);
        });
        tx();
        console.log(`Job ${job.id} moved to DLQ at ${deadAt}`);
    } finally {
        clearInterval(refresher);
        currentJob = null;
    }
}

async function runWorkerLoop() {
    const db = await getDb();
    await heartbeat(db);

    const cleanup = async () => {
        STOPPING = true;
        if (currentJob) {
            console.log('Waiting for current job to finish...');
            let wait = 0;
            while (currentJob && wait < 30) { await sleep(1000); wait++; }
        }
        // Do not call process.exit() here; allow the caller to decide when to exit.
        return;
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    while (!STOPPING) {
        try {
            await heartbeat(db);
            const job = await claimJob(db);
            if (!job) { await sleep(200); continue; }
            await processJob(db, job);
            if (SINGLE_RUN) { STOPPING = true; }
        } catch (e) {
            console.error('Worker error:', e && e.message ? e.message : e);
            await sleep(1000);
        }
    }

    // Return to caller; do not force process.exit here.
    return;
}

if (require.main === module) {
    runWorkerLoop().catch(err => {
        console.error('Worker error:', err && err.message ? err.message : err);
        if (!process.env.NO_EXIT) process.exit(1);
    });
}

module.exports = { runWorkerLoop, WORKER_ID };
