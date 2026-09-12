// поиск по открытым каталогам: Deezer и iTunes.
// ключей и регистраций не нужно, отдают название, артиста, альбом,
// обложку и 30-секундный отрывок.
const DEEZER = 'https://api.deezer.com/search?limit=30&q=';
const ITUNES = 'https://itunes.apple.com/search?entity=song&limit=30&term=';

const norm = s => String(s || '')
  .toLowerCase()
  .replace(/[ё]/g, 'е')
  .replace(/\((?:official|lyric|audio|video|prod\.?|slowed|sped up|remix|feat\.?|ft\.?)[^)]*\)/g, '')
  .replace(/\[[^\]]*\]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();

const key = r => norm(r.artist) + '|' + norm(r.title);

async function ask(url, ms = 8000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function fromDeezer(j) {
  if (!j || !Array.isArray(j.data)) return [];
  return j.data.map(d => ({
    src: 'deezer',
    id: 'dz' + d.id,
    title: (d.title_short || d.title || '').trim(),
    artist: (d.artist?.name || '').trim(),
    album: (d.album?.title || '').trim(),
    year: 0,
    duration: d.duration || 0,
    cover: d.album?.cover_big || d.album?.cover_medium || '',
    preview: d.preview || '',
    link: d.link || ''
  })).filter(r => r.title);
}

function fromItunes(j) {
  if (!j || !Array.isArray(j.results)) return [];
  return j.results.map(d => ({
    src: 'itunes',
    id: 'it' + d.trackId,
    title: (d.trackName || '').trim(),
    artist: (d.artistName || '').trim(),
    album: (d.collectionName || '').trim(),
    year: d.releaseDate ? Number(String(d.releaseDate).slice(0, 4)) : 0,
    duration: d.trackTimeMillis ? Math.round(d.trackTimeMillis / 1000) : 0,
    cover: (d.artworkUrl100 || '').replace(/\/\d+x\d+bb\./, '/600x600bb.'),
    preview: d.previewUrl || '',
    link: d.trackViewUrl || ''
  })).filter(r => r.title);
}

// Deezer основной, iTunes добивает то, чего у него нет (и даёт год)
async function search(q) {
  const query = String(q || '').trim();
  if (!query) return [];

  const [dz, it] = await Promise.all([
    ask(DEEZER + encodeURIComponent(query)).then(fromDeezer),
    ask(ITUNES + encodeURIComponent(query)).then(fromItunes)
  ]);

  const out = [];
  const seen = new Map();

  for (const r of dz) {
    seen.set(key(r), out.length);
    out.push(r);
  }
  for (const r of it) {
    const k = key(r);
    if (seen.has(k)) {
      // год у Deezer в поиске не приходит - берём его из iTunes
      const old = out[seen.get(k)];
      if (!old.year && r.year) old.year = r.year;
      if (!old.preview && r.preview) old.preview = r.preview;
      continue;
    }
    seen.set(k, out.length);
    out.push(r);
  }
  return out;
}

// насколько кандидат похож на искомое: 0..1
function score(want, r) {
  const a = norm(want.title), b = norm(r.title);
  if (!a || !b) return 0;

  let s = 0;
  if (a === b) s += 0.55;
  else if (b.includes(a) || a.includes(b)) s += 0.38;
  else {
    const wa = new Set(a.split(' ')), wb = b.split(' ');
    const hit = wb.filter(w => wa.has(w)).length;
    s += 0.38 * (hit / Math.max(wa.size, wb.length));
  }

  if (want.artist) {
    const x = norm(want.artist), y = norm(r.artist);
    if (x && y && (x === y || x.includes(y) || y.includes(x))) s += 0.25;
  }

  if (want.duration && r.duration) {
    const d = Math.abs(want.duration - r.duration);
    if (d <= 2) s += 0.2;
    else if (d <= 5) s += 0.13;
    else if (d <= 12) s += 0.05;
    else s -= 0.25;                 // длительность не сходится - почти наверняка не тот
  }
  return s;
}

// подобрать каталожную запись для локального файла
async function match(want) {
  const q = [want.artist, want.title].filter(Boolean).join(' ').trim();
  if (!q) return null;

  let list = await search(q);
  // если по артисту и названию пусто - пробуем только название
  if (!list.length && want.artist) list = await search(want.title);
  if (!list.length) return null;

  let best = null, bestScore = 0;
  for (const r of list) {
    const s = score(want, r);
    if (s > bestScore) { bestScore = s; best = r; }
  }
  if (!best || bestScore < 0.55) return null;
  return Object.assign({ score: Number(bestScore.toFixed(2)) }, best);
}

module.exports = { search, match, score, norm };
