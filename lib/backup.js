// бэкап библиотеки: один json, который можно унести на другой компьютер.
// это и есть "синхронизация" - без аккаунтов, паролей и чужого сервера.
const fs = require('fs');
const { idOf } = require('./library');

// сиюминутное переносить незачем
const SKIP = ['lastTrack', 'view', 'libTab', 'favorites', 'playlists', 'folders'];

function make(store, library) {
  const cfg = JSON.parse(JSON.stringify(store.all));
  for (const k of SKIP) delete cfg[k];

  // ключи и токены наружу не выносим: файл может уйти куда угодно
  cfg.ytKey = '';
  if (cfg.discord) cfg.discord = Object.assign({}, cfg.discord, { clientId: '' });

  const pathOf = id => (library.byId.get(id) || {}).path || '';

  return {
    app: 'vsluh',
    v: 1,
    date: new Date().toISOString(),
    settings: cfg,
    folders: (store.all.folders || []).slice(),
    // плейлисты и избранное храним путями к файлам: id считается от пути и
    // на другом компьютере будет другим
    favorites: (store.all.favorites || []).map(pathOf).filter(Boolean),
    playlists: (store.all.playlists || []).map(p => ({
      name: p.name || 'плейлист',
      tracks: (p.tracks || []).map(pathOf).filter(Boolean)
    })),
    tracks: library.tracks.map(t => ({
      path: t.path,
      title: t.title, artist: t.artist, album: t.album,
      year: t.year, duration: t.duration, added: t.added,
      tagged: !!t.tagged
    }))
  };
}

// onProgress({done,total,title})
async function restore(data, store, library, onProgress) {
  // старые бэкапы подписаны прежним именем - их тоже принимаем
  const ours = data && (data.app === 'vsluh' || data.app === 'aung-player');
  if (!ours || !Array.isArray(data.tracks)) {
    throw new Error('это не похоже на бэкап Вслух');
  }

  const out = { restored: 0, added: 0, missing: 0, playlists: 0, favorites: 0, folders: 0 };

  // 1. настройки - поверх нынешних, store сам сольёт по уровням
  if (data.settings) store.set(data.settings);

  // 2. папки, которые на этом компьютере действительно есть
  const keepFolders = (data.folders || []).filter(f => { try { return fs.existsSync(f); } catch { return false; } });
  if (keepFolders.length) {
    const merged = [...new Set([...(store.all.folders || []), ...keepFolders])];
    out.folders = merged.length - (store.all.folders || []).length;
    store.set({ folders: merged });
  }

  // 3. треки: файл на месте - возвращаем имя, артиста и альбом, которые ты правил
  const total = data.tracks.length;
  let done = 0;

  for (const t of data.tracks) {
    done++;
    if (onProgress && (done % 10 === 0 || done === total)) {
      onProgress({ done, total, title: t.title || '' });
    }
    if (!t.path) continue;
    let exists = false;
    try { exists = fs.existsSync(t.path); } catch {}
    if (!exists) { out.missing++; continue; }

    const id = idOf(t.path);
    if (!library.byId.has(id)) {
      const added = await library.addFile(t.path);
      if (!added) { out.missing++; continue; }
      out.added++;
    }
    if (t.tagged || t.artist) {
      await library.applyMeta(id, { title: t.title, artist: t.artist, album: t.album, year: t.year });
    }
    out.restored++;
  }

  // 4. избранное и плейлисты - обратно из путей в id
  const known = p => { const id = idOf(p); return library.byId.has(id) ? id : null; };

  if (Array.isArray(data.favorites)) {
    const fav = [...new Set([...(store.all.favorites || []), ...data.favorites.map(known).filter(Boolean)])];
    out.favorites = fav.length;
    store.set({ favorites: fav });
  }

  if (Array.isArray(data.playlists) && data.playlists.length) {
    const cur = (store.all.playlists || []).slice();
    for (const p of data.playlists) {
      const tracks = (p.tracks || []).map(known).filter(Boolean);
      const same = cur.find(x => x.name === p.name);
      if (same) same.tracks = [...new Set([...(same.tracks || []), ...tracks])];
      else cur.push({ id: 'pl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: p.name, tracks });
      out.playlists++;
    }
    store.set({ playlists: cur });
  }

  store.flush();
  library.save();
  return out;
}

module.exports = { make, restore };
