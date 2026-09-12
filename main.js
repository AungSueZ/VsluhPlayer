const { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

const { Store } = require('./lib/store');
const { Library } = require('./lib/library');
const { SmtcBridge } = require('./lib/smtc');
const { Lyrics } = require('./lib/lyrics');
const { Presence } = require('./lib/rpc');
const { MediaKeys } = require('./lib/mediakeys');
const { Serve } = require('./lib/serve');
const { fillCovers } = require('./lib/artwork');
const catalog = require('./lib/search');
const ytdlp = require('./lib/ytdlp');
const { DlQueue } = require('./lib/dlqueue');
const backup = require('./lib/backup');
const { autoUpdater } = require('electron-updater');

const DEV = process.argv.includes('--dev');

/* ---------- лог и падения ---------- */

function fatal(where, err, loud = true) {
  const msg = (err && (err.stack || err.message)) || String(err);
  console.error('[' + where + ']', msg);
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'error.log'),
      new Date().toISOString() + ' [' + where + '] ' + msg + '\n');
  } catch {}
  if (loud && app.isReady()) { try { dialog.showErrorBox('Вслух — ошибка', msg); } catch {} }
}
process.on('uncaughtException', e => fatal('uncaught', e));
process.on('unhandledRejection', e => fatal('rejection', e, false));

function step(msg) {
  if (!DEV) return;
  console.error('[step]', msg);
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'start.log'),
      new Date().toISOString().slice(11, 23) + ' ' + msg + '\n');
  } catch {}
}

if (!app.requestSingleInstanceLock()) { app.quit(); }

app.setAppUserModelId('app.vsluh.player');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let win = null;
let store, library, smtc, lyrics, presence, mediaKeys, serve;

let playerState = { playing: false, title: '', artist: '', album: '', position: 0, duration: 0, source: 'local' };

const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.ogv', '.mov']);

function allowed(p) {
  const norm = path.resolve(p).toLowerCase();
  const roots = [app.getPath('userData'), app.getAppPath(), ...(store?.all.folders || [])];
  if (store?.all.videoFolder) roots.push(store.all.videoFolder);
  return roots.some(r => {
    const rr = path.resolve(r).toLowerCase();
    return norm === rr || norm.startsWith(rr + path.sep);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 780, minWidth: 940, minHeight: 620,
    frame: false,
    show: false,
    backgroundColor: '#08070a',
    title: 'Вслух',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: ['--aung-base=' + serve.origin, '--aung-token=' + serve.token],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  step('окно создано');
  win.loadURL(serve.pageUrl)
     .then(() => step('loadURL ок'))
     .catch(e => fatal('loadURL', e));
  win.once('ready-to-show', () => { step('ready-to-show'); win.show(); });
  win.webContents.once('did-finish-load', () => { step('did-finish-load'); maybeShot(); });
  win.webContents.on('did-fail-load', (e, code, desc, url) => step(`did-fail-load ${code} ${desc} ${url}`));
  win.webContents.on('preload-error', (e, f, err) => fatal('preload', err));
  win.webContents.on('console-message', (e, lvl, msg, line, src) => {
    if (lvl >= 2) step(`консоль: ${msg} (${src}:${line})`);
  });
  setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible()) { step('показываю по таймауту'); win.show(); }
  }, 4000);
  win.webContents.on('render-process-gone', (e, d) => fatal('renderer', d.reason));
  if (process.argv.includes('--devtools')) win.webContents.openDevTools({ mode: 'detach' });

  const sendMax = () => send('win:max-changed', win.isMaximized());
  win.on('maximize', sendMax);
  win.on('unmaximize', sendMax);
  win.on('closed', () => { win = null; });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(serve.origin)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
}

function send(ch, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(ch, payload);
}

function maybeShot() {
  if (!DEV) return;
  const arg = process.argv.find(a => a.startsWith('--shot='));
  if (!arg) return;
  const out = arg.slice(7);
  const view = (process.argv.find(a => a.startsWith('--shot-view=')) || '').split('=')[1];
  const wait = Number((process.argv.find(a => a.startsWith('--shot-wait=')) || '').split('=')[1]) || 2500;
  const js64 = (process.argv.find(a => a.startsWith('--shot-js=')) || '').split('=')[1];
  const after = Number((process.argv.find(a => a.startsWith('--shot-after=')) || '').split('=')[1]) || 900;

  setTimeout(async () => {
    try {
      if (js64) await win.webContents.executeJavaScript(Buffer.from(js64, 'base64').toString('utf8'));
      if (view) await win.webContents.executeJavaScript(`go(${JSON.stringify(view)})`);
      await new Promise(r => setTimeout(r, after));
      const img = await win.webContents.capturePage();
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, img.toPNG());
      step('снимок: ' + out);
    } catch (e) { fatal('shot', e); }
    if (process.argv.includes('--shot-quit')) app.quit();
  }, wait);
}

/* ---------- скачивание ---------- */

// кнопка «скачать» кладёт yt-dlp сюда: в Program Files писать без прав нельзя
function ytdlpDir() {
  return app.getPath('userData');
}

function ytdlpPath() {
  return ytdlp.find(app.getAppPath(), [ytdlpDir()]);
}

function downloadDir() {
  if (store.all.downloadFolder) return store.all.downloadFolder;
  // по умолчанию кладём не на системный диск, если есть куда
  const bs = String.fromCharCode(92);
  const guess = fs.existsSync('D:' + bs) ? 'D:' + bs + 'Music' : path.join(app.getPath('music') || app.getPath('home'), 'Вслух');
  store.set({ downloadFolder: guess });
  return guess;
}

// очередь качает по одному, но список можно пополнять и чистить на ходу
const dlq = new DlQueue({
  getExe: () => ytdlpPath(),
  getDir: () => downloadDir(),
  getCookies: () => (store.all.dlCookies || '').trim(),
  onChange: st => send('dl:queue', st),

  // файл лёг на диск - заводим карточку и подбираем теги с обложкой
  onFile: async (file, item) => {
    const dir = downloadDir();
    // папка должна попасть в библиотеку, иначе трек не переживёт перезапуск
    if (!store.all.folders.includes(dir)) {
      store.set({ folders: [...store.all.folders, dir] });
    }

    let track = await library.addFile(file);
    if (track) {
      // название с ютуба часто вида "Артист - Трек (клип)" - ищем в каталоге
      const m = await catalog.match({
        title: track.title || item.title,
        artist: track.artist || item.artist,
        duration: track.duration || item.duration
      });
      const meta = m || { title: item.title, artist: item.artist, cover: item.cover };
      track = (await library.applyMeta(track.id, meta)) || track;
    }
    send('dl:added', { track, tracks: library.tracks });
    return track;
  }
});

/* ---------- горячие клавиши ---------- */

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const h = store.all.hotkeys || {};
  if (h.on === false) return;

  const bind = (accel, fn) => {
    if (!accel) return;
    try { globalShortcut.register(accel, fn); } catch (e) { console.error('hotkey', accel, e.message); }
  };

  bind(h.playPause, () => send('hotkey', 'playpause'));
  bind(h.next,      () => send('hotkey', 'next'));
  bind(h.prev,      () => send('hotkey', 'prev'));
  bind(h.volUp,     () => send('hotkey', 'volup'));
  bind(h.volDown,   () => send('hotkey', 'voldown'));

  if (h.mediaKeys !== false) {
    const route = (mine, sys) => () => {
      if (playerState.source === 'local' && playerState.title) send('hotkey', mine);
      else mediaKeys.send(sys);
    };
    bind('MediaPlayPause',     route('playpause', 'playpause'));
    bind('MediaNextTrack',     route('next', 'next'));
    bind('MediaPreviousTrack', route('prev', 'prev'));
  }
}

/* ---------- обложки ---------- */

let artStop = false;
let artRunning = false;

function startArtwork() {
  if (artRunning) return;
  if (store.all.artwork?.on === false) return;
  if (!library.tracks.some(t => !t.cover && !t.noArt)) return;

  artStop = false;
  artRunning = true;
  step('ищу обложки');
  fillCovers(library, hit => send('lib:artwork', hit), () => artStop)
    .then(n => { step('обложек найдено: ' + n); send('lib:artwork-done', n); })
    .catch(e => step('обложки: ' + e.message))
    .finally(() => { artRunning = false; });
}

/* ---------- discord ---------- */

function applyDiscord() {
  const d = store.all.discord || {};
  if (!d.on || !d.clientId) { presence.disconnect(); return; }
  presence.connect(d.clientId.trim());
  pushPresence();
}

function pushPresence() {
  const d = store.all.discord || {};
  if (!d.on || !d.clientId) return;

  let t = null;
  if (playerState.title) {
    t = Object.assign({}, playerState, { app: 'Вслух' });
  } else if (d.showSystem) {
    const cur = smtc && smtc.alive ? smtc.snapshot().current : null;
    if (cur && cur.title) t = cur;
  }

  if (!t || (!t.playing && d.idleHide)) presence.clear();
  else presence.set(t);
}

/* ---------- ipc ---------- */

function wireIpc() {
  ipcMain.handle('app:info', () => ({
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    version: app.getVersion(),
    userData: app.getPath('userData'),
    dev: DEV
  }));

  ipcMain.handle('settings:get', () => store.all);

  ipcMain.handle('settings:set', (e, patch) => {
    const before = JSON.stringify(store.all.hotkeys);
    const d0 = JSON.stringify(store.all.discord);
    const s0 = store.all.smtc?.on;
    const data = store.set(patch);

    if (JSON.stringify(data.hotkeys) !== before) registerHotkeys();
    if (JSON.stringify(data.discord) !== d0) applyDiscord();
    if (data.smtc?.on !== s0) {
      if (data.smtc?.on) { smtc.start(); send('smtc:update', smtc.snapshot()); }
      else { smtc.stop(); send('smtc:update', { sessions: [], current: null }); }
    }
    return data;
  });

  ipcMain.handle('lib:list', () => library.tracks);

  ipcMain.handle('lib:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Папка с музыкой',
      properties: ['openDirectory', 'multiSelections']
    });
    if (r.canceled || !r.filePaths.length) return store.all.folders;
    const set = new Set(store.all.folders);
    r.filePaths.forEach(p => set.add(p));
    store.set({ folders: [...set] });
    return store.all.folders;
  });

  ipcMain.handle('lib:removeFolder', (e, folder) => {
    store.set({ folders: store.all.folders.filter(f => f !== folder) });
    return store.all.folders;
  });

  ipcMain.handle('lib:scan', async () => {
    const folders = store.all.folders;
    if (!folders.length) return [];
    artStop = true;
    send('lib:progress', { done: 0, total: 0, title: 'ищу файлы…' });
    const tracks = await library.scan(folders, p => send('lib:progress', p));
    send('lib:progress', null);
    setTimeout(startArtwork, 600);
    return tracks;
  });

  ipcMain.handle('lib:reveal', (e, p) => { if (p && fs.existsSync(p)) shell.showItemInFolder(p); });

  ipcMain.handle('lib:drop', async (e, paths) => {
    const dirs = [], files = [];
    for (const p of paths || []) {
      try { (fs.statSync(p).isDirectory() ? dirs : files).push(p); } catch {}
    }
    if (dirs.length) {
      const set = new Set(store.all.folders);
      dirs.forEach(d => set.add(d));
      store.set({ folders: [...set] });
    }
    return { dirs, tracks: await library.probePaths(files) };
  });

  ipcMain.handle('video:pick', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Папка с фоновыми видео',
      properties: ['openDirectory']
    });
    if (r.canceled || !r.filePaths.length) return store.all.videoFolder;
    store.set({ videoFolder: r.filePaths[0] });
    return store.all.videoFolder;
  });

  ipcMain.handle('video:clear', () => { store.set({ videoFolder: '' }); return ''; });

  ipcMain.handle('video:list', () => {
    const dir = store.all.videoFolder;
    if (!dir) return [];
    const out = [];
    const walk = (d, depth) => {
      if (depth > 2) return;
      let items;
      try { items = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const it of items) {
        const full = path.join(d, it.name);
        if (it.isDirectory()) walk(full, depth + 1);
        else if (VIDEO_EXT.has(path.extname(it.name).toLowerCase())) out.push(full);
      }
    };
    walk(dir, 0);
    return out;
  });

  /* ---- поиск по каталогам ---- */

  ipcMain.handle('search:query', (e, q) => catalog.search(q));

  ipcMain.handle('yt:search', async (e, q) => {
    if (!q) return { items: [] };

    // yt-dlp ищет сам и без ключей - если он есть, идём через него
    const exe = ytdlpPath();
    if (exe) {
      try { return { items: await ytdlp.search(exe, q, 25) }; }
      catch (err) { return { error: String(err.message || err), items: [] }; }
    }

    const key = (store.all.ytKey || '').trim();
    if (!key) return { error: 'nokey', items: [] };

    const get = async u => {
      const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        const msg = j?.error?.message || ('HTTP ' + r.status);
        throw new Error(msg);
      }
      return j;
    };

    try {
      const s = await get('https://www.googleapis.com/youtube/v3/search'
        + '?part=snippet&type=video&videoCategoryId=10&maxResults=25'
        + '&q=' + encodeURIComponent(q) + '&key=' + encodeURIComponent(key));

      const ids = (s.items || []).map(i => i.id?.videoId).filter(Boolean);
      if (!ids.length) return { items: [] };

      const d = await get('https://www.googleapis.com/youtube/v3/videos'
        + '?part=contentDetails&id=' + ids.join(',') + '&key=' + encodeURIComponent(key));
      const dur = {};
      for (const v of d.items || []) {
        const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(v.contentDetails?.duration || '');
        dur[v.id] = m ? (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)) : 0;
      }

      return {
        items: (s.items || []).filter(i => i.id?.videoId).map(i => ({
          src: 'yt',
          id: i.id.videoId,
          title: (i.snippet?.title || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'"),
          artist: i.snippet?.channelTitle || '',
          album: '',
          year: Number(String(i.snippet?.publishedAt || '').slice(0, 4)) || 0,
          duration: dur[i.id.videoId] || 0,
          cover: i.snippet?.thumbnails?.high?.url || i.snippet?.thumbnails?.medium?.url || '',
          url: 'https://www.youtube.com/watch?v=' + i.id.videoId
        }))
      };
    } catch (err) {
      return { error: String(err.message || err), items: [] };
    }
  });

  /* ---- разбор ссылок ---- */

  ipcMain.handle('stream:resolve', async (e, url) => {
    const u = String(url || '').trim();

    const yt = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/.exec(u);
    if (yt) {
      let title = '', artist = '', cover = '';
      try {
        const r = await fetch('https://www.youtube.com/oembed?format=json&url=' +
          encodeURIComponent('https://www.youtube.com/watch?v=' + yt[1]), { signal: AbortSignal.timeout(8000) });
        if (r.ok) {
          const j = await r.json();
          title = j.title || ''; artist = j.author_name || ''; cover = j.thumbnail_url || '';
        }
      } catch {}
      return { src: 'yt', id: yt[1], title: title || 'Трек с YouTube', artist, cover,
               duration: 0, url: 'https://www.youtube.com/watch?v=' + yt[1] };
    }

    if (/^https?:\/\/(www\.)?soundcloud\.com\/[^\/]+\/[^\/]+/i.test(u)) {
      let title = '', artist = '', cover = '';
      try {
        const r = await fetch('https://soundcloud.com/oembed?format=json&url=' + encodeURIComponent(u),
          { signal: AbortSignal.timeout(8000) });
        if (r.ok) {
          const j = await r.json();
          title = j.title || ''; artist = j.author_name || ''; cover = j.thumbnail_url || '';
        }
      } catch {}
      return { src: 'sc', id: u, title: title || 'Трек с SoundCloud', artist, cover, duration: 0, url: u };
    }

    return null;
  });

  ipcMain.handle('lib:applyMeta', (e, p) => library.applyMeta(p?.id, p?.meta));

  ipcMain.handle('search:fixTags', async () => {
    const todo = library.tracks.filter(t => !t.artist || !t.tagged);
    let done = 0, fixed = 0;

    for (const t of todo) {
      send('search:progress', { done, total: todo.length, title: t.title });
      const m = await catalog.match({ title: t.title, artist: t.artist, duration: t.duration });
      if (m) {
        const upd = await library.applyMeta(t.id, m);
        if (upd) { fixed++; send('lib:artwork', { id: t.id, cover: upd.cover }); }
      } else {
        t.tagged = true;
      }
      done++;
      await new Promise(r => setTimeout(r, 300));
    }

    library.save();
    send('search:progress', null);
    return { checked: todo.length, fixed, tracks: library.tracks };
  });

  /* ---- скачивание через yt-dlp ---- */

  ipcMain.handle('dl:status', async () => {
    const exe = ytdlpPath();
    if (!exe) return { ok: false, folder: store.all.downloadFolder || '' };
    try {
      return { ok: true, exe, version: await ytdlp.version(exe), folder: downloadDir() };
    } catch (e) {
      return { ok: false, exe, error: String(e.message || e), folder: store.all.downloadFolder || '' };
    }
  });

  /* ---- обновления ---- */

  ipcMain.handle('upd:state', () => updState);

  ipcMain.handle('upd:check', async () => {
    if (!app.isPackaged) return { state: 'dev' };
    try { await autoUpdater.checkForUpdates(); } catch (e) { setUpd({ state: 'error', error: updError(e) }); }
    return updState;
  });

  ipcMain.handle('upd:download', async () => {
    try { await autoUpdater.downloadUpdate(); } catch (e) { setUpd({ state: 'error', error: updError(e) }); }
    return updState;
  });

  // ставим и перезапускаемся; до этого момента ничего не подменяется
  ipcMain.handle('upd:install', () => { setImmediate(() => autoUpdater.quitAndInstall(false, true)); return true; });

  ipcMain.handle('dl:install', async () => {
    if (dlq.state().busy) return { error: 'сейчас идёт скачивание — дождись конца очереди' };
    try {
      const r = await ytdlp.install(ytdlpDir(), p => send('dl:install', Math.round(p)));
      send('dl:install', null);
      let version = '';
      try { version = await ytdlp.version(r.file); } catch {}
      return { ok: true, file: r.file, size: r.size, sha256: r.sha256, version };
    } catch (err) {
      send('dl:install', null);
      return { error: String(err.message || err) };
    }
  });

  ipcMain.handle('dl:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Куда складывать скачанное',
      properties: ['openDirectory', 'createDirectory']
    });
    if (r.canceled || !r.filePaths.length) return store.all.downloadFolder || '';
    store.set({ downloadFolder: r.filePaths[0] });
    return r.filePaths[0];
  });

  ipcMain.handle('dl:queue', () => dlq.state());

  ipcMain.handle('dl:add', (e, items) => {
    if (!ytdlpPath()) return { error: 'yt-dlp не найден', state: dlq.state() };
    const list = (Array.isArray(items) ? items : [items]).filter(x => x && x.url);
    if (!list.length) return { error: 'нечего качать', state: dlq.state() };
    return dlq.add(list);
  });

  ipcMain.handle('dl:cancel', (e, key) => dlq.cancel(key));
  ipcMain.handle('dl:clear', (e, what) => dlq.clear(what));
  ipcMain.handle('dl:pause', (e, on) => dlq.pause(on));

  // ссылка на плейлист/альбом/сет -> список треков, готовый для очереди
  ipcMain.handle('dl:playlist', async (e, url) => {
    const exe = ytdlpPath();
    if (!exe) return { error: 'yt-dlp не найден', items: [] };
    if (!/^https?:\/\//i.test(url || '')) return { error: 'нужна ссылка', items: [] };
    try {
      return await ytdlp.playlist(exe, url, 300);
    } catch (err) {
      return { error: String(err.message || err), items: [] };
    }
  });

  /* ---- студия: картинка и клип из окна ---- */

  ipcMain.handle('studio:save', async (e, p) => {
    const ext = /^(png|mp4|webm)$/.test(p?.ext) ? p.ext : 'png';
    const pic = ext === 'png';
    const name = String(p?.name || 'vsluh.' + ext);
    const dir = (pic ? app.getPath('pictures') : app.getPath('videos')) || app.getPath('home');

    const r = await dialog.showSaveDialog(win, {
      title: pic ? 'Куда сохранить карточку' : 'Куда сохранить клип',
      defaultPath: path.join(dir, name),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
    });
    if (r.canceled || !r.filePath) return { canceled: true };

    try {
      fs.writeFileSync(r.filePath, Buffer.from(p.data));
      return { file: r.filePath };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  });

  /* ---- бэкап библиотеки ---- */

  ipcMain.handle('backup:export', async () => {
    const name = 'vsluh-' + new Date().toISOString().slice(0, 10) + '.json';
    const r = await dialog.showSaveDialog(win, {
      title: 'Куда сохранить бэкап',
      defaultPath: path.join(app.getPath('documents') || app.getPath('home'), name),
      filters: [{ name: 'Бэкап Вслух', extensions: ['json'] }]
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    try {
      const data = backup.make(store, library);
      fs.writeFileSync(r.filePath, JSON.stringify(data, null, 1), 'utf8');
      return {
        file: r.filePath,
        tracks: data.tracks.length,
        playlists: data.playlists.length,
        favorites: data.favorites.length
      };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  });

  ipcMain.handle('backup:import', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Выбери файл бэкапа',
      filters: [{ name: 'Бэкап Вслух', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths.length) return { canceled: true };

    try {
      const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
      const res = await backup.restore(data, store, library, p => send('backup:progress', p));
      send('backup:progress', null);
      // из бэкапа могли приехать другие клавиши и настройки дискорда
      registerHotkeys();
      applyDiscord();
      return Object.assign(res, { settings: store.all, tracks: library.tracks });
    } catch (err) {
      send('backup:progress', null);
      return { error: String(err.message || err) };
    }
  });

  ipcMain.handle('lyrics:get', (e, t) => lyrics.get(t || {}));

  ipcMain.handle('smtc:get', () => (smtc ? smtc.snapshot() : { sessions: [], current: null }));
  ipcMain.handle('smtc:control', (e, what) => mediaKeys.send(what));

  ipcMain.handle('discord:state', () => presence.status());
  ipcMain.handle('discord:reconnect', () => { presence.disconnect(true); applyDiscord(); return presence.status(); });

  ipcMain.on('player:state', (e, s) => {
    playerState = Object.assign(playerState, s || {});
    pushPresence();
  });

  ipcMain.on('win:full', (e, on) => { if (win) win.setFullScreen(!!on); });
  ipcMain.on('win:min', () => win && win.minimize());
  ipcMain.on('win:max', () => { if (!win) return; win.isMaximized() ? win.unmaximize() : win.maximize(); });
  ipcMain.on('win:close', () => win && win.close());
  ipcMain.on('open:userdata', () => shell.openPath(app.getPath('userData')));
  ipcMain.on('open:external', (e, url) => { if (/^https?:/.test(url)) shell.openExternal(url); });
}

/* ---------- обновления ---------- */

let updState = { state: 'idle', version: app.getVersion(), percent: 0, error: '' };

// electron-updater ругается ссылками и стектрейсами - оставляем суть
const UPD_HINTS = [
  [/cannot find latest\.yml|latest\.yml.*404/i, 'в последнем релизе нет файла с описанием версии'],
  [/ENOTFOUND|getaddrinfo|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ETIMEDOUT/i, 'нет связи с GitHub'],
  [/rate limit/i, 'GitHub просит подождать — слишком много проверок подряд'],
  [/404/i, 'релиз не найден'],
  [/EPERM|EACCES|EBUSY/i, 'не хватает прав заменить файлы — запусти от администратора'],
  [/ENOSPC|no space/i, 'на диске нет места']
];

function updError(raw) {
  const text = String((raw && (raw.message || raw)) || '');
  for (const [re, msg] of UPD_HINTS) if (re.test(text)) return msg;
  const line = text.split('\n')[0].trim() || 'не получилось';
  return line.length > 110 ? line.slice(0, 110) + '…' : line;
}

function setUpd(patch) {
  updState = Object.assign({}, updState, patch);
  send('upd:state', updState);
}

// electron-updater складывает скачанный установщик в %LOCALAPPDATA%\vsluh-updater
// и после установки его там оставляет - сотня-другая мегабайт впустую.
// чистим только когда сервер ответил "у тебя последняя": значит, ждать нечего
function dropUpdCache() {
  try {
    const base = process.env.LOCALAPPDATA;
    if (!base) return;
    const dir = path.join(base, app.getName().toLowerCase() + '-updater');
    if (!fs.existsSync(dir)) return;
    let size = 0;
    for (const f of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (f.isFile()) { try { size += fs.statSync(path.join(f.parentPath || f.path, f.name)).size; } catch {} }
    }
    fs.rmSync(dir, { recursive: true, force: true });
    if (size) step('кэш обновлений очищен: ' + Math.round(size / 1048576) + ' МБ');
  } catch { /* занят или уже удалён - не беда, вычистим в следующий раз */ }
}

function wireUpdates() {
  // из исходников обновлять нечего, да и нечем - обновляется установленная сборка
  if (!app.isPackaged) { setUpd({ state: 'dev' }); return; }

  autoUpdater.autoDownload = false;          // спрашиваем, а не тянем молча
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => setUpd({ state: 'checking', error: '' }));
  autoUpdater.on('update-available', i => setUpd({ state: 'found', next: i.version }));
  autoUpdater.on('update-not-available', () => { setUpd({ state: 'none' }); dropUpdCache(); });
  autoUpdater.on('download-progress', p => setUpd({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', i => setUpd({ state: 'ready', next: i.version, percent: 100 }));
  autoUpdater.on('error', e => setUpd({ state: 'error', error: updError(e) }));

  if (store.all.updates?.on !== false) {
    // не на самом старте: пусть окно сначала появится
    setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 9000);
  }
}

/* ---------- переезд со старого имени ---------- */

// приложение раньше звалось Aung Player и хранило всё в %APPDATA%\aung-player.
// копируем оттуда, а не переносим: если что-то пойдёт не так, данные останутся на месте
function migrateUserData() {
  try {
    const next = app.getPath('userData');
    const prev = path.join(app.getPath('appData'), 'aung-player');
    if (prev === next || !fs.existsSync(prev)) return;
    if (fs.existsSync(path.join(next, 'settings.json'))) return;   // уже переехали

    fs.mkdirSync(next, { recursive: true });
    let moved = 0;
    for (const name of ['settings.json', 'library.json', 'covers', 'lyrics', 'yt-dlp.exe']) {
      const from = path.join(prev, name), to = path.join(next, name);
      if (!fs.existsSync(from) || fs.existsSync(to)) continue;
      fs.cpSync(from, to, { recursive: true });
      moved++;
    }

    // пути к обложкам в библиотеке абсолютные и ведут в старую папку, а сервер
    // отдаёт файлы только из разрешённых - переписываем на новое место
    const lib = path.join(next, 'library.json');
    if (fs.existsSync(lib)) {
      const raw = fs.readFileSync(lib, 'utf8');
      const fixed = raw.split(JSON.stringify(prev).slice(1, -1)).join(JSON.stringify(next).slice(1, -1));
      if (fixed !== raw) { fs.writeFileSync(lib, fixed, 'utf8'); step('пути к обложкам переписаны'); }
    }

    step('перенесено из aung-player: ' + moved);
  } catch (e) {
    fatal('переезд данных', e, false);
  }
}

/* ---------- старт ---------- */

app.whenReady().then(async () => {
  step('app ready');
  nativeTheme.themeSource = 'dark';

  migrateUserData();

  const dir = app.getPath('userData');
  store = new Store(dir);
  library = new Library(dir);
  lyrics = new Lyrics(dir);
  presence = new Presence();
  mediaKeys = new MediaKeys(dir);
  smtc = new SmtcBridge(path.join(dir, 'smtc'), /vsluh|вслух|aung.?player|^electron/i);

  presence.onState = s => send('discord:state', s);

  serve = new Serve(app.getAppPath(), () => {
    const roots = [app.getPath('userData'), app.getAppPath(), ...(store.all.folders || [])];
    if (store.all.videoFolder) roots.push(store.all.videoFolder);
    return roots;
  });
  await serve.start();
  step('сервер на ' + serve.origin);

  step('модули собраны');
  wireIpc();
  createWindow();
  step('createWindow отработал');

  smtc.on('update', snap => { send('smtc:update', snap); pushPresence(); });
  smtc.on('error', e => step('smtc: ' + e));
  if (store.all.smtc?.on !== false) smtc.start();
  step('smtc запущен');

  registerHotkeys();
  step('горячие клавиши');
  setTimeout(startArtwork, 3000);
  try { wireUpdates(); } catch (e) { fatal('обновления', e, false); }
  applyDiscord();
  step('запуск завершён');

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => app.quit());

app.on('will-quit', () => {
  artStop = true;
  try { serve && serve.stop(); } catch {}
  globalShortcut.unregisterAll();
  try { smtc && smtc.stop(); } catch {}
  try { presence && presence.disconnect(); } catch {}
  try { mediaKeys && mediaKeys.stop(); } catch {}
  try { store && store.flush(); } catch {}
});