const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(process.cwd(), 'queue.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db = null;
let dbReady = false;

function init() {
    if (dbReady && db) return db;

    const exists = fs.existsSync(DB_PATH);
    // Open the database with default options; file will be created if missing
    db = new Database(DB_PATH);

    // Recommended pragmas for concurrency
    try {
        // WAL gives better concurrent read/write behavior
        db.pragma('journal_mode = WAL');
        // Wait up to 5s for locks
        db.pragma('busy_timeout = 5000');
    } catch (e) {
        console.warn('Warning setting pragmas:', e && e.message);
    }

    // If database just created, apply schema
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    try {
        // execute schema (works fine when statements use IF NOT EXISTS)
        db.exec(schema);
    } catch (e) {
        // If exec fails, rethrow - schema should be valid SQL for SQLite
        console.error('Applying schema failed:', e && e.message);
        throw e;
    }

    dbReady = true;
    return db;
}

async function getDb() {
    // Keep async signature to minimize changes elsewhere in codebase
    if (!dbReady || !db) init();
    return db;
}

function saveDb() {
    // No-op for better-sqlite3: DB is file-backed and synchronous by default
}

function closeDb() {
    if (db) {
        try {
            db.close();
        } catch (e) {
            // ignore
        }
        db = null;
        dbReady = false;
    }
}

module.exports = { getDb, DB_PATH, saveDb, closeDb };
