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
Each command below can be copied directly into PowerShell during your video demo.
After each command, explain briefly what it demonstrates.

Check Setup

```powershell
queuectl --version
queuectl --help
```

Verifies the CLI tool is correctly linked and accessible.

Reset Previous State

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

Configuration Management

```powershell
queuectl config set max_retries 2
queuectl config set backoff_base 2
queuectl status
```

Sets retry and backoff parameters and checks the initial job summary.

Successful Job Execution

```powershell
queuectl enqueue --id demo-complete --command "echo demo-ok"
queuectl worker start --count 1
Start-Sleep -Seconds 2
queuectl list --state completed
queuectl worker stop
```

Shows a basic successful job running through the system.

Failed Job → Retry → DLQ

```powershell
queuectl enqueue --id demo-fail --command "node -e \"process.exit(1)\"" --max-retries 2
queuectl worker start --count 1
Start-Sleep -Seconds 8
queuectl list --state failed
queuectl dlq list
queuectl worker stop
```

Demonstrates automatic retries, exponential backoff, and a job moved to the DLQ after max attempts.

Multiple Workers & Parallel Jobs

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

Job Persistence Across Restart

```powershell
queuectl enqueue --id persist-demo --command "echo persist"
queuectl list --state pending
queuectl worker start --count 1
Start-Sleep -Seconds 2
queuectl list --state completed
queuectl worker stop
```

Demonstrates persistence — job data remains even after restart.

Priority & Scheduled Jobs (Bonus)

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

Automated Smoke Test

```powershell
npm run demo:smoke
```

Runs automated tests verifying enqueue, execution, retries, DLQ, and persistence.

Final Status Summary

```powershell
queuectl status
queuectl list --state completed
queuectl dlq list
```

Displays the final state of the queue and verifies all features worked.

Video Demonstration

Demo Video: Click here to view the demo  


The video follows the same sequence of commands as shown above. Each section briefly explains what’s being demonstrated.

Testing & Validation
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

Architecture Overview
Queue Manager: Handles enqueue/dequeue, persistence, and job states.

Worker Processes: Execute jobs concurrently; communicate via SQLite locks.

Retry Mechanism: Implements exponential backoff (delay = base^attempts).

Dead Letter Queue: Moves permanently failed jobs after max retries.

Persistence: All jobs stored in SQLite and survive restarts.

Config Manager: Adjusts retry/backoff values via CLI.

---

## References

### Core Dependencies
- **Commander.js** – Complete solution for Node.js command-line interfaces  
- **better-sqlite3** – Native SQLite binding used for persistence  
- **Chalk** – Terminal string styling  
- **Figlet** – ASCII art text generator  
- **Ora** – Elegant terminal spinner  
- **Boxen** – Create boxes in the terminal  
- **cli-table3** – Beautiful formatted tables  

### Learning Resources
#### CLI Development
- [How CLIs in Node.js Actually Work](https://developer.mozilla.org/en-US/docs/Learn/Tools_and_testing/Client-side_JavaScript_frameworks/CLI)
- [Building a Command Line Tool with Node.js](https://www.sitepoint.com/javascript-command-line-interface-cli-node-js/)
- [Commander.js Documentation](https://github.com/tj/commander.js/)

#### Queue & Background Jobs
- [Node.js Background Jobs & Workers](https://blog.logrocket.com/background-jobs-in-nodejs/)
- [Building a Job Queue in Node.js](https://dev.to/jorgec/building-a-job-queue-in-node-js-48g2)
- [SQLite3 Node.js Guide](https://www.sqlitetutorial.net/sqlite-nodejs/)
- [SQLite with Node.js Tutorial](https://www.freecodecamp.org/news/using-sqlite-with-nodejs/)

#### CLI UX Best Practices
- [Command Line Interface Guidelines](https://clig.dev/)
- [14 Great Tips to Make Amazing CLI Applications](https://dev.to/danielkhowell/14-great-tips-to-make-amazing-cli-applications-4o9l)
- [12 Factor CLI Apps](https://12factor.net/)

----

Assumptions & Trade-offs
Assumptions

Running on Node.js with a single SQLite database file

Moderate job volume (not designed for thousands of jobs per second)

Jobs complete within a reasonable time (no long-running batch processes)

No distributed execution across multiple machines

Both CLI and web dashboard interfaces available for future integration

Tooling Choices

Commander.js for building the CLI interface

Simple and well-documented

Great community support

Built-in help generation

Express.js for optional dashboard (future extension)

Lightweight and fast

Easy to integrate with Node.js

Large ecosystem of middleware

SQLite for data persistence

Zero-configuration single-file database

Fast enough for local job queue storage

Chalk & Ora for CLI UX

Enhanced terminal output formatting

Loading spinners for improved user feedback

Trade-offs

Chose SQLite for simplicity over distributed databases

Single-node architecture limits scalability for high loads

Basic retry and error handling without distributed recovery
