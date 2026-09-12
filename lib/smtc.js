// Сторона главного процесса: держит рабочий процесс со слежкой за чужими плеерами.
// Сам native-модуль здесь не подключается специально - он вешает Electron.
const path = require('path');
const { EventEmitter } = require('events');
const { utilityProcess } = require('electron');

const WORKER = path.join(__dirname, 'smtc-worker.js');

class SmtcBridge extends EventEmitter {
  constructor(cacheDir, selfMatch) {
    super();
    this.cacheDir = cacheDir;
    this.selfSrc = (selfMatch && selfMatch.source) || 'aung.?player|^electron';
    this.child = null;
    this.alive = false;
    this.last = { sessions: [], current: null };
    this.retries = 0;
    this.stopped = false;
  }

  start() {
    if (this.child) return true;
    this.stopped = false;
    try {
      this.child = utilityProcess.fork(WORKER, [this.cacheDir, this.selfSrc], {
        serviceName: 'smtc',
        stdio: 'ignore'
      });

      this.child.on('message', m => {
        if (!m) return;
        if (m.type === 'update') {
          this.last = m.data || { sessions: [], current: null };
          this.alive = true;
          this.retries = 0;
          this.emit('update', this.last);
        } else if (m.type === 'ready') {
          this.alive = true;
        } else if (m.type === 'error') {
          this.alive = false;
          this.emit('error', m.data);
        }
      });

      this.child.on('exit', () => {
        this.child = null;
        this.alive = false;
        if (this.stopped) return;
        // упал - поднимаем, но не бесконечно
        if (this.retries++ < 5) setTimeout(() => this.start(), 2000 * this.retries);
      });

      return true;
    } catch (e) {
      this.child = null;
      this.alive = false;
      this.emit('error', e.message);
      return false;
    }
  }

  stop() {
    this.stopped = true;
    this.alive = false;
    const c = this.child;
    this.child = null;
    this.last = { sessions: [], current: null };
    if (!c) return;
    try { c.postMessage({ cmd: 'stop' }); } catch {}
    setTimeout(() => { try { c.kill(); } catch {} }, 400);
  }

  // последний известный снимок; синхронно спросить рабочий процесс нельзя
  snapshot() { return this.last; }

  refresh() { try { this.child && this.child.postMessage({ cmd: 'snapshot' }); } catch {} }
}

module.exports = { SmtcBridge };
