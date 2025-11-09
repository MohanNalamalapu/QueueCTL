# QueueCTL – CLI-Based Background Job Queue System

QueueCTL is a Node.js-based command-line tool that manages background job processing.  
It supports multiple workers, job retries with exponential backoff, a persistent SQLite store, and a Dead Letter Queue (DLQ) for failed tasks.  


---

## Features

- **Job Lifecycle Management**: Pending → Processing → Completed / Failed / Dead  
- **Multiple Worker Processes** running in parallel  
- **Automatic Retry with Exponential Backoff**  
- **Dead Letter Queue (DLQ)** for permanently failed jobs  
- **Persistent Storage** using SQLite  
- **Configurable Retries and Backoff** via CLI  
- **Priority and Scheduled Jobs (Bonus)**  
- **Clean, Simple CLI Interface**

---

## Tech Stack

| Component | Technology |
|------------|-------------|
| Language | Node.js |
| Database | SQLite (better-sqlite3) |
| CLI Framework | Commander.js |
| File System | JSON + Persistent SQLite storage |
| OS Support | Windows / Linux / macOS |

---

## Project Structure

```
src/
├── cli.js           # Main CLI entrypoint
├── queue.js         # Job queue logic
├── worker.js        # Worker process
├── worker-manager.js# Handles multiple workers
├── db.js            # SQLite connection & schema
├── config.js        # Configuration management
├── demo/
│   └── smoke-test.js# Automated verification tests
└── util.js          # Helper utilities
```

---

## Installation & Setup

```powershell
# Clone the repository
git clone https://github.com/<your-username>/QueueCTL.git
cd QueueCTL

# Install dependencies
npm install

# Link the CLI globally (optional, makes `queuectl` available)
npm link
```

Usage Guide (with Explanations)

Each command below can be copied directly into PowerShell.

1. Check Setup

```powershell
queuectl --version
queuectl --help
```

Verifies the CLI tool is correctly linked and accessible.

2. Reset Previous State

```powershell
if (Test-Path .\.workers.pid) {
  Get-Content .\.workers.pid | ForEach-Object {
    try { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } catch {}
  }
  Remove-Item .\.workers.pid -ErrorAction SilentlyContinue
}
Remove-Item .\queue.db -ErrorAction SilentlyContinue
```

Stops any running workers and deletes the old database for a clean start.

3. Configuration Management

```powershell
queuectl config set max_retries 2
queuectl config set backoff_base 2
queuectl status
```

Sets retry and backoff parameters and checks the initial job summary.

4. Successful Job Execution

```powershell
queuectl enqueue --id demo-complete --command "echo demo-ok"
queuectl worker start --count 1
Start-Sleep -Seconds 2
queuectl list --state completed
queuectl worker stop
```

Shows a basic successful job running through the system.

5. Failed Job → Retry → DLQ

```powershell
queuectl enqueue --id demo-fail --command "node -e \"process.exit(1)\"" --max-retries 2
queuectl worker start --count 1
Start-Sleep -Seconds 8
queuectl list --state failed
queuectl dlq list
queuectl worker stop
```

Demonstrates automatic retries, exponential backoff, and a job moved to the DLQ after max attempts.

6. Multiple Workers & Parallel Jobs

```powershell
for ($i=1; $i -le 6; $i++) {
  queuectl enqueue --id "bulk-$i" --command "echo job-$i"
}
queuectl worker start --count 3
Start-Sleep -Seconds 4
queuectl status
queuectl list --state completed
queuectl worker stop
```

Runs six jobs concurrently using three worker processes.

7. Job Persistence Across Restart

```powershell
queuectl enqueue --id persist-demo --command "echo persist"
queuectl list --state pending
queuectl worker start --count 1
Start-Sleep -Seconds 2
queuectl list --state completed
queuectl worker stop
```

Demonstrates persistence — job data remains even after restart.

8. Priority & Scheduled Jobs (Bonus)

```powershell
queuectl enqueue --id high-priority --command "echo high-priority" --priority 10
queuectl enqueue --id low-priority --command "echo low-priority" --priority 1
queuectl worker start --count 1
Start-Sleep -Seconds 3
queuectl list --state completed
queuectl worker stop

$runAt = (Get-Date).AddSeconds(5).ToString("o")
queuectl enqueue --id delayed-job --command "echo delayed-job" --run-at $runAt
queuectl worker start --count 1
Start-Sleep -Seconds 10
queuectl list --state completed
queuectl worker stop
```

Shows job priority handling and delayed job execution.

9. Final Status Summary

```powershell
queuectl status
queuectl list --state completed
queuectl dlq list
```

Displays the final state of the queue and verifies all features worked.

10. Automated Smoke Test

```powershell
npm run demo:smoke
```

Runs automated tests verifying enqueue, execution, retries, DLQ, and persistence.

11. Video Demonstration:
    [Demo Video](https://drive.google.com/file/d/1jzRYIRurKr5ZmuU_flJDSJgdk3cBRWxC/view?usp=sharing)
  
    The video follows the same sequence of commands as shown above. Each section briefly explains what’s being demonstrated.

---

## Testing & Validation
Smoke tests (in /src/demo/smoke-test.js) verify:

- Job enqueue/dequeue
- Retry with backoff
- DLQ operations
- Configuration
- Persistence across restarts

Run using:

```powershell
npm run demo:smoke
```
---
### Architecture Overview
- Queue Manager: Handles enqueue/dequeue, persistence, and job states.
- Worker Processes: Execute jobs concurrently; communicate via SQLite locks.
- Retry Mechanism: Implements exponential backoff (delay = base^attempts).
- Dead Letter Queue: Moves permanently failed jobs after max retries.
- Persistence: All jobs stored in SQLite and survive restarts.
- Config Manager: Adjusts retry/backoff values via CLI.
