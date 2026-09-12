// поиск обложек в интернете для треков, у которых их нет в файле
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DEEZER = 'https://api.deezer.com/search?limit=1&q=';
const ITUNES = 'https://itunes.apple.com/search?entity=song&limit=1&term=';

const urlCache = new Map();

function clean(s) {
  return String(s || '')
    .replace(/\((?:official|lyric|audio|video|prod\.?|slowed|sped up)[^)]*\)/gi, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ссылка на картинку по артисту и названию
async function searchCoverUrl(artist, title) {
  const a = clean(artist), t = clean(title);
  if (!t) return null;
  const key = (a + '|' + t).toLowerCase();
  if (urlCache.has(key)) return urlCache.get(key);

  const q = [a, t].filter(Boolean).join(' ');
  let url = null;

  try {
    const r = await fetch(DEEZER + encodeURIComponent(q), { signal: AbortSignal.timeout(7000) });
    if (r.ok) {
      const j = await r.json();
      url = j?.data?.[0]?.album?.cover_big || j?.data?.[0]?.album?.cover_medium || null;
    }
  } catch {}

  if (!url) {
    try {
      const r = await fetch(ITUNES + encodeURIComponent(q), { signal: AbortSignal.timeout(7000) });
      if (r.ok) {
        const j = await r.json();
        const art = j?.results?.[0]?.artworkUrl100;
        if (art) url = art.replace(/\/\d+x\d+bb\./, '/512x512bb.');
      }
    } catch {}
  }

  if (urlCache.size > 400) urlCache.clear();
  urlCache.set(key, url);
  return url;
}

// скачивает обложку в папку кэша, возвращает путь к файлу
async function fetchCover(track, coverDir) {
  if (!track || track.cover) return null;
  if (!track.title) return null;

  const url = await searchCoverUrl(track.artist, track.title);
  if (!url) return null;

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 900) return null;          // заглушка вместо картинки
    const file = path.join(coverDir, track.id + '.jpg');
    await fsp.writeFile(file, buf);
    return file;
  } catch { return null; }
}

// проходит по библиотеке и добирает недостающие обложки
// onFound({id, cover}) вызывается на каждую найденную
async function fillCovers(library, onFound, shouldStop) {
  const todo = library.tracks.filter(t => !t.cover && !t.noArt && t.title);
  let found = 0;

  for (const t of todo) {
    if (shouldStop && shouldStop()) break;
    const file = await fetchCover(t, library.coverDir);
    if (file) {
      t.cover = file;
      found++;
      onFound && onFound({ id: t.id, cover: file });
    } else {
      t.noArt = true;        // больше не дёргаем сеть из-за этого трека
    }
    await new Promise(r => setTimeout(r, 350));   // не долбим чужие api
  }

  if (todo.length) library.save();
  return found;
}

module.exports = { searchCoverUrl, fetchCover, fillCovers };
