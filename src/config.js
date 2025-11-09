const { getDb } = require('./db');

const DEFAULTS = {
    max_retries: '3',
    backoff_base: '2'
};

async function get(key) {
    const db = await getDb();
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
    return (row ? row.value : (DEFAULTS[key] ?? null));
}

async function set(key, value) {
    const db = await getDb();
    // Use INSERT OR REPLACE for sql.js compatibility (doesn't support ON CONFLICT syntax)
    db.prepare('INSERT OR REPLACE INTO config(key,value) VALUES(?, ?)').run(key, String(value));
}

async function getInt(key) {
    const val = await get(key);
    return parseInt(val ?? '0', 10);
}

module.exports = { get, set, getInt, DEFAULTS };
