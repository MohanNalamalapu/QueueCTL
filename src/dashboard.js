#!/usr/bin/env node
const express = require('express');
const path = require('path');
const { status } = require('./queue');
const { getDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 8080;

app.get('/api/status', async (req, res) => {
  try {
    await getDb();
    const s = await status();
    res.json(s);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Simple dashboard page (minimal, self-contained)
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>QueueCTL Dashboard</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; margin: 24px; }
    .grid { display:flex; gap:20px; flex-wrap:wrap }
    .card { border:1px solid #eee; padding:16px; border-radius:6px; width:220px }
    h1 { margin-bottom: 10px }
    pre { background:#f8f8f8; padding:10px }
  </style>
</head>
<body>
  <h1>QueueCTL Dashboard</h1>
  <div id="content">Loading...</div>
  <script>
    async function refresh(){
      try{
        const r = await fetch('/api/status');
        const j = await r.json();
        let html = '';
        html += '<div class="grid">';
        html += '<div class="card"><strong>Pending</strong><div>' + j.pending + '</div></div>';
        html += '<div class="card"><strong>Processing</strong><div>' + j.processing + '</div></div>';
        html += '<div class="card"><strong>Completed</strong><div>' + j.completed + '</div></div>';
        html += '<div class="card"><strong>Failed</strong><div>' + j.failed + '</div></div>';
        html += '<div class="card"><strong>Dead</strong><div>' + j.dead + '</div></div>';
        html += '<div class="card"><strong>Active Workers</strong><div>' + j.active_workers + '</div></div>';
        html += '</div>';
        html += '<h3>Raw Status</h3>';
        html += '<pre>' + JSON.stringify(j, null, 2) + '</pre>';
        document.getElementById('content').innerHTML = html;
      }catch(e){
        document.getElementById('content').textContent = 'Error: ' + e.message;
      }
    }
    refresh();
    setInterval(refresh, 2500);
  </script>
</body>
</html>
`);
});

app.listen(PORT, () => {
  console.log(`QueueCTL dashboard running at http://localhost:${PORT}`);
});
