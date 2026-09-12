// сканирование папок с музыкой + чтение тегов + кэш обложек
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const AUDIO = new Set(['.mp3', '.m4a', '.flac', '.ogg', '.opus', '.wav', '.aac', '.wma', '.aiff', '.aif']);
const SKIP_DIR = new Set(['node_modules', '$recycle.bin', 'system volume information', '.git']);

let _mm = null;
async function mm() {
  if (!_mm) _mm = await import('music-metadata');
  return _mm;
}

const idOf = p => crypto.createHash('md5').update(p.toLowerCase()).digest('hex').slice(0, 16);

const COVER_NAMES = ['cover', 'folder', 'front', 'album', 'albumart', 'обложка'];
const COVER_EXT = ['.jpg', '.jpeg', '.png', '.webp'];

// обложка, лежащая рядом с треком: cover.jpg, folder.jpg и т.п.
const dirCoverCache = new Map();
function folderCover(dir) {
  if (dirCoverCache.has(dir)) return dirCoverCache.get(dir);
  let found = null;
  try {
    const files = fs.readdirSync(dir);
    outer:
    for (const name of COVER_NAMES) {
      for (const ext of COVER_EXT) {
        const hit = files.find(f => f.toLowerCase() === name + ext);
        if (hit) { found = path.join(dir, hit); break outer; }
      }
    }
  } catch {}
  dirCoverCache.set(dir, found);
  return found;
}

// "03 - Артист - Название" -> {artist, title}; номер трека в начале убираем
function fromFilename(base) {
  let s = base.replace(/^\s*\d{1,3}\s*[.\-_)]?\s+/, '').trim();
  const parts = s.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  }
  return { artist: '', title: s || base };
}

async function walk(dir, out, depth = 0) {
  if (depth > 12) return;
  let items;
  try { items = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) {
      if (SKIP_DIR.has(it.name.toLowerCase()) || it.name.startsWith('.')) continue;
      await walk(full, out, depth + 1);
    } else if (AUDIO.has(path.extname(it.name).toLowerCase())) {
      out.push(full);
    }
  }
}

class Library {
  constructor(userDir) {
    this.indexFile = path.join(userDir, 'library.json');
    this.coverDir = path.join(userDir, 'covers');
    fs.mkdirSync(this.coverDir, { recursive: true });
    this.tracks = [];
    this.byId = new Map();
    try {
      const raw = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
      if (Array.isArray(raw.tracks)) this._load(raw.tracks);
    } catch { /* нет кэша */ }
  }

  _load(list) {
    this.tracks = list;
    this.byId = new Map(list.map(t => [t.id, t]));
  }

  save() {
    try {
      fs.writeFileSync(this.indexFile, JSON.stringify({ v: 1, tracks: this.tracks }), 'utf8');
    } catch (e) { console.error('library save', e); }
  }

  get(id) { return this.byId.get(id) || null; }

  // onProgress({done,total,title})
  async scan(folders, onProgress) {
    const files = [];
    for (const f of folders) await walk(f, files);

    const prev = this.byId;
    const next = [];
    let done = 0;

    for (const file of files) {
      const id = idOf(file);
      let st;
      try { st = await fsp.stat(file); } catch { continue; }

      const old = prev.get(id);
      if (old && old.size === st.size && old.mtime === st.mtimeMs) {
        next.push(old);
      } else {
        next.push(await this._read(file, id, st));
      }
      done++;
      if (onProgress && (done % 12 === 0 || done === files.length)) {
        onProgress({ done, total: files.length, title: path.basename(file) });
      }
    }

    next.sort((a, b) => (a.artist || '').localeCompare(b.artist || '', 'ru') ||
                        (a.album || '').localeCompare(b.album || '', 'ru') ||
                        (a.track || 0) - (b.track || 0) ||
                        a.title.localeCompare(b.title, 'ru'));
    this._load(next);
    this.save();
    this._sweepCovers();
    return this.tracks;
  }

  // записывает данные из каталога в карточку трека.
  // сам файл не трогаем - правки живут в библиотеке приложения
  async applyMeta(id, meta) {
    const t = this.byId.get(id);
    if (!t || !meta) return null;

    if (meta.title)  t.title  = meta.title;
    if (meta.artist) t.artist = meta.artist;
    if (meta.album)  t.album  = meta.album;
    if (meta.year)   t.year   = meta.year;

    if (meta.cover && /^https?:/.test(meta.cover)) {
      try {
        const r = await fetch(meta.cover, { signal: AbortSignal.timeout(15000) });
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length > 900) {
            const f = path.join(this.coverDir, id + '.jpg');
            await fsp.writeFile(f, buf);
            t.cover = f;
            t.noArt = false;
          }
        }
      } catch { /* без обложки тоже сойдёт */ }
    }

    t.tagged = true;
    this.save();
    return t;
  }

  // добавляет один файл в библиотеку, не пересканируя всё
  async addFile(file) {
    const id = idOf(file);
    let st;
    try { st = await fsp.stat(file); } catch { return null; }

    const t = await this._read(file, id, st);
    const i = this.tracks.findIndex(x => x.id === id);
    if (i >= 0) this.tracks[i] = t; else this.tracks.push(t);
    this.byId.set(id, t);
    this.save();
    return t;
  }

  // читает произвольные файлы и папки, не добавляя их в постоянную библиотеку
  // (для перетаскивания в окно)
  async probePaths(paths) {
    const files = [];
    for (const p of paths || []) {
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) await walk(p, files);
      else if (AUDIO.has(path.extname(p).toLowerCase())) files.push(p);
    }

    const out = [];
    for (const f of files) {
      const id = idOf(f);
      const known = this.byId.get(id);
      if (known) { out.push(known); continue; }
      let st;
      try { st = await fsp.stat(f); } catch { continue; }
      out.push(await this._read(f, id, st));
    }
    return out;
  }

  async _read(file, id, st) {
    const base = path.basename(file, path.extname(file));
    const t = {
      id, path: file, size: st.size, mtime: st.mtimeMs,
      title: base, artist: '', album: '', track: 0, year: 0,
      duration: 0, cover: null, added: Date.now()
    };
    try {
      const { parseFile } = await mm();
      const md = await parseFile(file, { duration: true, skipPostHeaders: true });
      const c = md.common || {};
      if (c.title) t.title = c.title.trim();
      t.artist = (c.artist || c.albumartist || '').trim();
      t.album = (c.album || '').trim();
      t.track = (c.track && c.track.no) || 0;
      t.year = c.year || 0;
      t.duration = Math.round(md.format?.duration || 0);

      // тегов нет - разбираем имя файла
      if (!c.title || !t.artist) {
        const g = fromFilename(base);
        if (!t.artist && g.artist) t.artist = g.artist;
        if (!c.title) t.title = g.title;
      }

      const pic = c.picture && c.picture[0];
      if (pic && pic.data) {
        const ext = (pic.format || '').includes('png') ? '.png' : '.jpg';
        const cf = path.join(this.coverDir, id + ext);
        if (!fs.existsSync(cf)) await fsp.writeFile(cf, Buffer.from(pic.data));
        t.cover = cf;
      }
    } catch (e) {
      // битый файл - оставляем имя файла как название
      const g = fromFilename(base);
      t.artist = g.artist; t.title = g.title;
    }

    if (!t.cover) t.cover = folderCover(path.dirname(file));
    return t;
  }

  // чистим обложки, которых больше нет в библиотеке
  _sweepCovers() {
    try {
      const keep = new Set(this.tracks.filter(t => t.cover).map(t => path.basename(t.cover)));
      for (const f of fs.readdirSync(this.coverDir)) {
        if (!keep.has(f)) fs.unlink(path.join(this.coverDir, f), () => {});
      }
    } catch { /* не критично */ }
  }
}

module.exports = { Library, AUDIO, idOf };
