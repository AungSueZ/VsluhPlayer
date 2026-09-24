// очередь скачивания: выбрал десяток треков - и занимайся своими делами.
// качаем по одному, но список живёт своей жизнью: можно докидывать и отменять.
const ytdlp = require('./ytdlp');

const KEY = it => String(it.url || it.id || '');

class DlQueue {
  // getExe() -> путь к yt-dlp или null, getDir() -> куда складывать
  // onChange(state) - дёргается при любом изменении
  // onFile(file, item) -> трек, добавленный в библиотеку
  // onFail(item, raw) - полный текст ошибки yt-dlp, для лога
  constructor({ getExe, getDir, getCookies, onChange, onFile, onFail }) {
    this.getExe = getExe;
    this.getDir = getDir;
    this.getCookies = getCookies || (() => '');
    this.onChange = onChange || (() => {});
    this.onFile = onFile || (async () => null);
    this.onFail = onFail || (() => {});

    this.items = [];
    this.running = false;
    this.handle = null;      // чем прибить текущий процесс
    this.paused = false;
    this._t = null;
  }

  state() {
    const n = s => this.items.filter(i => i.state === s).length;
    return {
      items: this.items,
      busy: this.running,
      paused: this.paused,
      wait: n('wait'),
      done: n('ok'),
      failed: n('err')
    };
  }

  // проценты капают часто - шлём не чаще раза в 150 мс,
  // а смену состояния отдаём сразу
  _emit(now = false) {
    if (now) {
      clearTimeout(this._t); this._t = null;
      this.onChange(this.state());
      return;
    }
    if (this._t) return;
    this._t = setTimeout(() => { this._t = null; this.onChange(this.state()); }, 150);
  }

  add(list) {
    const have = new Set(this.items.filter(i => i.state !== 'err' && i.state !== 'cancel').map(i => i.key));
    let added = 0;

    for (const it of list || []) {
      const key = KEY(it);
      if (!key || have.has(key)) continue;
      have.add(key);
      added++;
      this.items.push({
        key,
        id: it.id,
        src: it.src || 'yt',
        title: it.title || 'без названия',
        artist: it.artist || '',
        cover: it.cover || '',
        duration: it.duration || 0,
        url: it.url,
        state: 'wait',
        percent: 0,
        error: '',
        file: ''
      });
    }

    this._emit(true);
    this._pump();
    return { added, skipped: (list || []).length - added, state: this.state() };
  }

  cancel(key) {
    const it = this.items.find(i => i.key === key);
    if (!it) return this.state();

    if (it.state === 'go') {
      it.state = 'cancel';
      if (this.handle) { try { this.handle.kill(); } catch {} }
    } else if (it.state === 'wait') {
      it.state = 'cancel';
    }
    this._emit(true);
    return this.state();
  }

  // what: 'done' - убрать доделанное, 'wait' - отменить всё, что не начато, 'all'
  clear(what = 'done') {
    if (what === 'wait' || what === 'all') {
      for (const i of this.items) if (i.state === 'wait') i.state = 'cancel';
    }
    if (what === 'all' && this.handle) { try { this.handle.kill(); } catch {} }

    this.items = this.items.filter(i => i.state === 'go' || i.state === 'wait');
    this._emit(true);
    return this.state();
  }

  pause(on) {
    this.paused = !!on;
    this._emit(true);
    if (!this.paused) this._pump();
    return this.state();
  }

  async _pump() {
    if (this.running || this.paused) return;

    const it = this.items.find(i => i.state === 'wait');
    if (!it) { this._emit(true); return; }

    const exe = this.getExe();
    if (!exe) {
      for (const i of this.items) if (i.state === 'wait') { i.state = 'err'; i.error = 'yt-dlp не найден'; }
      this._emit(true);
      return;
    }

    this.running = true;
    it.state = 'go';
    it.percent = 0;
    this._emit(true);

    try {
      const dir = this.getDir();
      const file = await ytdlp.download(exe, it.url, dir, {
        cookies: this.getCookies(),
        onProgress: p => { if (it.state === 'go') { it.percent = p; this._emit(); } },
        onSpawn: h => { this.handle = h; }
      });

      it.file = file;
      it.percent = 100;
      // теги и обложку подбирает вызывающий - ему видна библиотека
      try { await this.onFile(file, it); } catch (e) { /* трек скачан, это важнее */ }
      it.state = 'ok';
    } catch (e) {
      if (e && e.cancelled) it.state = 'cancel';
      else {
        it.state = 'err';
        it.error = String((e && e.message) || e);
        try { this.onFail(it, (e && e.raw) || it.error); } catch { /* лог не должен ронять очередь */ }
      }
    } finally {
      this.handle = null;
      this.running = false;
      this._emit(true);
      // следующий - через тик, чтобы не расти стеком на длинной очереди
      setTimeout(() => this._pump(), 30);
    }
  }
}

module.exports = { DlQueue };
