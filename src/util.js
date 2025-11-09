function nowISO() { return new Date().toISOString(); }
function addSeconds(iso, seconds) { return new Date(new Date(iso).getTime() + seconds*1000).toISOString(); }
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }
function backoff(base, attempts) { return Math.pow(base, attempts); }
function isDue(iso) { return !iso || new Date(iso) <= new Date(); }


module.exports = { nowISO, addSeconds, sleep, backoff, isDue };