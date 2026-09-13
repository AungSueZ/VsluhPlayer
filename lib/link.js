// Разбор вставленной ссылки: что это - ролик с YouTube, трек с SoundCloud или
// просто файл, лежащий где-то в сети.
//
// Ничего не качает: у площадок спрашивает только название с обложкой, у файла -
// в худшем случае заголовки. Сам звук потом идёт мимо, через прокси в serve.js.
//
// В сеть ходит только через guardedFetch: вставленная ссылка не должна уводить
// плеер внутрь домашней сети даже одним запросом заголовков.
const { guardedFetch, looksLocal } = require('./safeurl');

// расширения, по которым файл виден без единого запроса к сети
const AUDIO_EXT = /\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|wma|aif|aiff|mp4|weba)$/i;

// сократители: сама по себе такая ссылка ничего не говорит
const SHORT = /^https?:\/\/(on\.soundcloud\.com|soundcloud\.app\.goo\.gl|clck\.ru|vk\.cc|bit\.ly|tinyurl\.com)\//i;

const YT = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/;
const SC = /^https?:\/\/(www\.|m\.)?soundcloud\.com\/[^\/?#]+\/[^\/?#]+/i;

// спрашиваем у короткой ссылки, куда она ведёт.
// переходы отслеживает сам guardedFetch - у ответа .url уже настоящий адрес
async function unshort(u, net) {
  if (!SHORT.test(u)) return u;
  try {
    const r = await net(u, { method: 'HEAD' });
    return r.url || u;
  } catch { return u; }
}

async function oembed(api, url, net) {
  try {
    const r = await net(api + encodeURIComponent(url));
    if (!r.ok) return {};
    const j = await r.json();
    return { title: j.title || '', artist: j.author_name || '', cover: j.thumbnail_url || '' };
  } catch { return {}; }
}

// имя трека берём из имени файла: "01_Some_Track.mp3" -> "01 Some Track"
function nameFrom(u, fallback) {
  try {
    const last = decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).pop() || '');
    return last.replace(AUDIO_EXT, '').replace(/[_+]+/g, ' ').trim() || fallback;
  } catch { return fallback; }
}

// прямая ссылка на файл: по расширению - сразу, без расширения - спрашиваем тип
async function asDirect(u, T, net) {
  let known = false;
  try {
    const p = new URL(u);
    // такой трек всё равно не проиграется - прокси внутрь сети не ходит.
    // отказываем сразу, чтобы не показывать карточку, за которой тишина
    if (looksLocal(p.hostname)) return null;
    known = AUDIO_EXT.test(p.pathname);
  } catch { return null; }

  if (!known) {
    try {
      const r = await net(u, { method: 'HEAD' });
      known = r.ok && /^(audio\/|application\/ogg)/i.test(r.headers.get('content-type') || '');
    } catch { known = false; }
  }
  if (!known) return null;

  return {
    src: 'url', id: 'url:' + u, url: u,
    title: nameFrom(u, T('Трек по ссылке')), artist: '', cover: '', duration: 0
  };
}

/* Вернёт карточку трека или null, если ссылку не опознали.
   T - перевод подписей, net - подмена ходока по сети для проверок. */
async function resolve(url, T = s => s, net = guardedFetch) {
  const u = await unshort(String(url || '').trim(), net);

  const yt = YT.exec(u);
  if (yt) {
    const watch = 'https://www.youtube.com/watch?v=' + yt[1];
    const m = await oembed('https://www.youtube.com/oembed?format=json&url=', watch, net);
    return { src: 'yt', id: yt[1], url: watch, duration: 0,
             title: m.title || T('Трек с YouTube'), artist: m.artist || '', cover: m.cover || '' };
  }

  if (SC.test(u)) {
    const m = await oembed('https://soundcloud.com/oembed?format=json&url=', u, net);
    return { src: 'sc', id: u, url: u, duration: 0,
             title: m.title || T('Трек с SoundCloud'), artist: m.artist || '', cover: m.cover || '' };
  }

  // не площадка, а файл: такой трек плеер играет сам - со своим эквалайзером,
  // визуализацией, переходом и текстом, как будто он лежит на диске
  if (/^https?:\/\//i.test(u)) return await asDirect(u, T, net);

  return null;
}

module.exports = { resolve, AUDIO_EXT, YT, SC, SHORT, nameFrom };
