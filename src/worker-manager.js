// src/worker-manager.js
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getDb } = require('./db'); // kept in case you reference it later
const os = require('os');

const PID_FILE = path.join(process.cwd(), '.workers.pid');

/**
 * Cross-platform, robust process terminator.
 * - On Windows, prefers %SystemRoot%\System32\taskkill.exe and falls back to SIGTERM if unavailable.
 * - On POSIX, sends SIGTERM.
 * - Never throws; any failures are swallowed to avoid crashing the CLI.
 */
function killPidCrossPlatform(pid) {
  // First, check if process exists; if not, just return
  try { process.kill(pid, 0); } catch { return; }

  if (process.platform === 'win32') {
    const TASKKILL = process.env.SystemRoot
      ? `${process.env.SystemRoot}\\System32\\taskkill.exe`
      : 'taskkill';

    try {
      const child = spawn(TASKKILL, ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        detached: true,
      });
      // If spawning taskkill itself fails (e.g., ENOENT), fall back to SIGTERM
      child.on('error', () => {
        try { process.kill(pid, 'SIGTERM'); } catch {}
      });
    } catch {
      try { process.kill(pid, 'SIGTERM'); } catch {}
    }
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch {}
  }
}

function loadWorkerPIDs() {
  if (!fs.existsSync(PID_FILE)) return [];
  try {
    const data = fs.readFileSync(PID_FILE, 'utf8');
    return data.split('\n').filter(pid => pid.trim()).map(pid => parseInt(pid, 10)).filter(n => !Number.isNaN(n));
  } catch {
    return [];
  }
}

function saveWorkerPIDs(pids) {
  try {
    if (!pids || pids.length === 0) {
      if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
      return;
    }
    fs.writeFileSync(PID_FILE, pids.join('\n') + '\n');
  } catch {
    // ignore write errors
  }
}

function addWorkerPID(pid) {
  const pids = loadWorkerPIDs();
  if (!pids.includes(pid)) {
    pids.push(pid);
    saveWorkerPIDs(pids);
  }
}

function removeWorkerPID(pid) {
  const pids = loadWorkerPIDs().filter(p => p !== pid);
  saveWorkerPIDs(pids);
}

async function startWorkers(count = 1) {
  const workerScript = path.join(__dirname, 'worker.js');
  const startedPIDs = [];

  for (let i = 0; i < count; i++) {
    // Spawn worker as a detached background process so the CLI returns immediately.
    // Use stdio 'ignore' to avoid open pipes keeping the parent event loop alive.
    const workerProcess = spawn(process.execPath, [workerScript], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    // Detach and allow the child to continue after the parent exits.
    try { workerProcess.unref(); } catch { /* ignore */ }

    // Keep these handlers minimal and non-fatal
    workerProcess.on('error', (err) => {
      // Just log; do not throw/unhandled
      console.error(`Failed to start worker ${i + 1}: ${err.message}`);
    });

    workerProcess.on('exit', (code) => {
      // Clean stale PID on natural exit
      removeWorkerPID(workerProcess.pid);
      if (code !== 0 && code !== null) {
        console.log(`Worker ${workerProcess.pid} exited with code ${code}`);
      }
    });

    // Give process a moment to start and get PID
    await new Promise(resolve => setTimeout(resolve, 150));

    // Verify process is still running
    try {
      process.kill(workerProcess.pid, 0); // Check if process exists
      addWorkerPID(workerProcess.pid);
      startedPIDs.push(workerProcess.pid);
      console.log(`Started worker ${i + 1} with PID ${workerProcess.pid}`);
    } catch {
      console.error(`Worker ${i + 1} failed to start: process died immediately`);
    }
  }

  return startedPIDs;
}

async function stopWorkers() {
  const pids = loadWorkerPIDs();

  if (pids.length === 0) {
    console.log('No workers running');
    return;
  }

  console.log(`Stopping ${pids.length} worker(s)...`);

  for (const pid of pids) {
    try {
      killPidCrossPlatform(pid);
      console.log(`Sent stop signal to worker ${pid}`);
    } catch (e) {
      // Never crash on stop
      console.error(`Error stopping worker ${pid}: ${e?.message || e}`);
    }
  }

  // After a short delay, rewrite PID file with only still-alive PIDs
  setTimeout(() => {
    const stillAlive = loadWorkerPIDs().filter(pid => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    });
    saveWorkerPIDs(stillAlive);
  }, 1000);
}

async function listWorkers() {
  const pids = loadWorkerPIDs();
  const activeWorkers = [];

  for (const pid of pids) {
    try {
      process.kill(pid, 0);
      activeWorkers.push(pid);
    } catch {
      // Process doesn't exist; clean it from the file
      removeWorkerPID(pid);
    }
  }

  return activeWorkers;
}

module.exports = { startWorkers, stopWorkers, listWorkers, loadWorkerPIDs };
