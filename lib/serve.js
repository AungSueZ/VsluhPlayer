// Локальный http-сервер для самого интерфейса и для файлов пользователя.
//
// Зачем он вместо своего протокола aung://: встроенные плееры YouTube
// отказываются работать с нестандартного протокола (ошибка 153), им нужен
// обычный http-адрес. На 127.0.0.1 они заводятся без вопросов.
//
// Безопасность: слушаем только петлю, порт случайный, и каждый запрос обязан
// принести секрет этой сессии. Иначе любая страница в браузере могла бы
// читать файлы с диска через наш же сервер.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.wma': 'audio/x-ms-wma',
  '.aiff': 'audio/aiff', '.aif': 'audio/aiff',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
  '.ogv': 'video/ogg', '.mov': 'video/quicktime'
};

class Serve {
  // roots() должен вернуть список папок, из которых можно отдавать файлы
  constructor(appDir, roots) {
    this.appDir = appDir;
    this.roots = roots;
    this.token = crypto.randomBytes(16).toString('hex');
    this.port = 0;
    this.server = null;
  }

  get origin() { return `http://127.0.0.1:${this.port}`; }
  get pageUrl() { return `${this.origin}/index.html`; }

  fileUrl(p) {
    return p ? `${this.origin}/media?t=${this.token}&p=${encodeURIComponent(p)}` : '';
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this._handle(req, res));
      this.server.on('error', reject);
      // порт 0 - система выдаст свободный
      this.server.listen(0, '127.0.0.1', () => {
        this.port = this.server.address().port;
        resolve(this.port);
      });
    });
  }

  stop() { try { this.server && this.server.close(); } catch {} }

  _allowed(p) {
    const norm = path.resolve(p).toLowerCase();
    return (this.roots() || []).some(r => {
      const rr = path.resolve(r).toLowerCase();
      return norm === rr || norm.startsWith(rr + path.sep);
    });
  }

  _handle(req, res) {
    let u;
    try { u = new URL(req.url, this.origin); } catch { return this._end(res, 400, 'bad url'); }

    let file;
    if (u.pathname === '/media') {
      // файлы пользователя отдаём только со секретом сессии: иначе любая
      // страница в браузере смогла бы читать музыку с диска через наш сервер
      if (u.searchParams.get('t') !== this.token) return this._end(res, 403, 'forbidden');
      file = u.searchParams.get('p') || '';
      if (!file || !this._allowed(file)) return this._end(res, 403, 'forbidden');
    } else {
      // сам интерфейс - это наш же html и css, секретов в нём нет
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
      if (rel.includes('..')) return this._end(res, 403, 'forbidden');
      const inSrc = path.join(this.appDir, 'src', rel);
      file = fs.existsSync(inSrc) ? inSrc : path.join(this.appDir, rel);
      if (!this._allowed(file)) return this._end(res, 403, 'forbidden');
    }

    let st;
    try { st = fs.statSync(file); } catch { return this._end(res, 404, 'not found'); }
    if (!st.isFile()) return this._end(res, 404, 'not found');

    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;

    // перемотка аудио и видео
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        let start = m[1] ? parseInt(m[1], 10) : 0;
        let end = m[2] ? parseInt(m[2], 10) : st.size - 1;
        if (isNaN(start) || start < 0) start = 0;
        if (isNaN(end) || end >= st.size) end = st.size - 1;
        if (start > end) {
          res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
          return res.end();
        }
        res.writeHead(206, {
          'Content-Type': type,
          'Content-Length': end - start + 1,
          'Content-Range': `bytes ${start}-${end}/${st.size}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache'
        });
        return fs.createReadStream(file, { start, end }).pipe(res);
      }
    }

    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': st.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(file).pipe(res);
  }

  _end(res, code, text) {
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(text);
  }
}

module.exports = { Serve };
