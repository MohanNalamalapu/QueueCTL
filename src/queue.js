const { nanoid } = require('nanoid');
const { getDb } = require('./db');
const { nowISO } = require('./util');

async function enqueue(job) {
    const db = await getDb();
    const id = job.id || `job_${nanoid(8)}`;
    const created = nowISO();
    const maxRetries = job.max_retries ?? 3;
    const priority = job.priority ?? 0;

    db.prepare(`INSERT INTO jobs (id, command, state, attempts, max_retries, created_at, updated_at, run_at, last_error, priority, locked_by, lock_until)
VALUES (?, ?, 'pending', 0, ?, ?, ?, ?, NULL, ?, NULL, NULL)`)
        .run(id, job.command, maxRetries, created, created, job.run_at || null, priority);
    return id;
}

async function listByState(state) {
    const db = await getDb();
    if (state === 'dead') {
        return db.prepare('SELECT * FROM dlq ORDER BY dead_at DESC').all();
    }
    return db.prepare('SELECT * FROM jobs WHERE state = ? ORDER BY created_at ASC').all(state);
}

async function status() {
    const db = await getDb();
    const counts = db.prepare(`SELECT state, COUNT(*) as cnt FROM jobs GROUP BY state`).all();
    const map = { pending: 0, processing: 0, completed: 0, failed: 0, dead: 0 };
    counts.forEach(r => {
        if (r.state && map.hasOwnProperty(r.state)) {
            // sql.js returns numbers as strings sometimes, convert to int
            const cnt = typeof r.cnt === 'string' ? parseInt(r.cnt, 10) : (r.cnt || 0);
            map[r.state] = cnt;
        }
    });
    
    // For active workers, check heartbeat within last 10 seconds
    // sql.js datetime functions work differently, so we'll use a simpler approach
    const now = new Date();
    const tenSecondsAgo = new Date(now.getTime() - 10000).toISOString();
    const allWorkers = db.prepare(`SELECT heartbeat_at FROM workers`).all();
    const activeWorkersCount = allWorkers.filter(w => w.heartbeat_at && w.heartbeat_at >= tenSecondsAgo).length;
    
    const oldestPending = db.prepare(`SELECT created_at FROM jobs WHERE state='pending' ORDER BY created_at ASC LIMIT 1`).get();
    return { ...map, active_workers: activeWorkersCount, oldest_pending: oldestPending?.created_at || null };
}

async function dlqList() {
    const db = await getDb();
    return db.prepare('SELECT * FROM dlq ORDER BY dead_at DESC').all();
}

async function dlqRetry(id) {
    const db = await getDb();
    const row = db.prepare('SELECT * FROM dlq WHERE id = ?').get(id);
    if (!row) throw new Error(`DLQ item not found: ${id}`);
    const payload = JSON.parse(row.payload);
    const now = nowISO();
    const tx = db.transaction(() => {
        db.prepare('DELETE FROM dlq WHERE id = ?').run(id);
        db.prepare(`INSERT INTO jobs(id, command, state, attempts, max_retries, created_at, updated_at, run_at, last_error, priority, locked_by, lock_until)
VALUES(?, ?, 'pending', 0, ?, ?, ?, NULL, NULL, ?, NULL, NULL)`)
            .run(payload.id, payload.command, payload.max_retries ?? 3, now, now, payload.priority ?? 0);
    });
    tx();
    return payload.id;
}

module.exports = { enqueue, listByState, status, dlqList, dlqRetry };
