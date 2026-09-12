// синхронный текст песни с lrclib.net (бесплатно, без ключей) + кэш на диске
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UA = 'Vsluh/1.0 (https://github.com/AungSueZ)';
const API = 'https://lrclib.net/api';

// чистим название от мусора вроде (Official Video), [prod. by ...]
function clean(s) {
  return String(s || '')
    .replace(/\((?:official|lyric|audio|video|music video|prod\.?|feat\.?|ft\.?)[^)]*\)/gi, '')
    .replace(/\[(?:official|lyric|audio|video|prod\.?|feat\.?|ft\.?)[^\]]*\]/gi, '')
    .replace(/\s*[-–—]\s*(?:official|lyric|audio|topic).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// "[00:12.34]строка" -> [{t, text}]
// понимает и расширенный формат с таймингом каждого слова: "<00:12.34>слово"
function parseLrc(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;

    const body = raw.replace(/\[[^\]]*\]/g, '');

    const words = [];
    const wre = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>([^<]*)/g;
    let m;
    while ((m = wre.exec(body))) {
      words.push({
        t: Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number('0.' + m[3]) : 0),
        text: m[4]
      });
    }

    // без разметки по словам берём строку как есть, с ней - склеиваем слова
    const line = (words.length ? words.map(w => w.text).join('') : body).trim();

    for (const s of stamps) {
      const item = {
        t: Number(s[1]) * 60 + Number(s[2]) + (s[3] ? Number('0.' + s[3]) : 0),
        text: line
      };
      if (words.length) item.words = words;
      out.push(item);
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

class Lyrics {
  constructor(dir) {
    this.dir = path.join(dir, 'lyrics');
    fs.mkdirSync(this.dir, { recursive: true });
    this.mem = new Map();
  }

  _key(artist, title) {
    return crypto.createHash('md5')
      .update((clean(artist) + '|' + clean(title)).toLowerCase())
      .digest('hex').slice(0, 20);
  }

  // рядом с треком лежит свой .lrc - он главнее интернета
  _local(trackPath) {
    if (!trackPath) return null;
    const lrc = trackPath.replace(/\.[^.]+$/, '.lrc');
    try {
      if (fs.existsSync(lrc)) {
        const lines = parseLrc(fs.readFileSync(lrc, 'utf8'));
        if (lines.length) return { synced: true, lines, source: 'файл рядом с треком' };
      }
    } catch {}
    return null;
  }

  async get({ artist, title, album, duration, path: trackPath }) {
    if (!title) return { synced: false, lines: [], source: null };

    const local = this._local(trackPath);
    if (local) return local;

    const key = this._key(artist, title);
    if (this.mem.has(key)) return this.mem.get(key);

    const cacheFile = path.join(this.dir, key + '.json');
    try {
      const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      // отрицательный ответ перепроверяем через неделю
      if (c.lines?.length || Date.now() - (c.at || 0) < 7 * 864e5) {
        this.mem.set(key, c);
        return c;
      }
    } catch {}

    const res = await this._fetch({ artist, title, album, duration });
    res.at = Date.now();
    this.mem.set(key, res);
    try { fs.writeFileSync(cacheFile, JSON.stringify(res), 'utf8'); } catch {}
    return res;
  }

  async _fetch({ artist, title, album, duration }) {
    const empty = { synced: false, lines: [], plain: '', source: null };
    const a = clean(artist), t = clean(title);

    const tryUrl = async url => {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(9000) });
        if (!r.ok) return null;
        return await r.json();
      } catch { return null; }
    };

    let hit = null;

    // 1. точное совпадение по артисту/названию/длительности
    if (a) {
      const q = new URLSearchParams({ artist_name: a, track_name: t });
      if (album) q.set('album_name', clean(album));
      if (duration) q.set('duration', String(Math.round(duration)));
      hit = await tryUrl(`${API}/get?${q}`);
    }

    // 2. поиск, выбираем ближайший по длительности из тех, где есть синхронный текст
    if (!hit) {
      const list = await tryUrl(`${API}/search?q=${encodeURIComponent((a ? a + ' ' : '') + t)}`);
      if (Array.isArray(list) && list.length) {
        const synced = list.filter(x => x.syncedLyrics);
        const pool = synced.length ? synced : list;
        hit = duration
          ? pool.slice().sort((x, y) =>
              Math.abs((x.duration || 0) - duration) - Math.abs((y.duration || 0) - duration))[0]
          : pool[0];
        // если по длительности совсем мимо - не берём
        if (hit && duration && hit.duration && Math.abs(hit.duration - duration) > 25) hit = null;
      }
    }

    if (!hit) return empty;

    if (hit.syncedLyrics) {
      const lines = parseLrc(hit.syncedLyrics);
      if (lines.length) return { synced: true, lines, source: 'lrclib.net' };
    }
    if (hit.plainLyrics) {
      return {
        synced: false,
        lines: hit.plainLyrics.split(/\r?\n/).map(text => ({ t: -1, text })),
        source: 'lrclib.net'
      };
    }
    return empty;
  }
}

module.exports = { Lyrics, parseLrc, clean };
