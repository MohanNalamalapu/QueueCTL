(async ()=>{
  const fs = require('fs');
  const { DB_PATH } = require('../db');
  const { getDb } = require('../db');
  const { enqueue, listByState } = require('../queue');
  const worker = require('../worker');
  // fresh DB
  try{ if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch(e){}
  await getDb();
  console.log('DB init');
  const id = await enqueue({ id: 'dbg-fail', command: 'node -e "process.exit(1)"', max_retries: 2 });
  console.log('enqueued', id);
  const db = await getDb();
  const jobRow = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  console.log('job after enqueue:', jobRow);
  // Run worker in single-run mode for deterministic behavior in this debug script.
  // Do NOT set NO_EXIT here so the worker loop can finish and the process can exit normally.
  process.env.SINGLE_RUN='1';
  delete process.env.NO_EXIT;
  const p = worker.runWorkerLoop();
  // wait for worker to run
  await new Promise(r=>setTimeout(r, 3000));
  const failed = await listByState('failed');
  const pending = await listByState('pending');
  const dlq = await listByState('dead');
  console.log('failed:', failed);
  console.log('pending:', pending);
  console.log('dead:', dlq);
  // wait extra to let retry happen if scheduled soon
  await new Promise(r=>setTimeout(r, 4000));
  console.log('After wait');
  console.log('failed:', await listByState('failed'));
  console.log('pending:', await listByState('pending'));
  console.log('dead:', await listByState('dead'));
  try {
    if (p && p.then) {
      // Wait up to 5s for the worker to finish, then continue
      await Promise.race([p, new Promise(res => setTimeout(res, 5000))]);
    }
  } catch(e) { console.log('worker promise ended', e); }
  // Ensure the script exits and returns control to the shell
  process.exit(0);
})().catch(e=>{console.error(e); process.exit(1);});
