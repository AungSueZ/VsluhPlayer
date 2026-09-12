// поиск и скачивание через yt-dlp.
// бинарник в поставку не входит: качается кнопкой из настроек, с проверкой суммы.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const EXE = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';

// ищем сначала там, куда кладёт кнопка «скачать», потом рядом с приложением
// и на пару уровней выше: в собранном виде exe лежит в dist/win-unpacked
function find(appDir, extra) {
  const seen = new Set();
  const dirs = [];
  for (const d of extra || []) if (d && !seen.has(d)) { seen.add(d); dirs.push(d); }
  for (const start of [appDir, path.dirname(process.execPath), process.cwd()]) {
    let d = start;
    for (let i = 0; i < 5 && d; i++) {
      if (!seen.has(d)) { seen.add(d); dirs.push(d); }
      const up = path.dirname(d);
      if (up === d) break;
      d = up;
    }
  }
  for (const d of dirs) {
    const p = path.join(d, EXE);
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}


// yt-dlp ругается абзацами со ссылками на свою вики - оставляем суть
const HINTS = [
  [/confirm your age|age-restricted|age restricted/i, 'YouTube просит подтвердить возраст — включи куки браузера в настройках'],
  [/confirm you'?re not a bot|not a bot/i,           'YouTube принял нас за бота — включи куки браузера в настройках'],
  // сначала точные причины, потом общее "недоступно" - иначе оно съедает всё
  [/private video|is private/i,                       'приватное видео'],
  [/members-only|join this channel/i,                 'только для подписчиков канала'],
  [/removed by the uploader|has been removed/i,       'видео удалено'],
  [/copyright|blocked in your country|not available in your country/i, 'заблокировано по региону или правообладателем'],
  [/live event will begin|is live/i,                  'это трансляция, её не скачать'],
  [/unavailable|not available/i,                      'видео недоступно'],
  [/HTTP Error 403/i,                                 'YouTube отказал в доступе (403)'],
  [/HTTP Error 429|Too Many Requests/i,               'слишком много запросов — подожди немного'],
  [/getaddrinfo|Failed to resolve|Network is unreachable|Temporary failure/i, 'нет связи с сервером'],
  [/No space left|not enough space/i,                 'на диске нет места']
];

function humanError(raw) {
  const text = String(raw || '');
  for (const [re, msg] of HINTS) if (re.test(text)) return msg;
  const line = text.split(/\r?\n/).map(l => l.replace(/^ERROR:\s*/i, "").trim()).filter(Boolean).pop() || "не получилось";
  return line.length > 110 ? line.slice(0, 110) + '…' : line;
}

function run(exe, args, { onLine, timeout = 0, onSpawn } = {}) {
  return new Promise((resolve, reject) => {
    // без этого yt-dlp печатает пути в кодировке консоли и кириллица бьётся
    const ps = spawn(exe, args, {
      windowsHide: true,
      env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' })
    });
    let out = '', err = '', tail = '';
    let killed = false;

    // даём вызывающему возможность прибить процесс (отмена в очереди)
    if (onSpawn) onSpawn({ kill: () => { killed = true; try { ps.kill(); } catch {} } });

    const feed = chunk => {
      out += chunk;
      if (!onLine) return;
      tail += chunk;
      const lines = tail.split(/\r?\n|\r/);
      tail = lines.pop();
      for (const l of lines) if (l.trim()) onLine(l);
    };

    ps.stdout.setEncoding('utf8');
    ps.stderr.setEncoding('utf8');
    ps.stdout.on('data', feed);
    ps.stderr.on('data', d => { err += d; });

    let killer = null;
    if (timeout) killer = setTimeout(() => { try { ps.kill(); } catch {} }, timeout);

    ps.on('error', e => { clearTimeout(killer); reject(e); });
    ps.on('close', code => {
      clearTimeout(killer);
      if (tail.trim() && onLine) onLine(tail);
      if (killed) { const e = new Error('отменено'); e.cancelled = true; reject(e); return; }
      if (code === 0) resolve(out);
      else reject(new Error(humanError(err || out) || ('код ' + code)));
    });
  });
}

async function version(exe) {
  const v = await run(exe, ['--version'], { timeout: 20000 });
  return v.trim().split(/\r?\n/)[0];
}

/* ---------- установка и обновление ---------- */

// официальная страница релизов; /latest/download/ всегда ведёт на свежий
const REL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';

async function grab(url, onProgress) {
  const r = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Vsluh' },
    signal: AbortSignal.timeout(5 * 60 * 1000)
  });
  if (!r.ok) throw new Error('сервер ответил ' + r.status);

  const total = Number(r.headers.get('content-length') || 0);
  const reader = r.body.getReader();
  const parts = [];
  let got = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(Buffer.from(value));
    got += value.length;
    if (onProgress && total) onProgress(Math.min(100, got / total * 100));
  }
  return Buffer.concat(parts);
}

// строка вида "<sha256>  yt-dlp.exe" - берём только точное совпадение имени
function sumFor(text, name) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)$/i.exec(line.trim());
    if (m && m[2] === name) return m[1].toLowerCase();
  }
  return '';
}

// качаем с официальных релизов и сверяем контрольную сумму оттуда же.
// на диск кладём только после проверки, и только целиком
async function install(dir, onProgress) {
  fs.mkdirSync(dir, { recursive: true });

  const sums = (await grab(REL + 'SHA2-256SUMS')).toString('utf8');
  const want = sumFor(sums, EXE);
  if (!want) throw new Error('в списке контрольных сумм нет ' + EXE);

  const bin = await grab(REL + EXE, onProgress);
  const got = crypto.createHash('sha256').update(bin).digest('hex');
  if (got !== want) throw new Error('контрольная сумма не сошлась — файл скачался битым или подменён');

  const out = path.join(dir, EXE);
  const tmp = out + '.part';
  fs.writeFileSync(tmp, bin);
  try {
    fs.renameSync(tmp, out);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw new Error('не вышло заменить файл — возможно, он сейчас занят: ' + (e.message || e));
  }
  return { file: out, sha256: got, size: bin.length };
}

const srcOf = url => (/soundcloud\.com/i.test(url || '') ? 'sc' : 'yt');

// одна запись из --dump-json в наш вид
function toItem(j, fallbackSrc) {
  const url = j.webpage_url || j.url ||
    (j.id ? `https://www.youtube.com/watch?v=${j.id}` : '');
  if (!url) return null;
  const src = fallbackSrc || srcOf(url);
  const thumb = Array.isArray(j.thumbnails) && j.thumbnails.length
    ? j.thumbnails[j.thumbnails.length - 1].url : '';
  return {
    src,
    id: String(j.id || url),
    title: String(j.title || '').trim(),
    artist: (j.artist || j.uploader || j.channel || '').replace(/\s*-\s*Topic$/i, '').trim(),
    album: j.album || '',
    year: 0,
    duration: Math.round(j.duration || 0),
    cover: src === 'yt' && j.id ? `https://i.ytimg.com/vi/${j.id}/hqdefault.jpg` : thumb,
    url
  };
}

// разбор потока json-строк (--dump-json печатает по объекту на строку)
function parseLines(out, fallbackSrc) {
  const items = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.startsWith('{')) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (!j.title && !j.id) continue;
    const it = toItem(j, fallbackSrc);
    if (it && it.title) items.push(it);
  }
  return items;
}

// поиск по YouTube без всяких ключей
async function search(exe, q, count = 25) {
  const out = await run(exe, [
    `ytsearch${count}:${q}`,
    '--dump-json', '--flat-playlist', '--no-warnings', '--ignore-errors'
  ], { timeout: 60000 });
  return parseLines(out, 'yt');
}

// ссылка на плейлист/альбом/сет -> список треков.
// --flat-playlist не лезет в каждое видео, поэтому даже сотня отдаётся за секунды
async function playlist(exe, url, limit = 300) {
  const out = await run(exe, [
    url,
    '--dump-json', '--flat-playlist', '--no-warnings', '--ignore-errors',
    '--playlist-end', String(limit)
  ], { timeout: 120000 });

  const items = parseLines(out, srcOf(url));

  // название самого плейлиста лежит в каждой записи
  let name = '';
  for (const line of out.split(/\r?\n/)) {
    if (!line.startsWith('{')) continue;
    try {
      const j = JSON.parse(line);
      name = j.playlist_title || j.playlist || j.title || '';
      if (name) break;
    } catch {}
  }
  return { name, items };
}

const listDir = dir => {
  try { return new Set(fs.readdirSync(dir)); } catch { return new Set(); }
};

// скачиваем только звуковую дорожку - так не нужен ffmpeg
async function download(exe, url, dir, { onProgress, onSpawn, cookies } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const before = listDir(dir);

  const said = [];
  const args = [
    url,
    '-f', 'bestaudio[ext=m4a]/bestaudio',
    '--no-playlist',
    '--newline',
    '--no-warnings',
    '--no-mtime',
    '-o', path.join(dir, '%(title)s.%(ext)s'),
    '--print', 'after_move:filepath'
  ];

  // куки из браузера пользователя: ими yt-dlp доказывает ютубу, что мы залогинены -
  // без этого ролики с возрастным ограничением не отдаются
  if (cookies) args.push('--cookies-from-browser', cookies);

  await run(exe, args, {
    timeout: 15 * 60 * 1000,
    onSpawn,
    onLine: line => {
      const m = /\[download\]\s+([\d.]+)%/.exec(line);
      if (m) { onProgress && onProgress(Number(m[1])); return; }
      if (!line.startsWith('[')) said.push(line.trim());
    }
  });

  // 1. путь, который назвал сам yt-dlp
  for (let i = said.length - 1; i >= 0; i--) {
    const p = said[i];
    if (/[\/]/.test(p) && fs.existsSync(p)) return p;
  }

  // 2. если имя побилось кодировкой - смотрим, какой файл появился в папке
  const fresh = [...listDir(dir)].filter(f => !before.has(f));
  if (fresh.length) {
    const full = fresh.map(f => path.join(dir, f));
    full.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return full[0];
  }

  // 3. перезаписали существующий - берём самый свежий подходящий
  const all = [...listDir(dir)].map(f => path.join(dir, f)).filter(f => /\.(m4a|webm|opus|mp3|ogg|aac)$/i.test(f));
  if (all.length) {
    all.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (Date.now() - fs.statSync(all[0]).mtimeMs < 5 * 60 * 1000) return all[0];
  }

  throw new Error('файл скачался, но путь не вернулся');
}

module.exports = { find, version, search, playlist, download, install, EXE };
