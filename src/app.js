/* ===================== мелочи ===================== */
const $ = id => document.getElementById(id);
const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
// у <svg> нет свойства .hidden в js, только атрибут - поэтому всегда через него
const show = (node, on) => node.toggleAttribute('hidden', !on);

const fmt = s => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`
           : `${m}:${String(x).padStart(2, '0')}`;
};

let toastT = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), 2600);
}

const audio = $('audio');

/* ===================== состояние ===================== */
const S = {
  cfg: null,
  tracks: [],      // вся библиотека
  queue: [],       // что играет сейчас (id)
  order: [],       // порядок с учётом перемешивания
  pos: -1,         // индекс в order
  track: null,
  filter: '',
  view: 'now',
  source: 'local',        // local | yt | sc
  sys: { sessions: [], current: null },
  seeking: false
};

/* ===================== звук ===================== */
let actx = null, analyser = null, srcNode = null, freq = null, timeData = null;

// эквалайзер: 10 полос, усиление в дБ
const EQ_FREQ = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_PRESETS = {
  flat:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass:   [7, 6, 4.5, 2.5, 0, -1, -1, 0, 1, 2],
  vocal:  [-3, -2, 0, 2, 4, 4.5, 3.5, 2, 0, -1],
  bright: [-2, -1.5, -1, 0, 1, 2, 3.5, 5, 6, 6],
  club:   [5, 4, 2, 0, -1, 0, 2, 3, 4, 3],
  night:  [3, 2, 1, 0, -1, -2, -3, -4, -5, -5]
};
let eqNodes = [];

function applyEq() {
  if (!eqNodes.length) return;
  const on = S.cfg?.eq?.on;
  const g = S.cfg?.eq?.gains || [];
  eqNodes.forEach((n, i) => {
    const v = on ? (Number(g[i]) || 0) : 0;
    try { n.gain.setTargetAtTime(v, actx.currentTime, 0.02); }
    catch { n.gain.value = v; }
  });
}

function initAudio() {
  if (actx) return;
  try {
    actx = new AudioContext();
    srcNode = actx.createMediaElementSource(audio);
    analyser = actx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;
    analyser.minDecibels = -72;
    analyser.maxDecibels = -18;
    // источник -> 10 фильтров -> анализатор -> выход
    eqNodes = EQ_FREQ.map(f => {
      const n = actx.createBiquadFilter();
      n.type = 'peaking';
      n.frequency.value = f;
      n.Q.value = 1.1;
      n.gain.value = 0;
      return n;
    });
    let node = srcNode;
    for (const n of eqNodes) { node.connect(n); node = n; }
    node.connect(analyser);
    analyser.connect(actx.destination);
    applyEq();

    freq = new Uint8Array(analyser.frequencyBinCount);
    timeData = new Uint8Array(analyser.fftSize);
  } catch (e) {
    console.warn('web audio', e);
  }
}

/* ===================== акцент из обложки ===================== */
const accentCache = new Map();
const acCanvas = el('canvas');
acCanvas.width = acCanvas.height = 36;
const acCtx = acCanvas.getContext('2d', { willReadFrequently: true });

function applyAccent(rgb) {
  document.documentElement.style.setProperty('--ac', rgb.join(','));
}

const hexRgb = h => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function accentFrom(url) {
  const fixed = hexRgb(S.cfg?.theme?.accentColor);
  if (fixed) return applyAccent(fixed);            // свой цвет главнее обложки
  if (!S.cfg?.accent) return applyAccent([150, 140, 255]);
  if (!url) return applyAccent([150, 140, 255]);
  if (accentCache.has(url)) return applyAccent(accentCache.get(url));

  const img = new Image();   // тот же origin, что и страница - canvas не портится
  img.onload = () => {
    let best = [150, 140, 255], bestScore = -1, sr = 0, sg = 0, sb = 0, n = 0;
    try {
      acCtx.clearRect(0, 0, 36, 36);
      acCtx.drawImage(img, 0, 0, 36, 36);
      const d = acCtx.getImageData(0, 0, 36, 36).data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const sat = mx === 0 ? 0 : (mx - mn) / mx;
        const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
        sr += r; sg += g; sb += b; n++;
        // ищем живой, но не выжженный цвет
        if (lum < 0.12 || lum > 0.95) continue;
        const score = sat * 1.9 + (1 - Math.abs(lum - 0.55)) * 0.9;
        if (score > bestScore) { bestScore = score; best = [r, g, b]; }
      }
      if (bestScore < 0.5 && n) best = [sr / n, sg / n, sb / n].map(Math.round);
    } catch { /* картинка не пустила к пикселям */ }

    // поднимаем яркость, чтобы читалось на чёрном
    let [r, g, b] = best;
    const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    if (lum < 0.45) { const k = 0.45 / Math.max(lum, 0.05); r = Math.min(255, r * k); g = Math.min(255, g * k); b = Math.min(255, b * k); }
    const out = [r, g, b].map(v => Math.round(Math.max(60, Math.min(255, v))));

    if (accentCache.size > 200) accentCache.clear();
    accentCache.set(url, out);
    applyAccent(out);
  };
  img.onerror = () => applyAccent([150, 140, 255]);
  img.src = url;
}

/* ===================== плеер ===================== */
function coverUrl(t) { return t && t.cover ? window.api.file(t.cover) : ''; }

function buildOrder() {
  const n = S.queue.length;
  S.order = Array.from({ length: n }, (_, i) => i);
  if (S.cfg.shuffle) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [S.order[i], S.order[j]] = [S.order[j], S.order[i]];
    }
    // текущий трек оставляем первым
    if (S.track) {
      const cur = S.queue.indexOf(S.track.id);
      const at = S.order.indexOf(cur);
      if (at > 0) { S.order.splice(at, 1); S.order.unshift(cur); }
    }
  }
  S.pos = S.track ? S.order.indexOf(S.queue.indexOf(S.track.id)) : -1;
  renderQueue();
}

function setQueue(ids) {
  S.queue = ids;
  buildOrder();
}

function play(track, fromQueue) {
  if (!track) return;
  if (S.source !== 'local') stopStream();
  initAudio();
  S.track = track;

  if (fromQueue !== false) {
    const qi = S.queue.indexOf(track.id);
    S.pos = S.order.indexOf(qi);
  }

  audio.src = window.api.file(track.path);
  audio.volume = S.cfg.volume;
  audio.playbackRate = S.cfg.rate || 1;
  applyPitch();
  audio.play().catch(e => {
    if (e.name !== 'AbortError') toast('Не получилось открыть файл');
  });

  paintTrack(track);
  loadLyrics(track);
  renderRows();
  renderQueue();
  touchPlay(track);
  if ((S.cfg.theme || {}).vizAuto === 'track') nextViz('track');
  window.api.settings.set({ lastTrack: track.id });
}

function paintTrack(t) {
  const cov = coverUrl(t);
  const title = t.title || '—';
  const artist = t.artist || 'неизвестный исполнитель';

  $('now-title').textContent = title;
  $('now-artist').textContent = artist;
  $('bar-title').textContent = title;
  $('bar-artist').textContent = artist;
  $('now-src').hidden = true;
  document.title = `${artist} — ${title}`;

  for (const img of [$('now-art'), $('bar-img')]) {
    if (cov) { img.src = cov; img.classList.add('on'); }
    else { img.removeAttribute('src'); img.classList.remove('on'); }
  }
  applyBg(cov);
  accentFrom(cov);
  setMediaSession(t, cov);
  report();
}

// панелька громкости Windows принимает только http/data/blob,
// поэтому обложку отдаём ей через blob
let msBlob = null;
async function setMediaSession(t, cov) {
  if (!('mediaSession' in navigator)) return;
  let artwork = [];
  if (cov) {
    try {
      const b = await (await fetch(cov)).blob();
      if (msBlob) URL.revokeObjectURL(msBlob);
      msBlob = URL.createObjectURL(b);
      artwork = [{ src: msBlob, sizes: '512x512', type: b.type || 'image/jpeg' }];
    } catch {}
  }
  if (S.track !== t) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title || '', artist: t.artist || '', album: t.album || '', artwork
    });
  } catch {}
}

function step(dir) {
  if (S.source !== 'local') { streamStep(dir); return; }
  if (dir > 0) waveTopUp();          // волна не должна упереться в конец очереди
  if (!S.order.length) return;
  if (S.cfg.repeat === 'one' && dir > 0) { audio.currentTime = 0; audio.play(); return; }

  let p = S.pos + dir;
  if (p >= S.order.length) {
    if (S.cfg.repeat !== 'all') { audio.pause(); return; }
    p = 0;
  }
  if (p < 0) p = S.cfg.repeat === 'all' ? S.order.length - 1 : 0;

  S.pos = p;
  const t = S.tracks.find(x => x.id === S.queue[S.order[p]]);
  if (t) play(t, false);
}

function toggle() {
  if (S.source !== 'local') { streamToggle(); return; }
  if (!S.track) {
    const first = visibleTracks()[0];
    if (first) { setQueue(visibleTracks().map(t => t.id)); play(first); }
    return;
  }
  initAudio();
  if (actx && actx.state === 'suspended') actx.resume();
  audio.paused ? audio.play().catch(() => {}) : audio.pause();
}

function setVolume(v, save = true) {
  v = Math.max(0, Math.min(1, v));
  S.cfg.volume = v;
  audio.volume = audio.muted ? 0 : v;
  streamVolume(audio.muted ? 0 : v);
  $('vol-fill').style.width = (v * 100) + '%';
  $('vol-knob').style.left = (v * 100) + '%';
  if (save) window.api.settings.set({ volume: v });
}

function report() {
  const it = S.source === 'local' ? S.track : STREAM.item;
  window.api.player.report({
    playing: !!it && isPlaying(),
    title: it?.title || '',
    artist: it?.artist || '',
    album: it?.album || '',
    position: curTime(),
    duration: curDur(),
    source: 'local'          // главный процесс по этому полю решает, кому отдать медиа-клавиши
  });
}

/* --- события аудио --- */
function paintPlay() {
  const on = isPlaying();
  show($('ic-play'), !on);
  show($('ic-pause'), on);
  $('disc').classList.toggle('play', on);
  document.body.classList.toggle('paused', !on);
  report();
}

function paintProgress() {
  if (S.seeking) return;
  const d = curDur(), c = curTime();
  const p = d ? Math.min(100, c / d * 100) : 0;
  $('seek-fill').style.width = p + '%';
  $('seek-knob').style.left = p + '%';
  $('t-cur').textContent = fmt(c);
  $('t-dur').textContent = fmt(d);
  tickLyrics();
}

audio.addEventListener('play', () => {
  if (actx && actx.state === 'suspended') actx.resume();
  paintPlay();
});
audio.addEventListener('pause', paintPlay);
audio.addEventListener('ended', () => {
  countPlay(S.track);
  if (SLEEP.mode === 'track') { sleepNow(); return; }
  step(1);
});
audio.addEventListener('error', () => {
  if (audio.src) { toast('Файл не читается, пропускаю'); setTimeout(() => step(1), 400); }
});
audio.addEventListener('loadedmetadata', () => {
  $('t-dur').textContent = fmt(audio.duration);
  if (S.track && !S.track.duration) S.track.duration = Math.round(audio.duration);
});
audio.addEventListener('timeupdate', () => { if (S.source === 'local') paintProgress(); });
setInterval(() => {
  if (!S.track || audio.paused) return;
  report();
  const s = stats();
  s.seconds += 5;
  saveStats();
}, 5000);

/* ---- что и сколько слушали ---- */
// считается на твоём компьютере и никуда не уходит. нужно "Моей волне",
// чтобы отличать привычное от того, что давно не включали, и титулам,
// которые зарабатываются, а не покупаются

function stats() {
  const s = (S.cfg.stats = S.cfg.stats || {});
  s.plays = s.plays || {};
  s.last = s.last || {};
  s.total = s.total || 0;
  s.seconds = s.seconds || 0;
  return s;
}

let statsT = null;
function saveStats() {
  // копится каждые пять секунд - писать на диск так часто незачем
  clearTimeout(statsT);
  statsT = setTimeout(() => window.api.settings.set({ stats: stats() }), 2000);
}

// дослушал до конца - это и есть прослушивание. пропустил на середине не в счёт
function countPlay(t) {
  if (!t || !t.id) return;
  const s = stats();
  s.plays[t.id] = (s.plays[t.id] || 0) + 1;
  s.last[t.id] = Date.now();
  s.total++;
  saveStats();
}

// а вот "когда включали" отмечаем при запуске: для волны важно и это
function touchPlay(t) {
  if (!t || !t.id) return;
  stats().last[t.id] = Date.now();
  saveStats();
}

/* ===================== текст песни ===================== */
const LY = { items: [], lines: [], words: [], cur: -2, plain: false };

// собирает классы контейнера из настроек: тема, размер, свечение, размытие
function lyClasses() {
  const box = $('ly');
  box.className = 'ly'
    + ' t-' + (S.cfg.lyricsTheme || 'soft')
    + ' sz-' + (S.cfg.lyricsSize || 'md')
    + (S.cfg.lyricsGlow === false ? ' no-glow' : '')
    + (S.cfg.lyricsBlur !== false ? ' blur' : '')
    + (LY.plain ? ' plain' : '')
    + (LY.lines.length ? '' : ' off');
}

// псевдослучайное, но всегда одно и то же для одного и того же слова:
// разброс должен быть у каждого слова свой, но не меняться от кадра к кадру
function spread(n, salt) {
  const x = Math.sin((n + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function buildLyrics(res) {
  const track = $('ly-track');
  track.textContent = '';
  LY.items = [];
  LY.words = [];
  LY.lines = res.lines || [];
  LY.plain = !res.synced;
  LY.cur = -2;
  LY.nowWord = null;

  for (const l of LY.lines) {
    const d = el('div', 'ly-item' + (!l.text && !LY.plain ? ' pause' : ''));
    const s = el('span', 'ly-txt');

    // каждое слово - свой кусочек. одной заливкой на всю строку нельзя:
    // если строка переносится, градиент красит обе половины одновременно
    const words = [];
    let at = 0;
    for (const part of String(l.text || '').split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { s.appendChild(document.createTextNode(part)); at += part.length; continue; }
      const w = el('i', 'ly-w');
      w.textContent = part;
      // разброс для "разлёта" и задержка для очереди. считаем от номера слова,
      // а не случайно: иначе при каждой перерисовке слова прыгали бы заново
      const n = words.length;
      w.style.setProperty('--i', n);
      w.style.setProperty('--dx', (spread(n, 1) * 70 - 35).toFixed(1));
      w.style.setProperty('--dy', (spread(n, 2) * 44 - 22).toFixed(1));
      w.style.setProperty('--rr', (spread(n, 3) * 24 - 12).toFixed(1));
      s.appendChild(w);
      words.push({ node: w, at, len: part.length });
      at += part.length;
    }
    LY.words.push(words);

    d.appendChild(s);
    // клик по строке - перемотка на это место
    if (!LY.plain) d.onclick = () => {
      const to = Math.max(0, l.t - (Number(S.cfg.lyricsOffset) || 0));
      LY.cur = -2;
      if (S.source !== 'local') { streamSeek(to); return; }
      audio.currentTime = to;
      if (audio.paused) audio.play().catch(() => {});
    };
    track.appendChild(d);
    LY.items.push(d);
  }
  lyClasses();
  if (!LY.plain) requestAnimationFrame(() => centerLyrics(-1, true));
}

// подводит нужную строку к середине окна
function centerLyrics(i, instant) {
  if (LY.plain || !LY.items.length) return;
  const box = $('ly'), track = $('ly-track');
  const h = box.clientHeight;
  if (!h) return;                       // вкладка скрыта, размеров ещё нет

  const item = LY.items[i];
  const y = item ? h / 2 - item.offsetTop - item.offsetHeight / 2 : h / 2 - 20;

  if (instant) {
    track.style.transition = 'none';
    track.style.transform = `translateY(${y}px)`;
    void track.offsetHeight;            // заставляем применить до возврата анимации
    track.style.transition = '';
  } else {
    track.style.transform = `translateY(${y}px)`;
  }
}

// заливка текущей строки для тем "караоке" и "машинка"
// какая доля строки уже спета: 0..1, или -1 если строки нет.
// считается отдельно от отрисовки - тем же пользуются карточка и клип
function lineFill(t, i) {
  const line = LY.lines[i];
  if (!line) return -1;

  const a = line.t;
  const next = LY.lines[i + 1] ? LY.lines[i + 1].t : (audio.duration || a + 4);
  let p;

  if (line.words && line.words.length) {
    // у строки есть тайминг каждого слова - заливаем точно по нему
    const total = (line.text || '').length || 1;
    let done = 0;
    for (let k = 0; k < line.words.length; k++) {
      const w = line.words[k];
      const end = line.words[k + 1] ? line.words[k + 1].t : next;
      if (t >= end) { done += w.text.length; continue; }
      const inside = end > w.t ? (t - w.t) / (end - w.t) : 1;
      done += w.text.length * Math.max(0, Math.min(1, inside));
      break;
    }
    p = done / total;
  } else {
    // иначе считаем по примерной скорости пения: если до следующей строки
    // длинная пауза, заливка не должна ползти через неё всё это время
    const gap = Math.max(0.4, next - a);
    const est = Math.max(1.1, (line.text || '').length / 11);
    p = (t - a) / Math.min(gap, Math.max(est, gap * 0.5));
  }

  return Math.max(0, Math.min(1, p));
}

// подачи, которым нужно знать, какая часть строки уже спета
const FILL_THEMES = { karaoke: 1, type: 1, neon: 1, marker: 1, wave: 1, word: 1 };

function fillLine(t, i) {
  const th = S.cfg.lyricsTheme;
  if (!FILL_THEMES[th]) return;

  const line = LY.lines[i], words = LY.words[i];
  if (!line || !words || !words.length) return;

  const p = lineFill(t, i);
  if (p < 0) return;

  // раскидываем долю по словам: каждое знает, с какого символа строки оно начинается
  const target = p * ((line.text || '').length || 1);
  let now = -1;

  for (let n = 0; n < words.length; n++) {
    const w = words[n];
    let k = (target - w.at) / w.len;
    k = Math.max(0, Math.min(1, k));
    if (th === 'type') k = Math.ceil(k * w.len) / w.len;     // ступеньками, по буквам
    w.node.style.setProperty('--wp', (k * 100).toFixed(1) + '%');

    if (k > 0) now = n;                                      // последнее начатое слово

    // "волна": гребень идёт по строке и задевает соседние слова.
    // если поднимать только то слово, которое поют, поднимается ровно одно -
    // никакой волны не видно, просто дёрганье туда-сюда
    if (th === 'wave') {
      const c = w.at + w.len / 2;            // середина слова в символах
      const dd = (target - c) / 7;           // семь символов - половина ширины гребня
      const lift = p >= 0.999 || Math.abs(dd) >= 1 ? 0 : Math.cos(dd * Math.PI / 2);
      w.node.style.setProperty('--lift', lift.toFixed(3));
    }
  }

  // "слово": на экране только то, которое поют прямо сейчас
  if (th === 'word') {
    const node = now >= 0 ? words[now].node : null;
    if (node !== LY.nowWord) {
      if (LY.nowWord) LY.nowWord.classList.remove('now');
      if (node) node.classList.add('now');
      LY.nowWord = node;
    }
  } else if (LY.nowWord) {
    LY.nowWord.classList.remove('now');
    LY.nowWord = null;
  }
}

function tickLyrics() {
  if (LY.plain || !LY.lines.length) return;
  const t = curTime() + (Number(S.cfg.lyricsOffset) || 0);

  let i = -1;
  for (let k = 0; k < LY.lines.length; k++) {
    if (LY.lines[k].t <= t) i = k; else break;
  }

  if (i !== LY.cur) {
    if (LY.items[LY.cur]) LY.items[LY.cur].classList.remove('on');
    LY.cur = i;
    for (let k = 0; k < LY.items.length; k++) {
      const d = Math.min(7, Math.abs(k - i));
      const st = LY.items[k].style;
      st.setProperty('--d', d);
      // спетое и предстоящее ведут себя по-разному: "эхо" уносит прошлое
      // в сторону, а будущее оставляет на месте. одного расстояния тут мало
      st.setProperty('--past', k < i ? d : 0);
      st.setProperty('--soon', k > i ? d : 0);
    }
    if (LY.items[i]) LY.items[i].classList.add('on');
    centerLyrics(i);
  }
  fillLine(t, i);
}

// строчка под текстом делает два разных дела, и выглядеть они должны по-разному:
// say - это сообщение, его надо заметить, поэтому по центру;
// без say - подпись "откуда текст", ей место тихо в углу
function lyNote(text, say) {
  const n = $('ly-note');
  n.textContent = text || '';
  n.className = 'ly-note' + (say ? ' say' : '');
}

let lyGen = 0;
async function loadLyrics(t) {
  const gen = ++lyGen;
  LY.lines = []; LY.items = []; LY.cur = -2; LY.plain = false; LY.nowWord = null;
  $('ly-track').textContent = '';
  $('ly-track').style.transform = '';
  lyClasses();
  lyNote('');
  if (!S.cfg.lyrics || !t) return;

  lyNote('ищу текст…', true);
  const r = await window.api.lyrics.get({
    artist: t.artist, title: t.title, album: t.album, duration: t.duration, path: t.path
  });
  if (gen !== lyGen) return;          // пока искали, трек сменился

  if (!r || !r.lines?.length) { lyNote('текста нет', true); return; }

  buildLyrics(r);
  lyNote((r.synced ? '' : 'текст без тайм-кодов · ') + (r.source || ''));
}

/* ===================== библиотека ===================== */
const ROW_H = 52;

/* ---- избранное и плейлисты ---- */
const isFav = id => (S.cfg.favorites || []).includes(id);
const playlistById = id => (S.cfg.playlists || []).find(p => p.id === id);

function toggleFav(id) {
  const f = new Set(S.cfg.favorites || []);
  f.has(id) ? f.delete(id) : f.add(id);
  S.cfg.favorites = [...f];
  window.api.settings.set({ favorites: S.cfg.favorites });
  renderChips();
  renderRows();
}

// "1 трек", "2 трека", "5 треков"
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  return b === 1 ? one : many;
}

// обложка плейлиста: своя, если поставили, иначе от первого трека внутри
function plCover(p) {
  if (!p) return '';
  const own = String(p.cover || '').trim();
  if (own) return /^https:\/\//i.test(own) ? cssUrl(own) : window.api.file(own);
  const first = (p.tracks || [])[0];
  if (!first) return '';
  const t = S.tracks.find(x => x.id === first);
  return t ? coverUrl(t) : '';
}

/* ---- моя волна ---- */
// бесконечная подборка из твоей же библиотеки. сервера тут нет, поэтому
// "похожесть" взять неоткуда - зато есть то, что честно посчитано на месте:
// что ты дослушивал, что отметил любимым и когда включал в последний раз

const WAVE_NAMES = { usual: 'Обычная', fav: 'Любимое', rare: 'Забытое', artist: 'По артисту' };

function wave() {
  const w = (S.cfg.wave = S.cfg.wave || {});
  w.mode = WAVE_NAMES[w.mode] ? w.mode : 'usual';
  return w;
}

function waveScore(t, mode, s, now, artist) {
  const plays = s.plays[t.id] || 0;
  const last = s.last[t.id] || 0;
  const days = last ? (now - last) / 86400000 : 999;
  const fav = (S.cfg.favorites || []).includes(t.id) ? 1 : 0;
  let sc;

  if (mode === 'fav') {
    sc = 0.4 + fav * 6 + Math.min(plays, 12) * 0.7;
  } else if (mode === 'rare') {
    // чем меньше слушал и чем давнее - тем выше шанс
    sc = 0.4 + (plays ? 5 / (plays + 1) : 6) + Math.min(days, 200) / 45;
  } else if (mode === 'artist') {
    const same = artist && (t.artist || '').trim().toLowerCase() === artist;
    sc = 0.3 + (same ? 8 : 0.6) + fav * 1.2;
  } else {
    // привычное вперемешку с подзабытым - чтобы не было ни скуки, ни каши.
    // бонус "давно не включал" даём только тому, что вообще включали:
    // иначе его получают все нетронутые треки, а их всегда большинство,
    // и "Обычная" превращается во второе "Забытое"
    const known = plays > 0 || last > 0;
    sc = 1 + fav * 2.5 + Math.min(plays, 8) * 0.5
       + (known ? Math.min(days, 90) / 45 : 0.6);
  }

  // только что игравшее не подсовываем снова
  if (days < 0.03) sc *= 0.04;
  return Math.max(0.01, sc);
}

// взвешенный выбор без повторов: чем больше вес, тем чаще выпадает
function wavePick(n, mode, avoid) {
  const s = stats(), now = Date.now();
  const skip = new Set(avoid || []);
  const artist = mode === 'artist'
    ? ((S.track && S.track.artist) || '').trim().toLowerCase() : '';

  const pool = S.tracks.filter(t => !skip.has(t.id));
  if (!pool.length) return [];

  const weights = pool.map(t => waveScore(t, mode, s, now, artist));
  const out = [];

  for (let k = 0; k < n && pool.length; k++) {
    let sum = 0;
    for (const w of weights) sum += w;
    let r = Math.random() * sum, i = 0;
    while (i < pool.length - 1 && (r -= weights[i]) > 0) i++;
    out.push(pool[i].id);
    pool.splice(i, 1);
    weights.splice(i, 1);
  }
  return out;
}

function startWave(mode) {
  const w = wave();
  if (mode) w.mode = mode;
  const ids = wavePick(40, w.mode, []);
  if (!ids.length) { toast('В библиотеке нечего играть'); return; }

  w.on = true;
  window.api.settings.set({ wave: { mode: w.mode, on: true } });

  setQueue(ids);
  S.pos = 0;
  const t = S.tracks.find(x => x.id === ids[0]);
  if (t) play(t, false);

  renderChips();
  renderPlHead();
  toast('Моя волна: ' + WAVE_NAMES[w.mode].toLowerCase());
}

function stopWave() {
  wave().on = false;
  window.api.settings.set({ wave: { on: false } });
  renderChips();
  renderPlHead();
}

// очередь не должна кончаться: как только впереди мало - досыпаем.
// добавляем и в queue, и в order руками, чтобы не пересобирать порядок
// целиком - иначе на каждом пополнении всё бы перетасовывалось заново
function waveTopUp() {
  const w = S.cfg.wave || {};
  if (!w.on || S.source !== 'local') return;
  if (S.order.length - S.pos > 5) return;

  const ids = wavePick(20, w.mode, S.queue.slice(-80));
  if (!ids.length) return;
  for (const id of ids) {
    S.order.push(S.queue.length);
    S.queue.push(id);
  }
  renderQueue();
}

// шапка показывает либо волну, либо открытый плейлист.
// у "Всех" и "Любимых" её нет - там показывать нечего
function renderPlHead() {
  const head = $('pl-head');
  if (!head) return;

  const w = S.cfg.wave || {};
  const p = (S.cfg.playlists || []).find(x => x.id === S.cfg.libTab);

  head.hidden = !w.on && !p;
  if (head.hidden) return;

  const onWave = !!w.on;
  $('wave-mode').hidden = !onWave;
  $('wave-off').hidden = !onWave;
  $('pl-pic').hidden = onWave || !p;
  $('pl-pic-x').hidden = onWave || !p || !p.cover;

  if (onWave) {
    const box = $('pl-cover');
    box.style.backgroundImage = '';
    box.classList.remove('has');
    box.firstElementChild.textContent = '✦';
    $('pl-name').textContent = 'Моя волна';
    $('pl-sub').textContent = 'собрана из твоей библиотеки · ' + (S.order.length - S.pos)
      + ' впереди';
    for (const b of $('wave-mode').querySelectorAll('button')) {
      b.classList.toggle('on', b.dataset.v === (w.mode || 'usual'));
    }
    return;
  }

  const c = plCover(p), box = $('pl-cover');
  box.firstElementChild.textContent = '♫';
  box.style.backgroundImage = c ? `url("${c}")` : '';
  box.classList.toggle('has', !!c);

  $('pl-name').textContent = p.name;
  const n = p.tracks.length;
  $('pl-sub').textContent = n + ' ' + plural(n, 'трек', 'трека', 'треков')
    + (p.cover ? ' · своя обложка' : c ? ' · обложка от первого трека' : '');
}

function wirePlHead() {
  const cur = () => (S.cfg.playlists || []).find(x => x.id === S.cfg.libTab);
  const save = () => {
    window.api.settings.set({ playlists: S.cfg.playlists });
    renderChips();
    renderPlHead();
  };
  $('pl-pic').onclick = async () => {
    const p = cur();
    if (!p) return;
    const f = await window.api.profile.pick('pl', p.id);
    if (!f) return;
    p.cover = f;
    save();
  };
  $('pl-pic-x').onclick = () => {
    const p = cur();
    if (!p) return;
    p.cover = '';
    save();
  };

  for (const b of $('wave-mode').querySelectorAll('button')) {
    // смена характера пересобирает подборку заново, с текущего места
    b.onclick = () => startWave(b.dataset.v);
  }
  $('wave-off').onclick = stopWave;

  renderPlHead();
}

function newPlaylist(name, firstTrack) {
  const p = {
    id: 'p' + Date.now().toString(36),
    name: (name || '').trim() || 'Новый плейлист',
    cover: '',
    tracks: firstTrack ? [firstTrack] : []
  };
  S.cfg.playlists = [...(S.cfg.playlists || []), p];
  window.api.settings.set({ playlists: S.cfg.playlists });
  renderChips();
  return p;
}

function togglePlaylist(p, id) {
  p.tracks = p.tracks.includes(id) ? p.tracks.filter(x => x !== id) : [...p.tracks, id];
  window.api.settings.set({ playlists: S.cfg.playlists });
  renderChips();
  renderRows();
}

function deletePlaylist(p) {
  S.cfg.playlists = (S.cfg.playlists || []).filter(x => x.id !== p.id);
  if (S.cfg.libTab === p.id) S.cfg.libTab = 'all';
  window.api.settings.set({ playlists: S.cfg.playlists, libTab: S.cfg.libTab });
  renderChips();
  renderRows();
  toast('Плейлист удалён');
}

/* ---- что показывать в списке ---- */
function currentList() {
  const tab = S.cfg.libTab || 'all';
  if (tab === 'fav') {
    const fav = new Set(S.cfg.favorites || []);
    return S.tracks.filter(t => fav.has(t.id));
  }
  const p = playlistById(tab);
  // в плейлисте важен свой порядок, сортировку не применяем
  if (p) return p.tracks.map(id => S.tracks.find(t => t.id === id)).filter(Boolean);
  return S.tracks;
}

function sortList(list) {
  if (playlistById(S.cfg.libTab)) return list;
  const c = (a, b) => (a || '').localeCompare(b || '', 'ru');
  const s = list.slice();
  switch (S.cfg.libSort) {
    case 'title':    s.sort((a, b) => c(a.title, b.title)); break;
    case 'album':    s.sort((a, b) => c(a.album, b.album) || (a.track || 0) - (b.track || 0) || c(a.title, b.title)); break;
    case 'added':    s.sort((a, b) => (b.added || 0) - (a.added || 0)); break;
    case 'duration': s.sort((a, b) => (a.duration || 0) - (b.duration || 0)); break;
    default:         s.sort((a, b) => c(a.artist, b.artist) || c(a.album, b.album) ||
                                      (a.track || 0) - (b.track || 0) || c(a.title, b.title));
  }
  return s;
}

function visibleTracks() {
  let list = sortList(currentList());
  const q = S.filter.trim().toLowerCase();
  if (q) {
    const words = q.split(/\s+/);
    list = list.filter(t => {
      const hay = (t.title + ' ' + t.artist + ' ' + t.album).toLowerCase();
      return words.every(w => hay.includes(w));
    });
  }
  return list;
}

/* ---- вкладки над списком ---- */
function renderChips() {
  const box = $('lib-chips');
  box.textContent = '';
  const tab = S.cfg.libTab || 'all';

  const mk = (id, label, count) => {
    const b = el('button', 'chip' + (tab === id ? ' on' : ''));
    b.append(document.createTextNode(label));
    if (count != null) { const e = el('em'); e.textContent = count; b.appendChild(e); }
    b.onclick = () => {
      S.cfg.libTab = id;
      window.api.settings.set({ libTab: id });
      $('lib-scroll').scrollTop = 0;
      renderChips();
      renderRows();
      renderPlHead();
    };
    box.appendChild(b);
    return b;
  };

  // волна не вкладка, а действие: жмёшь - и она начинает играть
  const wv = el('button', 'chip chip-wave' + ((S.cfg.wave || {}).on ? ' on' : ''));
  wv.append(document.createTextNode('✦ Моя волна'));
  wv.title = 'бесконечная подборка из твоей библиотеки';
  wv.onclick = () => startWave();
  box.appendChild(wv);

  mk('all', 'Все', S.tracks.length);
  mk('fav', '♥ Любимые', (S.cfg.favorites || []).length);

  for (const p of S.cfg.playlists || []) {
    const b = mk(p.id, p.name, p.tracks.length);
    b.title = 'двойной клик — переименовать';
    const th = plCover(p);
    if (th) {
      const i = el('div', 'chip-ava');
      i.style.backgroundImage = `url("${th}")`;
      b.prepend(i);
    }
    b.ondblclick = () => chipInput(b, p.name, v => {
      p.name = (v || '').trim() || p.name;
      window.api.settings.set({ playlists: S.cfg.playlists });
      renderChips();
    });
    const x = el('button', 'chip-x');
    x.textContent = '✕';
    x.title = 'удалить плейлист';
    x.onclick = ev => { ev.stopPropagation(); deletePlaylist(p); };
    b.appendChild(x);
  }

  const add = el('button', 'chip chip-add');
  add.textContent = '+ плейлист';
  add.onclick = () => chipInput(add, '', v => {
    const p = newPlaylist(v);
    S.cfg.libTab = p.id;
    window.api.settings.set({ libTab: p.id });
    renderChips();
    renderRows();
  });
  box.appendChild(add);
}

// prompt() в electron не работает, поэтому имя вводим прямо в чипе
function chipInput(node, value, done) {
  const inp = el('input', 'chip');
  inp.value = value || '';
  inp.style.width = '150px';
  inp.placeholder = 'название';
  node.replaceWith(inp);
  inp.focus();
  inp.select();

  let closed = false;
  const fin = ok => {
    if (closed) return;
    closed = true;
    const v = inp.value;
    renderChips();
    if (ok) done(v);
  };
  inp.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Enter') fin(true);
    else if (e.key === 'Escape') fin(false);
  };
  inp.onblur = () => fin(false);
}

/* ---- меню "в плейлист" ---- */
function openPlMenu(btn, t) {
  const m = $('pl-menu');
  m.textContent = '';

  for (const p of S.cfg.playlists || []) {
    const has = p.tracks.includes(t.id);
    const b = el('button', has ? 'in' : '');
    const i = el('i'); i.textContent = has ? '✓' : '';
    const s = el('span'); s.textContent = p.name;
    b.append(i, s);
    b.onclick = () => { togglePlaylist(p, t.id); openPlMenu(btn, t); };
    m.appendChild(b);
  }
  if ((S.cfg.playlists || []).length) m.appendChild(el('hr'));

  const nb = el('button');
  const ni = el('i'); ni.textContent = '+';
  const ns = el('span'); ns.textContent = 'Новый плейлист';
  nb.append(ni, ns);
  nb.onclick = () => {
    show(m, false);
    const p = newPlaylist('Плейлист ' + ((S.cfg.playlists || []).length + 1), t.id);
    toast(`Создал «${p.name}» и добавил трек`);
    renderRows();
  };
  m.append(nb);

  show(m, true);
  const r = btn.getBoundingClientRect();
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
  m.style.top = (r.bottom + h + 8 > innerHeight ? r.top - h - 6 : r.bottom + 6) + 'px';
}

addEventListener('click', e => {
  if (!e.target.closest('.pl-menu') && !e.target.closest('.act-pl')) show($('pl-menu'), false);
});

let rowCache = [];
function renderRows() {
  const list = visibleTracks();
  const scroll = $('lib-scroll'), rows = $('lib-rows');

  $('lib-empty').hidden = S.tracks.length > 0;
  $('lib-pad').style.height = (list.length * ROW_H + 12) + 'px';
  $('lib-info').textContent =
    !S.tracks.length ? ''
    : S.filter ? `${list.length} из ${S.tracks.length}`
    : !list.length ? (S.cfg.libTab === 'fav' ? 'любимых пока нет' : 'в этом плейлисте пусто')
    : `${list.length} треков`;

  const top = scroll.scrollTop;
  const from = Math.max(0, Math.floor(top / ROW_H) - 6);
  const to = Math.min(list.length, Math.ceil((top + scroll.clientHeight) / ROW_H) + 6);

  const need = to - from;
  while (rowCache.length < need) {
    const r = el('div', 'row');
    r.innerHTML = `<div class="row-n"></div>
      <div class="row-bars"><i></i><i></i><i></i></div>
      <div class="row-art"><span>♫</span></div>
      <div class="row-meta"><div class="row-t"></div><div class="row-a"></div></div>
      <div class="row-al"></div>
      <button class="row-act act-fav" title="в любимые">
        <svg viewBox="0 0 24 24"><path d="M12 20.3 10.6 19C5.4 14.4 2 11.3 2 7.6 2 4.6 4.4 2.2 7.4 2.2c1.7 0 3.4.8 4.6 2.1 1.2-1.3 2.9-2.1 4.6-2.1 3 0 5.4 2.4 5.4 5.4 0 3.7-3.4 6.8-8.6 11.4z" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>
      </button>
      <button class="row-act act-pl" title="в плейлист">
        <svg viewBox="0 0 24 24"><path d="M3 6h12v2H3zm0 5h12v2H3zm0 5h8v2H3zm14-5h2v3h3v2h-3v3h-2v-3h-3v-2h3z"/></svg>
      </button>
      <div class="row-d"></div>`;
    rows.appendChild(r);
    rowCache.push(r);
  }

  rowCache.forEach((r, k) => {
    const i = from + k;
    if (i >= to) { r.style.display = 'none'; return; }
    const t = list[i];
    r.style.display = '';
    r.style.top = (i * ROW_H + 6) + 'px';
    r.dataset.id = t.id;
    r.classList.toggle('on', S.track?.id === t.id);
    r.querySelector('.row-n').textContent = i + 1;
    r.querySelector('.row-t').textContent = t.title;
    r.querySelector('.row-a').textContent = t.artist || '—';
    r.querySelector('.row-al').textContent = t.album || '';
    r.querySelector('.row-d').textContent = t.duration ? fmt(t.duration) : '';
    r.querySelector('.act-fav').classList.toggle('fav', isFav(t.id));

    const art = r.querySelector('.row-art');
    let img = art.querySelector('img');
    if (t.cover) {
      if (!img) { img = el('img'); img.loading = 'lazy'; art.appendChild(img); }
      const u = window.api.file(t.cover);
      if (img.dataset.u !== u) { img.dataset.u = u; img.src = u; }
      img.style.display = '';
    } else if (img) { img.style.display = 'none'; img.dataset.u = ''; }
  });
}

$('lib-scroll').addEventListener('scroll', () => renderRows(), { passive: true });

$('lib-rows').addEventListener('click', e => {
  const row = e.target.closest('.row');
  if (!row) return;
  const t = S.tracks.find(x => x.id === row.dataset.id);
  if (!t) return;

  if (e.target.closest('.act-fav')) { toggleFav(t.id); return; }
  if (e.target.closest('.act-pl'))  { openPlMenu(e.target.closest('.act-pl'), t); return; }

  if (S.track?.id === t.id) { toggle(); return; }   // повторный клик - пауза
  setQueue(visibleTracks().map(x => x.id));
  play(t);
});

$('lib-rows').addEventListener('contextmenu', e => {
  const row = e.target.closest('.row');
  if (!row) return;
  const t = S.tracks.find(x => x.id === row.dataset.id);
  if (t) { window.api.lib.reveal(t.path); toast('Показываю файл в проводнике'); }
});

function renderQueue() {
  const box = $('queue');
  box.textContent = '';
  $('q-count').textContent = S.order.length || '0';
  const from = Math.max(0, S.pos - 1);
  S.order.slice(from, from + 40).forEach((qi, k) => {
    const t = S.tracks.find(x => x.id === S.queue[qi]);
    if (!t) return;
    const i = from + k;
    const d = el('div', 'q-i' + (i === S.pos ? ' on' : ''));
    d.innerHTML = `<span class="q-n">${i + 1}</span><span class="q-t"></span>`;
    d.querySelector('.q-t').textContent = t.artist ? `${t.artist} — ${t.title}` : t.title;
    d.onclick = () => { S.pos = i; play(t, false); };
    box.appendChild(d);
  });
}

async function loadLibrary() {
  S.tracks = await window.api.lib.list();
  renderRows();
  if (S.tracks.length) {
    setQueue(S.tracks.map(t => t.id));
    const last = S.tracks.find(t => t.id === S.cfg.lastTrack);
    if (last) {
      S.track = last;
      S.pos = S.order.indexOf(S.queue.indexOf(last.id));
      audio.src = window.api.file(last.path);
      audio.volume = S.cfg.volume;
      audio.playbackRate = S.cfg.rate || 1;
      applyPitch();
      paintTrack(last);
      loadLyrics(last);
      renderRows();
      renderQueue();
    }
  }
}

async function scan() {
  if (!S.cfg.folders.length) { toast('Сначала добавь папку с музыкой'); return go('settings'); }
  $('rescan').disabled = true;
  const t = await window.api.lib.scan();
  S.tracks = t;
  $('rescan').disabled = false;
  setQueue(visibleTracks().map(x => x.id));
  renderRows();
  toast(t.length ? `Нашёл ${t.length} треков` : 'В этих папках музыки нет');
}

window.api.lib.onArtwork(({ id, cover }) => {
  const t = S.tracks.find(x => x.id === id);
  if (!t) return;
  t.cover = cover;
  renderRows();
  if (S.track?.id === id) paintTrack(t);
});
window.api.lib.onArtworkDone(n => { if (n) toast(`Нашёл обложек: ${n}`); });

window.api.lib.onProgress(p => {
  const box = $('scan');
  if (!p) { box.hidden = true; return; }
  box.hidden = false;
  $('scan-txt').textContent = p.total ? `${p.done} из ${p.total} · ${p.title}` : p.title;
  $('scan-fill').style.width = p.total ? (p.done / p.total * 100) + '%' : '0%';
});

/* ===================== плееры сервисов ===================== */
// звук идёт внутри их встроенного плеера, мы только командуем.
// поэтому спектра у нас нет - эквалайзер и визуализация на таких треках молчат.
const STREAM = {
  kind: null, item: null,
  pos: 0, dur: 0, playing: false,
  yt: null, sc: null,
  queue: [], at: -1, poll: null
};

const curTime = () => S.source === 'local' ? (audio.currentTime || 0) : STREAM.pos;
const curDur  = () => S.source === 'local'
  ? (audio.duration || S.track?.duration || 0)
  : (STREAM.dur || STREAM.item?.duration || 0);
const isPlaying = () => S.source === 'local' ? !audio.paused : STREAM.playing;

function loadScript(src) {
  return new Promise((ok, no) => {
    if ([...document.scripts].some(s => s.src === src)) return ok();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => ok();
    s.onerror = () => no(new Error(src));
    document.head.appendChild(s);
  });
}

async function ytApi() {
  if (window.YT && YT.Player) return true;
  try { await loadScript('https://www.youtube.com/iframe_api'); } catch { return false; }
  return new Promise(ok => {
    const t = setInterval(() => { if (window.YT && YT.Player) { clearInterval(t); ok(true); } }, 80);
    setTimeout(() => { clearInterval(t); ok(!!(window.YT && window.YT.Player)); }, 9000);
  });
}

async function scApi() {
  if (window.SC) return true;
  try { await loadScript('https://w.soundcloud.com/player/api.js'); } catch { return false; }
  return !!window.SC;
}

function showStream(kind) {
  $('stream').hidden = false;
  $('stream-src').textContent = kind === 'yt' ? 'YouTube' : 'SoundCloud';
  show($('yt-box'), kind === 'yt');
  show($('sc-frame'), kind === 'sc');
}

async function streamPlay(item, queue) {
  if (!item) return;
  if (queue) { STREAM.queue = queue; STREAM.at = queue.findIndex(x => x.id === item.id); }

  audio.pause();
  stopPreview();
  S.source = item.src;
  STREAM.kind = item.src;
  STREAM.item = item;
  STREAM.pos = 0;
  STREAM.dur = item.duration || 0;
  STREAM.playing = false;

  paintStreamTrack(item);
  showStream(item.src);
  startStreamPoll();

  if (item.src === 'yt') await ytPlay(item);
  else await scPlay(item);
}

async function ytPlay(item) {
  if (!await ytApi()) { toast('YouTube не загрузился'); return; }

  if (!STREAM.yt) {
    await new Promise(ok => {
      let done = false;
      const fin = () => { if (!done) { done = true; ok(); } };
      STREAM.yt = new YT.Player('yt-box', {
        width: 300, height: 169,
        playerVars: { origin: location.origin, playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: fin,
          onStateChange: e => {
            STREAM.playing = e.data === 1;
            const d = STREAM.yt.getDuration && STREAM.yt.getDuration();
            if (d) STREAM.dur = Math.round(d);
            paintPlay();
            if (e.data === 0) streamStep(1);
          },
          onError: () => toast('YouTube не отдал этот трек')
        }
      });
      setTimeout(fin, 9000);
    });
  }

  try {
    STREAM.yt.loadVideoById(item.id);
    STREAM.yt.setVolume(Math.round((audio.muted ? 0 : S.cfg.volume) * 100));
  } catch { toast('Не получилось запустить'); }
}

async function scPlay(item) {
  if (!await scApi()) { toast('SoundCloud не загрузился'); return; }

  const f = $('sc-frame');
  f.src = 'https://w.soundcloud.com/player/?auto_play=true&show_comments=false'
        + '&sharing=false&buying=false&download=false&url=' + encodeURIComponent(item.url);

  STREAM.sc = SC.Widget(f);
  const w = STREAM.sc;
  w.bind(SC.Widget.Events.READY, () => {
    w.setVolume(Math.round((audio.muted ? 0 : S.cfg.volume) * 100));
    w.getCurrentSound(s => {
      if (!s || STREAM.item !== item) return;
      STREAM.dur = Math.round((s.duration || 0) / 1000);
      if (s.title) item.title = s.title;
      if (s.user && s.user.username) item.artist = s.user.username;
      if (s.artwork_url) item.cover = s.artwork_url.replace('-large', '-t500x500');
      item.duration = STREAM.dur;
      paintStreamTrack(item);
    });
  });
  w.bind(SC.Widget.Events.PLAY,  () => { STREAM.playing = true;  paintPlay(); });
  w.bind(SC.Widget.Events.PAUSE, () => { STREAM.playing = false; paintPlay(); });
  w.bind(SC.Widget.Events.FINISH, () => streamStep(1));
  w.bind(SC.Widget.Events.PLAY_PROGRESS, d => { STREAM.pos = (d.currentPosition || 0) / 1000; });
}

function startStreamPoll() {
  clearInterval(STREAM.poll);
  STREAM.poll = setInterval(() => {
    if (S.source === 'local') return;
    if (S.source === 'yt' && STREAM.yt && STREAM.yt.getCurrentTime) {
      STREAM.pos = STREAM.yt.getCurrentTime() || 0;
      const d = STREAM.yt.getDuration && STREAM.yt.getDuration();
      if (d) STREAM.dur = Math.round(d);
    }
    paintProgress();
    report();
  }, 300);
}

function streamToggle() {
  if (S.source === 'yt' && STREAM.yt) {
    STREAM.playing ? STREAM.yt.pauseVideo() : STREAM.yt.playVideo();
  } else if (S.source === 'sc' && STREAM.sc) {
    STREAM.playing ? STREAM.sc.pause() : STREAM.sc.play();
  }
}

function streamSeek(sec) {
  if (S.source === 'yt' && STREAM.yt) STREAM.yt.seekTo(sec, true);
  else if (S.source === 'sc' && STREAM.sc) STREAM.sc.seekTo(sec * 1000);
  STREAM.pos = sec;
}

function streamVolume(v) {
  const p = Math.round(v * 100);
  try { STREAM.yt && STREAM.yt.setVolume && STREAM.yt.setVolume(p); } catch {}
  try { STREAM.sc && STREAM.sc.setVolume && STREAM.sc.setVolume(p); } catch {}
}

function streamStep(dir) {
  const q = STREAM.queue;
  if (!q.length) { stopStream(); return; }
  let at = STREAM.at + dir;
  if (at < 0) at = 0;
  if (at >= q.length) { stopStream(); return; }
  STREAM.at = at;
  streamPlay(q[at]);
}

function stopStream() {
  try { STREAM.yt && STREAM.yt.stopVideo && STREAM.yt.stopVideo(); } catch {}
  try { STREAM.sc && STREAM.sc.pause && STREAM.sc.pause(); } catch {}
  $('sc-frame').removeAttribute('src');
  clearInterval(STREAM.poll);
  STREAM.poll = null;
  STREAM.kind = null; STREAM.item = null;
  STREAM.playing = false; STREAM.pos = 0; STREAM.dur = 0;
  S.source = 'local';
  $('stream').hidden = true;
  if (S.track) paintTrack(S.track);
  paintPlay();
  paintProgress();
}

function paintStreamTrack(it) {
  S.track = null;
  $('now-title').textContent = it.title;
  $('now-artist').textContent = it.artist || '';
  $('bar-title').textContent = it.title;
  $('bar-artist').textContent = it.artist || '';
  const tag = $('now-src');
  tag.hidden = false;
  tag.textContent = it.src === 'yt' ? 'youtube' : 'soundcloud';
  document.title = (it.artist ? it.artist + ' — ' : '') + it.title;

  for (const img of [$('now-art'), $('bar-img')]) {
    if (it.cover) { img.src = it.cover; img.classList.add('on'); }
    else { img.removeAttribute('src'); img.classList.remove('on'); }
  }
  applyBg(it.cover);
  accentFrom(it.cover);
  loadLyrics({ artist: it.artist, title: it.title, album: '', duration: it.duration, path: '' });
  renderRows();
}

$('stream-close').onclick = () => stopStream();

/* ===================== поиск по каталогам ===================== */
const prev = $('prev');
let sqResults = [], sqPlaying = null, sqTimer = null;
const sqCards = new Map();

const sNorm = s => String(s || '').toLowerCase().replace(/ё/g, 'е')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// такой трек уже есть в библиотеке?
function haveLocally(r) {
  const k = sNorm(r.artist) + '|' + sNorm(r.title);
  return S.tracks.some(t => sNorm(t.artist) + '|' + sNorm(t.title) === k);
}

function goLinks(r) {
  const q = encodeURIComponent([r.artist, r.title].filter(Boolean).join(' '));
  return [
    ['Яндекс',  'https://music.yandex.ru/search?text=' + q],
    ['VK',      'https://vk.com/audio?q=' + q],
    ['YouTube', 'https://www.youtube.com/results?search_query=' + q]
  ];
}

let sqMode = 'catalog';
const DL = { ok: false, folder: '', version: '', busy: '' };

// отмеченные галочкой результаты - их можно скачать одной кнопкой
const sqSel = new Set();
const canGrab = r => (r.src === 'yt' || r.src === 'sc') && DL.ok && !!r.url && !haveLocally(r);

function renderSelBar() {
  const n = sqSel.size;
  $('sq-sel').hidden = n === 0;
  if (n) {
    const word = n % 10 === 1 && n % 100 !== 11 ? 'трек'
               : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 'трека' : 'треков';
    $('sq-sel-n').textContent = `Выбрано ${n} ${word}`;
  }
}

const TICK = '<svg viewBox="0 0 24 24"><path d="M9.2 16.4 4.8 12l1.4-1.4 3 3 7.6-7.6L18.2 7z"/></svg>';

function togglePick(r, force) {
  const on = force !== undefined ? force : !sqSel.has(r.id);
  if (on) sqSel.add(r.id); else sqSel.delete(r.id);

  const c = sqCards.get(r.id);
  if (c && c.pick) {
    c.pick.classList.toggle('on', on);
    c.card.classList.toggle('picked', on);
  }
  renderSelBar();
}

function renderSearch() {
  const box = $('sq-list');
  box.textContent = '';
  sqCards.clear();
  $('sq-empty').hidden = sqResults.length > 0;

  // выделение живёт только пока показаны те же результаты
  const alive = new Set(sqResults.map(r => r.id));
  for (const id of [...sqSel]) if (!alive.has(id)) sqSel.delete(id);

  for (const r of sqResults) {
    const c = el('div', 'sq-i');
    const stream = r.src === 'yt' || r.src === 'sc';

    let pick = null;
    if (canGrab(r)) {
      pick = el('button', 'sq-pick');
      pick.title = 'отметить для скачивания';
      pick.innerHTML = TICK;
      pick.onclick = e => { e.stopPropagation(); togglePick(r); };
      if (sqSel.has(r.id)) { pick.classList.add('on'); c.classList.add('picked'); }
      c.appendChild(pick);
    }

    const art = el('div', 'sq-art');
    if (r.cover) { const i = el('img'); i.loading = 'lazy'; i.src = r.cover; art.appendChild(i); }
    else art.textContent = '♫';

    const m = el('div', 'sq-m');
    const t = el('div', 'sq-t'); t.textContent = r.title;
    const a = el('div', 'sq-a'); a.textContent = r.artist || 'неизвестный исполнитель';
    const s = el('div', 'sq-s');
    const bits = [r.album, r.year || null, r.duration ? fmt(r.duration) : null].filter(Boolean);
    s.append(document.createTextNode(bits.join(' · ')));
    if (haveLocally(r)) { const h = el('span', 'sq-have'); h.textContent = 'есть у тебя'; s.appendChild(h); }
    m.append(t, a, s);

    const play = el('button', 'cbtn sq-prev');
    if (stream) {
      play.title = 'слушать целиком';
      play.onclick = () => streamPlay(r, sqResults.filter(x => x.src === r.src));
    } else {
      play.title = r.preview ? 'послушать 30 секунд' : 'отрывка нет';
      play.disabled = !r.preview;
      play.onclick = () => playPreview(r);
    }

    let dl = null;
    if (canGrab(r)) {
      dl = el('button', 'cbtn sq-prev sq-dl');
      dl.title = 'скачать к себе';
      dl.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3v10.2l3.6-3.6 1.4 1.4-6 6-6-6 1.4-1.4 3.6 3.6V3zM4 19h16v2H4z"/></svg>';
      dl.onclick = () => downloadTrack(r);
    }

    const go = el('div', 'sq-go');
    const links = stream
      ? [[r.src === 'yt' ? 'YouTube' : 'SoundCloud', r.url]]
      : goLinks(r);
    for (const [name, url] of links) {
      const link = el('a');
      link.textContent = name;
      link.href = '#';
      link.title = 'открыть в браузере';
      link.onclick = e => { e.preventDefault(); window.api.openExternal(url); };
      go.appendChild(link);
    }

    c.append(art, m, play);
    if (dl) c.appendChild(dl);
    c.appendChild(go);
    box.appendChild(c);
    sqCards.set(r.id, { card: c, play, pick });
  }
  renderSelBar();
  paintPreview();
}

/* ---------- очередь скачивания ---------- */

async function downloadTrack(item) {
  const res = await window.api.dl.add([item]);
  if (res.error) { toast('Не скачалось: ' + res.error); return; }
  if (!res.added) { toast('Уже в очереди'); return; }
  toast('В очередь: ' + (item.artist ? item.artist + ' — ' : '') + item.title);
}

async function downloadSelected() {
  const list = sqResults.filter(r => sqSel.has(r.id));
  if (!list.length) return;

  const res = await window.api.dl.add(list);
  if (res.error) { toast('Не скачалось: ' + res.error); return; }

  sqSel.clear();
  renderSearch();
  toast(res.added
    ? `В очереди ${res.added}` + (res.skipped ? `, пропущено ${res.skipped}` : '')
    : 'Всё это уже в очереди');
}

$('sq-sel-all').onclick = () => {
  for (const r of sqResults) if (canGrab(r)) sqSel.add(r.id);
  renderSearch();
};
$('sq-sel-none').onclick = () => { sqSel.clear(); renderSearch(); };
$('sq-sel-dl').onclick = () => downloadSelected();

const DLQ = { items: [], folded: false, paused: false, sign: '', rows: new Map() };

const QIC = {
  wait:   '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16m-1 3v6l5 3 .8-1.4-4.3-2.5V7z"/></svg>',
  go:     '<svg viewBox="0 0 24 24"><path d="M12 3v10.2l3.6-3.6 1.4 1.4-6 6-6-6 1.4-1.4 3.6 3.6V3zM4 19h16v2H4z"/></svg>',
  ok:     '<svg viewBox="0 0 24 24"><path d="M9.2 16.4 4.8 12l1.4-1.4 3 3 7.6-7.6L18.2 7z"/></svg>',
  err:    '<svg viewBox="0 0 24 24"><path d="M11 7h2v7h-2zm0 9h2v2h-2zM12 2 1 21h22z"/></svg>',
  cancel: '<svg viewBox="0 0 24 24"><path d="m12 10.6 5-5 1.4 1.4-5 5 5 5-1.4 1.4-5-5-5 5L5.6 17l5-5-5-5L7 5.6z"/></svg>'
};

function renderDlq(st) {
  DLQ.items = st.items || [];
  DLQ.paused = !!st.paused;

  const box = $('dlq');
  box.hidden = DLQ.items.length === 0;
  if (box.hidden) { DLQ.sign = ''; DLQ.rows.clear(); return; }

  box.classList.toggle('work', !!st.busy);
  box.classList.toggle('fold', DLQ.folded);
  $('dlq-pause').classList.toggle('on', DLQ.paused);
  $('dlq-pause').title = DLQ.paused ? 'продолжить' : 'пауза';

  const left = st.wait + (st.busy ? 1 : 0);
  $('dlq-title').textContent = DLQ.paused ? 'Очередь на паузе'
    : left ? `Качаю — осталось ${left}`
    : st.failed ? `Готово, ${st.failed} с ошибкой`
    : 'Всё скачано';

  const body = $('dlq-body');

  // проценты капают несколько раз в секунду; если список тот же - двигаем
  // только полоску, а не пересобираем сотню строк заново
  const sign = DLQ.items.map(i => i.key + ':' + i.state).join('|');
  if (sign === DLQ.sign) {
    for (const it of DLQ.items) {
      const node = DLQ.rows.get(it.key);
      if (!node || it.state !== 'go') continue;
      node.fill.style.width = Math.max(2, it.percent) + '%';
      node.s.textContent = Math.round(it.percent) + '%';
    }
    return;
  }
  DLQ.sign = sign;
  DLQ.rows = new Map();
  body.textContent = '';

  for (const it of DLQ.items) {
    const row = el('div', 'dlq-i ' + it.state);

    const fill = el('div', 'dlq-fill');
    if (it.state === 'go') {
      fill.style.width = Math.max(2, it.percent) + '%';
      row.appendChild(fill);
    }

    const ic = el('div', 'dlq-ic');
    ic.innerHTML = QIC[it.state] || QIC.wait;

    const m = el('div', 'dlq-m');
    const t = el('div', 'dlq-t');
    t.textContent = (it.artist ? it.artist + ' — ' : '') + it.title;
    t.title = t.textContent;
    const s = el('div', 'dlq-s');
    s.textContent =
      it.state === 'go'     ? Math.round(it.percent) + '%' :
      it.state === 'ok'     ? 'готово' :
      it.state === 'err'    ? (it.error || 'ошибка') :
      it.state === 'cancel' ? 'отменено' : 'в очереди';
    if (it.state === 'err' && it.error) s.title = it.error;
    m.append(t, s);

    row.append(ic, m);

    if (it.state === 'wait' || it.state === 'go') {
      const x = el('button', 'dlq-x');
      x.title = 'убрать из очереди';
      x.innerHTML = QIC.cancel;
      x.onclick = () => window.api.dl.cancel(it.key).then(renderDlq);
      row.appendChild(x);
    }

    DLQ.rows.set(it.key, { row, fill, s });
    body.appendChild(row);
  }

  // то, что качается прямо сейчас, держим на виду
  const go = DLQ.items.find(i => i.state === 'go');
  if (go && DLQ.rows.has(go.key)) {
    DLQ.rows.get(go.key).row.scrollIntoView({ block: 'nearest' });
  }
}

$('dlq-fold').onclick = () => {
  DLQ.folded = !DLQ.folded;
  $('dlq').classList.toggle('fold', DLQ.folded);
};
$('dlq-pause').onclick = () => window.api.dl.pause(!DLQ.paused).then(renderDlq);
$('dlq-clear').onclick = () => window.api.dl.clear('done').then(renderDlq);

window.api.dl.onQueue(renderDlq);

// трек лёг в библиотеку - обновляем списки, не дожидаясь конца очереди
window.api.dl.onAdded(p => {
  if (!p) return;
  S.tracks = p.tracks || S.tracks;
  renderChips();
  renderRows();
  renderSearch();
});

function paintPreview() {
  for (const [id, { card, play }] of sqCards) {
    const on = sqPlaying === id;
    card.classList.toggle('playing', on);
    play.innerHTML = on
      ? '<svg viewBox="0 0 24 24"><path d="M6.5 5h3.5v14H6.5zM14 5h3.5v14H14z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  }
}

function playPreview(r) {
  if (sqPlaying === r.id) { stopPreview(); return; }
  if (!r.preview) return;
  audio.pause();                       // отрывок и основной плеер вместе не играют
  prev.src = r.preview;
  prev.volume = audio.muted ? 0 : S.cfg.volume;
  prev.play().catch(() => toast('Отрывок не открылся'));
  sqPlaying = r.id;
  paintPreview();
}

function stopPreview() {
  prev.pause();
  prev.removeAttribute('src');
  sqPlaying = null;
  paintPreview();
}

prev.addEventListener('ended', () => { sqPlaying = null; paintPreview(); });
audio.addEventListener('play', () => { if (sqPlaying) stopPreview(); });

// ссылка на плейлист, альбом или сет - но не на конкретное видео из плейлиста
function isPlaylistUrl(u) {
  if (/soundcloud\.com\/[^/?#]+\/sets\//i.test(u)) return true;
  if (/[?&]v=/.test(u)) return false;
  return /[?&]list=/i.test(u) || /\/playlist\b/i.test(u) || /\/album\//i.test(u);
}

async function importPlaylist(url) {
  $('sq-info').textContent = 'читаю плейлист…';
  const r = await window.api.dl.playlist(url);

  if (r.error) {
    sqResults = [];
    $('sq-info').textContent = /yt-dlp/.test(r.error)
      ? 'для плейлистов нужен yt-dlp — смотри Настройки → Стриминг'
      : 'плейлист не открылся: ' + r.error;
    renderSearch();
    return;
  }

  sqResults = r.items || [];
  if (!sqResults.length) {
    $('sq-info').textContent = 'в плейлисте ничего не нашлось';
    renderSearch();
    return;
  }

  // всё, чего ещё нет, сразу отмечено - остаётся нажать "Скачать выбранное"
  sqSel.clear();
  for (const it of sqResults) if (canGrab(it)) sqSel.add(it.id);

  $('sq-info').textContent = (r.name ? '«' + r.name + '» — ' : '') + `${sqResults.length} треков`;
  renderSearch();
  if (!sqSel.size) toast('Все треки из плейлиста уже есть у тебя');
}

async function runSearch(q) {
  $('sq-info').textContent = 'ищу…';

  // ссылка на плейлист - разбираем его целиком
  if (/^https?:\/\//i.test(q) && isPlaylistUrl(q)) return importPlaylist(q);

  // вставленная ссылка - сразу играем, ничего не ищем
  if (/^https?:\/\//i.test(q)) {
    const it = await window.api.stream.resolve(q);
    if (!it) { $('sq-info').textContent = 'такую ссылку не понимаю'; sqResults = []; renderSearch(); return; }
    sqResults = [it];
    $('sq-info').textContent = '';
    renderSearch();
    streamPlay(it, [it]);
    return;
  }

  if (sqMode === 'yt') {
    const r = await window.api.stream.youtube(q);
    if ($('sq').value.trim() !== q) return;
    if (r.error === 'nokey') {
      sqResults = [];
      $('sq-info').textContent = 'нет ни yt-dlp, ни ключа — смотри Настройки → Стриминг';
      renderSearch();
      return;
    }
    if (r.error) {
      sqResults = [];
      $('sq-info').textContent = 'YouTube: ' + r.error;
      renderSearch();
      return;
    }
    sqResults = r.items || [];
  } else {
    const res = await window.api.search.query(q);
    if ($('sq').value.trim() !== q) return;    // пока искали, запрос поменялся
    sqResults = res || [];
  }

  $('sq-info').textContent = sqResults.length ? `${sqResults.length} результатов` : 'ничего не нашлось';
  renderSearch();
}

function wireSearchModes() {
  const btns = [$('sm-catalog'), $('sm-yt')];
  for (const b of btns) {
    b.onclick = () => {
      sqMode = b.dataset.mode;
      btns.forEach(x => x.classList.toggle('on', x === b));
      const q = $('sq').value.trim();
      if (q.length >= 2) runSearch(q);
    };
  }
}

$('sq').addEventListener('input', () => {
  const q = $('sq').value.trim();
  $('sq-x').hidden = !q;
  clearTimeout(sqTimer);
  if (q.length < 2) { sqResults = []; $('sq-info').textContent = ''; renderSearch(); return; }
  sqTimer = setTimeout(() => runSearch(q), 450);
});
$('sq-x').onclick = () => {
  $('sq').value = ''; $('sq-x').hidden = true;
  sqResults = []; $('sq-info').textContent = '';
  renderSearch(); $('sq').focus();
};

/* ===================== вкладки ===================== */
function go(view) {
  S.view = view;
  document.querySelectorAll('.nav-i').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + view));
  if (view === 'library') renderRows();
  if (view === 'search') setTimeout(() => $('sq').focus(), 60);
  else if (sqPlaying) stopPreview();
  // пока вкладка скрыта, размеры нулевые - пересчитываем при показе
  if (view === 'now') requestAnimationFrame(() => { sizeViz(); centerLyrics(LY.cur, true); });
  window.api.settings.set({ view });
}
document.querySelectorAll('.nav-i').forEach(b => b.onclick = () => go(b.dataset.view));

/* ===================== другие плееры ===================== */
function renderSys() {
  const box = $('sys-list');
  const list = S.sys.sessions || [];
  $('sys-empty').hidden = list.length > 0;
  $('sys-dot').hidden = !list.some(s => s.playing);
  box.textContent = '';

  for (const s of list) {
    const c = el('div', 'sys-c' + (s.playing ? ' live' : ''));
    const art = el('div', 'sys-art');
    if (s.cover) { const i = el('img'); i.src = window.api.file(s.cover); art.appendChild(i); }
    else art.textContent = '♫';

    const m = el('div', 'sys-m');
    m.innerHTML = `<div class="sys-app">${s.playing ? '<em></em>' : ''}<span></span></div>
      <div class="sys-t"></div><div class="sys-a"></div>
      <div class="sys-p"><i></i></div><div class="sys-time"></div>`;
    m.querySelector('.sys-app span').textContent = s.app + (s.playing ? ' · играет' : ' · пауза');
    m.querySelector('.sys-t').textContent = s.title;
    m.querySelector('.sys-a').textContent = s.artist || '';
    const pr = s.duration ? Math.min(100, s.position / s.duration * 100) : 0;
    m.querySelector('.sys-p i').style.width = pr + '%';
    m.querySelector('.sys-p').style.display = s.duration ? '' : 'none';
    m.querySelector('.sys-time').textContent = s.duration ? `${fmt(s.position)} / ${fmt(s.duration)}` : '';

    const btns = el('div', 'sys-btns');
    for (const [what, path, label] of [
      ['prev', 'M6 6h2.2v12H6zM20 6v12l-9.4-6z', 'назад'],
      [s.playing ? 'playpause' : 'playpause', s.playing ? 'M6.5 5h3.5v14H6.5zM14 5h3.5v14H14z' : 'M8 5v14l11-7z', 'играть'],
      ['next', 'M15.8 6H18v12h-2.2zM4 6l9.4 6L4 18z', 'вперёд']
    ]) {
      const b = el('button', 'cbtn');
      b.setAttribute('aria-label', label);
      b.innerHTML = `<svg viewBox="0 0 24 24"><path d="${path}"/></svg>`;
      b.onclick = async () => {
        const ok = await window.api.smtc.control(what);
        if (!ok) toast('Не получилось отправить команду');
      };
      btns.appendChild(b);
    }

    c.append(art, m, btns);
    box.appendChild(c);
  }
}

window.api.smtc.onUpdate(s => { S.sys = s || { sessions: [], current: null }; renderSys(); });

/* ===================== темы ===================== */

// файлы шрифтов лежат внутри приложения, интернет не нужен
const FONTS = [
  { id: 'system',    name: 'Системный', css: '"Segoe UI Variable Display","Segoe UI",Inter,system-ui,sans-serif' },
  { id: 'inter',     name: 'Inter',     css: '"Inter",system-ui,sans-serif' },
  { id: 'manrope',   name: 'Manrope',   css: '"Manrope",system-ui,sans-serif' },
  { id: 'golos',     name: 'Golos',     css: '"Golos Text",system-ui,sans-serif' },
  { id: 'unbounded', name: 'Unbounded', css: '"Unbounded",system-ui,sans-serif' },
  { id: 'oswald',    name: 'Oswald',    css: '"Oswald",system-ui,sans-serif' },
  { id: 'playfair',  name: 'Playfair',  css: '"Playfair Display",Georgia,serif' },
  { id: 'jetbrains', name: 'JetBrains', css: '"JetBrains Mono",Consolas,monospace' }
];
const fontCss = id => (FONTS.find(f => f.id === id) || FONTS[0]).css;

// плитки с именем шрифта, написанным этим же шрифтом
function renderFonts(boxId, get, set) {
  const box = $(boxId);
  const paint = () => {
    box.textContent = '';
    for (const f of FONTS) {
      const b = el('button', 'fontb' + (get() === f.id ? ' on' : ''));
      b.style.fontFamily = f.css;
      b.title = f.name;
      const n = el('b'); n.textContent = f.name;
      const s = el('i'); s.textContent = 'Ёжик Aa 123';
      b.append(n, s);
      b.onclick = () => { set(f.id); paint(); };
      box.appendChild(b);
    }
  };
  paint();
  return paint;
}

const PRESETS = [
  {
    id: 'vinyl', name: 'Винил', hint: 'пластинка и кольцо из палочек',
    sw: ['#9b8cff', '#2a2436', '#0b0a11'],
    cfg: {
      accent: true, particles: true,
      lyricsTheme: 'karaoke', lyricsSize: 'md', lyricsGlow: true, lyricsBlur: true,
      theme: { fontUi: 'system', fontLy: 'system', viz: 'ring', vizPower: 100, disc: 'vinyl', spin: true, beat: true,
               bg: 'cover', bgBlur: 80, bgDim: 42 }
    }
  },
  {
    id: 'neon', name: 'Неон', hint: 'круговая волна, яркий фон, крупный текст',
    sw: ['#ff4fd8', '#6a2bff', '#140a24'],
    cfg: {
      accent: true, particles: true,
      lyricsTheme: 'karaoke', lyricsSize: 'lg', lyricsGlow: true, lyricsBlur: false,
      theme: { fontUi: 'inter', fontLy: 'unbounded', viz: 'radial', vizPower: 140, disc: 'vinyl', spin: true, beat: true,
               bg: 'cover', bgBlur: 54, bgDim: 28 }
    }
  },
  {
    id: 'club', name: 'Клуб', hint: 'столбики снизу и пульс от баса',
    sw: ['#ff8a3d', '#2b1a10', '#0a0807'],
    cfg: {
      accent: true, particles: false,
      lyricsTheme: 'focus', lyricsSize: 'md', lyricsGlow: true, lyricsBlur: true,
      theme: { fontUi: 'inter', fontLy: 'oswald', viz: 'bars', vizPower: 120, disc: 'square', spin: false, beat: true,
               bg: 'cover', bgBlur: 92, bgDim: 52 }
    }
  },
  {
    id: 'osc', name: 'Осциллограф', hint: 'живая волна и печатная машинка',
    sw: ['#4ff0c0', '#123028', '#07110e'],
    cfg: {
      accent: true, particles: false,
      lyricsTheme: 'type', lyricsSize: 'md', lyricsGlow: false, lyricsBlur: true,
      theme: { fontUi: 'jetbrains', fontLy: 'jetbrains', viz: 'wave', vizPower: 110, disc: 'square', spin: false, beat: false,
               bg: 'cover', bgBlur: 110, bgDim: 58 }
    }
  },
  {
    id: 'dust', name: 'Пыль', hint: 'частицы, которые расталкивает басом',
    sw: ['#c9b8ff', '#1d1a2b', '#09080e'],
    cfg: {
      accent: true, particles: true,
      lyricsTheme: 'soft', lyricsSize: 'md', lyricsGlow: true, lyricsBlur: true,
      theme: { fontUi: 'manrope', fontLy: 'manrope', viz: 'dust', vizPower: 130, disc: 'vinyl', spin: true, beat: true,
               bg: 'cover', bgBlur: 100, bgDim: 50 }
    }
  },
  {
    id: 'tunnel', name: 'Туннель', hint: 'кольца уходят вдаль на каждую долю',
    sw: ['#6fd2ff', '#132433', '#06090f'],
    cfg: {
      accent: true, particles: false,
      lyricsTheme: 'karaoke', lyricsSize: 'lg', lyricsGlow: true, lyricsBlur: true,
      theme: { fontUi: 'inter', fontLy: 'unbounded', viz: 'tunnel', vizPower: 120, disc: 'vinyl', spin: true, beat: true,
               bg: 'cover', bgBlur: 96, bgDim: 56 }
    }
  },
  {
    id: 'lab', name: 'Лаборатория', hint: 'спектрограмма и моноширинный текст',
    sw: ['#a8ff6f', '#1b2a14', '#070b06'],
    cfg: {
      accent: true, particles: false,
      lyricsTheme: 'focus', lyricsSize: 'sm', lyricsGlow: false, lyricsBlur: false,
      theme: { fontUi: 'jetbrains', fontLy: 'jetbrains', viz: 'fall', vizPower: 110, disc: 'square', spin: false, beat: false,
               bg: 'cover', bgBlur: 120, bgDim: 64 }
    }
  },
  {
    id: 'bloom', name: 'Цветок', hint: 'лепестки дышат вокруг обложки',
    sw: ['#ff9ec4', '#33182a', '#0d0710'],
    cfg: {
      accent: true, particles: true,
      lyricsTheme: 'soft', lyricsSize: 'lg', lyricsGlow: true, lyricsBlur: true,
      theme: { fontUi: 'golos', fontLy: 'playfair', viz: 'bloom', vizPower: 115, disc: 'vinyl', spin: true, beat: true,
               bg: 'cover', bgBlur: 88, bgDim: 46 }
    }
  },
  {
    id: 'mirror', name: 'Отражение', hint: 'столбики расходятся от средней линии',
    sw: ['#ffd76f', '#2e2413', '#0b0906'],
    cfg: {
      accent: true, particles: false,
      lyricsTheme: 'karaoke', lyricsSize: 'md', lyricsGlow: true, lyricsBlur: true,
      theme: { fontUi: 'manrope', fontLy: 'oswald', viz: 'mirror', vizPower: 125, disc: 'square', spin: false, beat: true,
               bg: 'cover', bgBlur: 84, bgDim: 50 }
    }
  },
  {
    id: 'glow', name: 'Сияние', hint: 'занавесы северного сияния во весь экран',
    sw: ['#7cf3d0', '#1b3a4a', '#06101a'],
    cfg: {
      accent: true, particles: true,
      lyricsTheme: 'karaoke', lyricsSize: 'lg', lyricsGlow: true, lyricsBlur: true,
      theme: { fontUi: 'inter', fontLy: 'unbounded', viz: 'aurora', vizPower: 110,
               vizSpeed: 80, vizAlpha: 85, disc: 'vinyl', spin: true, beat: true,
               bg: 'cover', bgBlur: 104, bgDim: 58 }
    }
  },
  {
    id: 'orbit', name: 'Орбита', hint: 'шар из точек крутится вокруг обложки',
    sw: ['#8fb8ff', '#1d2740', '#070a12'],
    cfg: {
      accent: true, particles: false,
      lyricsTheme: 'karaoke', lyricsSize: 'md', lyricsGlow: true, lyricsBlur: true,
      theme: { fontUi: 'manrope', fontLy: 'manrope', viz: 'sphere', vizPower: 110,
               vizSpeed: 100, vizAlpha: 100, disc: 'plain', spin: false, beat: true,
               bg: 'cover', bgBlur: 96, bgDim: 54 }
    }
  },
  {
    id: 'mandala', name: 'Мандала', hint: 'симметричный узор собирается из спектра',
    sw: ['#ff7ae0', '#3a1440', '#0d0512'],
    cfg: {
      accent: true, particles: false,
      lyricsTheme: 'focus', lyricsSize: 'md', lyricsGlow: true, lyricsBlur: true,
      theme: { fontUi: 'golos', fontLy: 'golos', viz: 'kaleid', vizPower: 100,
               vizSpeed: 70, vizAlpha: 80, disc: 'vinyl', spin: true, beat: true,
               bg: 'cover', bgBlur: 110, bgDim: 62 }
    }
  },
  {
    id: 'storm', name: 'Гроза', hint: 'дождь из спектра и мокрый пол',
    sw: ['#9fd8ff', '#16222e', '#050a0f'],
    cfg: {
      accent: true, particles: false,
      lyricsTheme: 'soft', lyricsSize: 'md', lyricsGlow: false, lyricsBlur: true,
      theme: { fontUi: 'inter', fontLy: 'inter', viz: 'rain', vizPower: 105,
               vizSpeed: 100, vizAlpha: 90, disc: 'square', spin: false, beat: false,
               bg: 'cover', bgBlur: 118, bgDim: 66 }
    }
  },
  {
    id: 'nova', name: 'Сверхновая', hint: 'длинные лучи и вспышка на каждую долю',
    sw: ['#ffb457', '#3a1c10', '#0d0603'],
    cfg: {
      accent: true, particles: true,
      lyricsTheme: 'focus', lyricsSize: 'lg', lyricsGlow: true, lyricsBlur: true,
      theme: { fontUi: 'oswald', fontLy: 'oswald', viz: 'pulsar', vizPower: 125,
               vizSpeed: 110, vizAlpha: 95, disc: 'plain', spin: false, beat: true,
               bg: 'cover', bgBlur: 88, bgDim: 50 }
    }
  },
  {
    id: 'silk', name: 'Шёлк', hint: 'лента вьётся и перекручивается под текстом',
    sw: ['#e0a9ff', '#2b1b3d', '#0a0611'],
    cfg: {
      accent: true, particles: false,
      lyricsTheme: 'feed', lyricsSize: 'md', lyricsGlow: false, lyricsBlur: true,
      theme: { fontUi: 'golos', fontLy: 'playfair', viz: 'ribbon', vizPower: 100,
               vizSpeed: 85, vizAlpha: 100, disc: 'vinyl', spin: true, beat: true,
               bg: 'cover', bgBlur: 100, bgDim: 56 }
    }
  },
  {
    id: 'clean', name: 'Чисто', hint: 'ничего лишнего, текст лентой',
    sw: ['#e8e6ef', '#26242c', '#0a0a0c'],
    cfg: {
      accent: false, particles: false,
      lyricsTheme: 'feed', lyricsSize: 'md', lyricsGlow: false, lyricsBlur: false,
      theme: { fontUi: 'golos', fontLy: 'playfair', viz: 'off', vizPower: 100, disc: 'plain', spin: false, beat: false,
               bg: 'plain', bgBlur: 0, bgDim: 60 }
    }
  }
];

// раскладывает настройки темы по интерфейсу
// раскладки вкладки "Сейчас играет" - переключаются кнопкой в углу и клавишей L
const LAYOUTS = [
  { id: 'stack', name: 'Обложка сверху' },
  { id: 'apple', name: 'Обложка слева' },
  { id: 'side',  name: 'Текст слева' },
  { id: 'text',  name: 'Только текст' },
  { id: 'cover', name: 'Только обложка' }
];

function setLayout(v, manual = true) {
  const lay = LAYOUTS.find(l => l.id === v) ? v : 'stack';
  S.cfg.theme = S.cfg.theme || {};
  S.cfg.theme.layout = lay;
  window.api.settings.set({ theme: { layout: lay } });
  applyTheme();
  // колонка другой ширины - строки перенеслись, текущую надо подвести заново.
  // второй раз с задержкой: к этому моменту вёрстка уже устаканилась
  requestAnimationFrame(() => { sizeViz(); centerLyrics(LY.cur, true); });
  setTimeout(() => { sizeViz(); centerLyrics(LY.cur, true); }, 280);
  if (manual) offPreset();
  return lay;
}

function cycleLayout() {
  const cur = S.cfg?.theme?.layout || 'stack';
  const i = Math.max(0, LAYOUTS.findIndex(l => l.id === cur));
  const next = LAYOUTS[(i + 1) % LAYOUTS.length];
  setLayout(next.id);
  paintThemeControls();      // вкладка "Темы" должна показывать то же самое
  toast('Раскладка: ' + next.name);
}

function applyTheme() {
  const th = S.cfg.theme || {};
  $('v-now').dataset.lay = th.layout || 'stack';

  const disc = $('disc');
  disc.classList.toggle('sq', th.disc === 'square');
  disc.classList.toggle('plain', th.disc === 'plain');
  disc.classList.toggle('spin', th.spin !== false && th.disc !== 'plain');

  document.body.dataset.bg = th.bg || 'cover';
  const root = document.documentElement.style;
  root.setProperty('--font-ui', fontCss(th.fontUi || 'system'));
  root.setProperty('--font-ly', fontCss(th.fontLy || 'system'));
  root.setProperty('--bg-blur', (th.bgBlur ?? 80) + 'px');
  root.setProperty('--bg-dim', ((th.bgDim ?? 42) / 100).toFixed(2));
  if (th.beat === false) root.setProperty('--beat', '1');

  $('px').style.display = S.cfg.particles ? '' : 'none';
  accentFrom(coverUrl(S.track));
  applyBg();
  applyVideoBg();
}

/* ---- фоновое видео ---- */
const VID = { list: [], i: 0, cur: null, url: '' };

// расширение решает, картинка это или ролик: тип по ссылке заранее не узнать
const BG_VIDEO_RE = /\.(mp4|webm|ogv|ogg|m4v|mov)(\?|#|$)/i;

function bgUrlKind() {
  const u = ((S.cfg.theme || {}).bgUrl || '').trim();
  if (!/^https:\/\//i.test(u)) return '';    // http запрещён политикой страницы
  return BG_VIDEO_RE.test(u) ? 'vid' : 'img';
}

// в css url() кавычки и слэши могли бы вырваться наружу - выкидываем их
const cssUrl = u => String(u || '').replace(/["'\\\s]+/g, '');

let bgCover = '';

// что показывать в размытом фоне: картинку по ссылке или обложку трека
function applyBg(cover) {
  if (cover !== undefined) bgCover = cover || '';
  const th = S.cfg.theme || {};
  const kind = th.bg === 'url' ? bgUrlKind() : '';
  document.body.dataset.bgkind = kind;

  const bg = $('bg-art');
  const src = kind === 'img' ? cssUrl(th.bgUrl) : (kind === 'vid' ? '' : bgCover);

  if (src) { bg.style.backgroundImage = `url("${src}")`; bg.classList.add('on'); }
  else bg.classList.remove('on');
}

function applyVideoBg() {
  const th = S.cfg.theme || {};
  const byUrl = th.bg === 'url' && bgUrlKind() === 'vid' ? (th.bgUrl || '').trim() : '';
  const byFolder = th.bg === 'video';

  if (!byUrl && !byFolder) {
    for (const v of [$('vid-a'), $('vid-b')]) { v.classList.remove('on'); v.pause(); }
    VID.cur = null;
    VID.url = '';
    return;
  }

  // одна ссылка - крутим её по кругу в одном элементе, папка тут не при чём
  if (byUrl) {
    const v = $('vid-a');
    $('vid-b').classList.remove('on');
    $('vid-b').pause();
    if (VID.url !== byUrl) {
      VID.url = byUrl;
      VID.list = [];
      v.onended = null;
      v.onerror = () => urlState('ролик по этой ссылке не открылся', true);
      v.onloadeddata = () => urlState(`ролик ${v.videoWidth}×${v.videoHeight}`);
      v.src = byUrl;
      v.loop = true;
      v.load();
      v.play().catch(() => {});
    }
    v.classList.add('on');
    VID.cur = v;
    return;
  }

  VID.url = '';
  if (VID.cur) return;              // уже крутится
  loadVideoList().then(() => {
    if (!VID.list.length || (S.cfg.theme || {}).bg !== 'video') return;
    VID.i = 0;
    VID.cur = $('vid-a');
    startVideo(VID.cur, VID.list[0]);
    VID.cur.classList.add('on');
  });
}

function urlState(msg, bad) {
  const n = $('url-state');
  if (!n) return;
  n.textContent = msg || '';
  n.classList.toggle('bad', !!bad);
}

// ссылку проверяем сразу, чтобы не гадать, почему фон не поменялся
function checkBgUrl() {
  const u = ((S.cfg.theme || {}).bgUrl || '').trim();
  if (!u) { urlState(''); return; }
  if (/^http:\/\//i.test(u)) { urlState('нужен https — простой http приложение не пустит', true); return; }
  if (!/^https:\/\//i.test(u)) { urlState('нужна ссылка, начинающаяся с https', true); return; }

  if (bgUrlKind() === 'vid') { urlState('ролик загружается…'); return; }

  urlState('проверяю…');
  const im = new Image();
  im.onload = () => urlState(`картинка ${im.naturalWidth}×${im.naturalHeight}`);
  im.onerror = () => urlState('картинка по этой ссылке не открылась', true);
  im.src = u;
}

async function loadVideoList() {
  VID.list = await window.api.video.list();
  for (let i = VID.list.length - 1; i > 0; i--) {       // перемешиваем
    const j = Math.floor(Math.random() * (i + 1));
    [VID.list[i], VID.list[j]] = [VID.list[j], VID.list[i]];
  }
  const c = $('vid-count');
  if (c) c.textContent = VID.list.length ? `роликов: ${VID.list.length}` : 'в папке нет видео';
  return VID.list;
}

function startVideo(el, file) {
  el.onerror = null;
  el.onloadeddata = null;
  el.src = window.api.file(file);
  el.loop = VID.list.length < 2;
  el.load();
  el.play().catch(() => {});
  el.onended = nextVideo;
}

function nextVideo() {
  if (VID.list.length < 2 || !VID.cur) return;
  const next = VID.cur === $('vid-a') ? $('vid-b') : $('vid-a');
  const prev = VID.cur;
  VID.i = (VID.i + 1) % VID.list.length;
  startVideo(next, VID.list[VID.i]);
  next.classList.add('on');
  prev.classList.remove('on');
  VID.cur = next;
  setTimeout(() => { if (VID.cur !== prev) prev.pause(); }, 1700);
}

/* ---- пресеты ---- */
function applyPreset(p) {
  const patch = JSON.parse(JSON.stringify(p.cfg));
  patch.theme.preset = p.id;
  patch.theme.profile = '';
  // старые темы про эти настройки не знают - иначе скорость и насыщенность
  // от прошлой темы прилипли бы к новой и она выглядела бы не так, как обещано
  if (patch.theme.vizSpeed === undefined) patch.theme.vizSpeed = 100;
  if (patch.theme.vizAlpha === undefined) patch.theme.vizAlpha = 100;
  // в память кладём то же, что уходит на диск
  S.cfg = Object.assign({}, S.cfg, patch, { theme: Object.assign({}, S.cfg.theme, patch.theme) });
  window.api.settings.set(patch);
  applyTheme();
  applyLyStyle();
  paintThemeControls();
  toast('Тема: ' + p.name);
}

function renderPresets() {
  const box = $('presets');
  box.textContent = '';
  for (const p of PRESETS) {
    const b = el('button', 'preset' + (S.cfg.theme?.preset === p.id ? ' on' : ''));
    const sw = el('div', 'preset-sw');
    for (const c of p.sw) { const i = el('i'); i.style.background = c; sw.appendChild(i); }
    const n = el('div', 'preset-n'); n.textContent = p.name;
    const h = el('div', 'preset-h'); h.textContent = p.hint;
    b.append(sw, n, h);
    b.onclick = () => applyPreset(p);
    box.appendChild(b);
  }
}

// после ручной правки ни готовая тема, ни профиль уже не те - снимаем отметки
function offPreset() {
  if (!S.cfg.theme) S.cfg.theme = {};
  S.cfg.theme.preset = 'custom';
  S.cfg.theme.profile = '';
  window.api.settings.set({ theme: { preset: 'custom', profile: '' } });
  renderPresets();
  renderProfiles();
}

/* ---- свои профили оформления ---- */

// всё, что делает внешний вид внешним видом. папки, громкость и горячие
// клавиши сюда не попадают: профиль про оформление, а не про всё подряд
const LOOK_KEYS = ['accent', 'particles', 'lyricsTheme', 'lyricsSize', 'lyricsGlow', 'lyricsBlur'];
const LOOK_THEME = ['fontUi', 'fontLy', 'accentColor', 'viz', 'vizPower', 'vizSpeed',
                    'vizAlpha', 'vizAuto', 'layout', 'disc', 'spin', 'beat',
                    'bg', 'bgUrl', 'bgBlur', 'bgDim'];

function currentLook() {
  const t = S.cfg.theme || {};
  const out = { theme: {} };
  for (const k of LOOK_KEYS) out[k] = S.cfg[k];
  for (const k of LOOK_THEME) out.theme[k] = t[k];
  return out;
}

function profiles() {
  if (!Array.isArray(S.cfg.profiles)) S.cfg.profiles = [];
  return S.cfg.profiles;
}

function saveProfiles() {
  window.api.settings.set({ profiles: profiles() });
}

function addProfile(name) {
  const n = (name || '').trim().slice(0, 40) || 'Без имени';
  const p = { id: 'p' + Date.now().toString(36), name: n, at: Date.now(), cfg: currentLook() };
  profiles().push(p);
  S.cfg.theme = S.cfg.theme || {};
  S.cfg.theme.profile = p.id;
  saveProfiles();
  window.api.settings.set({ theme: { profile: p.id } });
  renderProfiles();
  toast('Профиль «' + n + '» сохранён');
}

function applyProfile(p) {
  const patch = JSON.parse(JSON.stringify(p.cfg));
  patch.theme.preset = 'custom';
  patch.theme.profile = p.id;

  S.cfg = Object.assign({}, S.cfg, patch,
    { theme: Object.assign({}, S.cfg.theme, patch.theme) });
  window.api.settings.set(patch);

  applyTheme();
  applyLyStyle();
  if (typeof repaintTheme === 'function') repaintTheme();
  // раскладка могла смениться - колонка другой ширины, строки надо подвести заново
  requestAnimationFrame(() => { sizeViz(); centerLyrics(LY.cur, true); });
  setTimeout(() => { sizeViz(); centerLyrics(LY.cur, true); }, 280);
  toast('Профиль: ' + p.name);
}

function dropProfile(p) {
  const list = profiles();
  const i = list.indexOf(p);
  if (i < 0) return;
  list.splice(i, 1);
  if ((S.cfg.theme || {}).profile === p.id) {
    S.cfg.theme.profile = '';
    window.api.settings.set({ theme: { profile: '' } });
  }
  saveProfiles();
  renderProfiles();
}

// кружок профиля: свой цвет, если задан, иначе тот, что сейчас подобран под обложку
function profColor(p) {
  const c = ((p.cfg || {}).theme || {}).accentColor;
  if (c) return c;
  return 'rgb(' + (getComputedStyle(document.documentElement)
    .getPropertyValue('--ac').trim() || '150,140,255') + ')';
}

function renderProfiles() {
  const box = $('profiles');
  if (!box) return;
  box.textContent = '';
  const cur = (S.cfg.theme || {}).profile || '';

  for (const p of profiles()) {
    const chip = el('div', 'prof' + (cur === p.id ? ' on' : ''));

    const sw = el('div', 'prof-sw');
    sw.style.background = profColor(p);

    const n = el('button', 'prof-n');
    n.textContent = p.name;
    n.title = 'применить';
    n.onclick = () => applyProfile(p);

    const ren = el('button', 'prof-x');
    ren.textContent = '✎';
    ren.title = 'переименовать';
    ren.onclick = () => nameInput(chip, p.name, v => {
      const nn = (v || '').trim().slice(0, 40);
      if (nn) { p.name = nn; saveProfiles(); }
      renderProfiles();
    });

    const x = el('button', 'prof-x');
    x.textContent = '✕';
    x.title = 'удалить профиль';
    x.onclick = () => dropProfile(p);

    chip.append(sw, n, ren, x);
    box.appendChild(chip);
  }

  if (!profiles().length) {
    const e = el('span', 'prof-empty');
    e.textContent = 'пока ни одного — настрой вид и сохрани';
    box.appendChild(e);
  }

  const add = el('button', 'prof-add');
  add.textContent = '+ сохранить текущее';
  add.onclick = () => nameInput(add, '', v => {
    if ((v || '').trim()) addProfile(v); else renderProfiles();
  });
  box.appendChild(add);
}

// тот же приём, что и с плейлистами: prompt() в electron не работает
function nameInput(node, value, done) {
  const inp = el('input', 'prof-inp');
  inp.value = value || '';
  inp.placeholder = 'название профиля';
  node.replaceWith(inp);
  inp.focus();
  inp.select();

  let closed = false;
  const fin = ok => {
    if (closed) return;
    closed = true;
    if (ok) done(inp.value); else renderProfiles();
  };
  inp.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Enter') fin(true);
    else if (e.key === 'Escape') fin(false);
  };
  inp.onblur = () => fin(false);
}

function paintThemeControls() {
  if (typeof repaintTheme === 'function') repaintTheme();
}

/* ===================== профиль ===================== */

// цветов для ника и титула нужно больше, чем для акцента интерфейса:
// тут это украшение, а не рабочий цвет, которым красится половина экрана
const NICK_COLORS = [
  '#ff5c5c', '#ff8a3d', '#ffd93d', '#8cd94f', '#4ff0c0',
  '#57a6ff', '#9b8cff', '#d47aff', '#ff4fd8', '#e8e6ef'
];

// титулы не покупаются - часть открыта сразу, часть зарабатывается.
// need получает подсчитанное и решает, открыт ли титул
const TITLES = [
  { id: 'listener', name: 'Слушатель' },
  { id: 'night',    name: 'Полуночник' },
  { id: 'c100',     name: 'Сто треков',    need: c => c.total >= 100,    hint: '100 дослушанных' },
  { id: 'c1000',    name: 'Тысяча треков', need: c => c.total >= 1000,   hint: '1000 дослушанных' },
  { id: 'h10',      name: 'Десять часов',  need: c => c.hours >= 10,     hint: '10 часов со звуком' },
  { id: 'h100',     name: 'Сто часов',     need: c => c.hours >= 100,    hint: '100 часов со звуком' },
  { id: 'keeper',   name: 'Собиратель',    need: c => c.lib >= 300,      hint: '300 треков в библиотеке' },
  { id: 'archive',  name: 'Хранитель',     need: c => c.lib >= 1000,     hint: '1000 треков в библиотеке' },
  { id: 'heart',    name: 'Сердцеед',      need: c => c.fav >= 50,       hint: '50 в любимых' },
  { id: 'loyal',    name: 'Постоянный',    need: c => c.top >= 20,       hint: 'один трек 20 раз' }
];

function prof() {
  const p = (S.cfg.profile = S.cfg.profile || {});
  return p;
}

function setProf(patch) {
  Object.assign(prof(), patch);
  window.api.settings.set({ profile: patch });
  renderProfile();
}

// картинка профиля - либо ссылка из интернета, либо файл у нас в папке
function profPic(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^https:\/\//i.test(s)) return cssUrl(s);
  return window.api.file(s);
}

// всё, что посчитали о прослушанном: нужно и плиткам, и титулам, и волне
function listenCounts() {
  const s = stats();
  let top = 0;
  for (const k in s.plays) if (s.plays[k] > top) top = s.plays[k];
  return {
    total: s.total || 0,
    hours: Math.floor((s.seconds || 0) / 3600),
    lib: S.tracks.length,
    fav: (S.cfg.favorites || []).length,
    top: top
  };
}

function renderProfile() {
  const p = prof();

  const ava = $('pf-ava'), pic = profPic(p.avatar);
  ava.style.backgroundImage = pic ? `url("${pic}")` : '';
  ava.classList.toggle('has', !!pic);

  const ban = profPic(p.banner);
  $('pf-banner').style.backgroundImage = ban ? `url("${ban}")` : '';

  const bg = profPic(p.bg);
  $('pf-bg').style.backgroundImage = bg ? `url("${bg}")` : '';
  $('pf-bg').classList.toggle('on', !!bg);

  $('pf-name').textContent = (p.name || '').trim() || 'Без имени';
  $('pf-name').style.setProperty('--pf-name-c', p.color || '#fff');

  const tag = (p.tag || '').trim();
  $('pf-tag').textContent = tag ? '@' + tag : '';
  $('pf-tag').hidden = !tag;

  const st = (p.status || '').trim();
  $('pf-status').textContent = st;
  $('pf-status').hidden = !st;

  const ab = (p.about || '').trim();
  $('pf-about').textContent = ab;
  $('pf-about').hidden = !ab;

  const ttl = (p.title || '').trim();
  $('pf-title').textContent = ttl;
  $('pf-title').hidden = !ttl;
  $('pf-title').style.setProperty('--pf-title-c', p.titleColor || '');

  renderProfStats();
  renderTitles();
}

function renderProfStats() {
  const box = $('pf-stats');
  if (!box) return;
  const c = listenCounts();
  const s = stats();

  // любимый артист - у кого больше всего дослушиваний
  const byArtist = {};
  for (const t of S.tracks) {
    const n = s.plays[t.id] || 0;
    if (!n) continue;
    const a = (t.artist || '').trim() || '—';
    byArtist[a] = (byArtist[a] || 0) + n;
  }
  let fav = '—', favN = 0;
  for (const a in byArtist) if (byArtist[a] > favN) { favN = byArtist[a]; fav = a; }

  const tiles = [
    [c.total, 'дослушано треков'],
    [c.hours < 1 ? Math.floor((s.seconds || 0) / 60) + ' мин' : c.hours + ' ч', 'со звуком'],
    [c.lib, 'в библиотеке'],
    [c.fav, 'в любимых'],
    [favN ? fav : '—', 'чаще всего']
  ];

  box.textContent = '';
  for (const [v, lab] of tiles) {
    const d = el('div', 'pf-stat');
    const b = el('b'); b.textContent = String(v); b.title = String(v);
    const sp = el('span'); sp.textContent = lab;
    d.append(b, sp);
    box.appendChild(d);
  }
}

function renderTitles() {
  const box = $('pf-titles');
  if (!box) return;
  const c = listenCounts();
  const cur = (prof().title || '').trim();

  box.textContent = '';
  for (const t of TITLES) {
    const open = !t.need || t.need(c);
    const b = el('button', 'ttl' + (cur === t.name ? ' on' : '') + (open ? '' : ' locked'));
    const n = el('span'); n.textContent = t.name;
    b.appendChild(n);
    if (!open) {
      const e = el('em'); e.textContent = t.hint || '';
      b.appendChild(e);
      b.title = 'откроется: ' + (t.hint || '');
    } else {
      b.onclick = () => {
        setProf({ title: cur === t.name ? '' : t.name });
        $('pf-title-own').value = prof().title || '';
      };
    }
    box.appendChild(b);
  }
}

function wireProfile() {
  renderProfile();

  const bind = (id, key, max) => {
    const inp = $(id);
    if (!inp) return;
    inp.value = prof()[key] || '';
    inp.oninput = () => setProf({ [key]: inp.value.slice(0, max || 200) });
  };
  bind('pf-in-name', 'name', 32);
  bind('pf-in-tag', 'tag', 20);
  bind('pf-in-status', 'status', 64);
  bind('pf-in-about', 'about', 240);
  bind('pf-in-avatar', 'avatar');
  bind('pf-in-banner', 'banner');
  bind('pf-in-bg', 'bg');

  // свой титул главнее готового: написал руками - отметка с кнопок снимается
  const own = $('pf-title-own');
  own.value = prof().title || '';
  own.oninput = () => { setProf({ title: own.value.slice(0, 24) }); renderTitles(); };

  // выбор файла и очистка для трёх картинок сразу
  for (const b of document.querySelectorAll('#v-profile [data-pick]')) {
    const kind = b.dataset.pick;
    b.onclick = async () => {
      const p = await window.api.profile.pick(kind);
      if (!p) return;
      setProf({ [kind]: p });
      $('pf-in-' + kind).value = p;
    };
  }
  for (const b of document.querySelectorAll('#v-profile [data-clr]')) {
    const kind = b.dataset.clr;
    b.onclick = () => { setProf({ [kind]: '' }); $('pf-in-' + kind).value = ''; };
  }

  const pal = (boxId, key) => {
    const box = $(boxId);
    const paint = () => {
      box.textContent = '';
      const cur = (prof()[key] || '').toLowerCase();

      const auto = el('button', 'auto' + (cur ? '' : ' on'));
      auto.title = 'как у интерфейса';
      auto.onclick = () => { setProf({ [key]: '' }); paint(); };
      box.appendChild(auto);

      for (const c of NICK_COLORS) {
        const b = el('button', cur === c ? 'on' : '');
        b.style.background = c;
        b.title = c;
        b.onclick = () => { setProf({ [key]: c }); paint(); };
        box.appendChild(b);
      }
    };
    paint();
  };
  pal('pf-pal', 'color');
  pal('pf-title-pal', 'titleColor');
}

/* ===================== настройки ===================== */
const KEY_LABELS = {
  playPause: 'Пауза / играть',
  next: 'Следующий трек',
  prev: 'Предыдущий трек',
  volUp: 'Громче',
  volDown: 'Тише'
};

function renderFolders() {
  const box = $('folders');
  box.textContent = '';
  for (const f of S.cfg.folders) {
    const d = el('div', 'fold');
    const s = el('span'); s.textContent = f; s.title = f;
    const b = el('button'); b.textContent = '✕'; b.title = 'убрать';
    b.onclick = async () => {
      S.cfg.folders = await window.api.lib.remove(f);
      renderFolders();
      toast('Папка убрана. Нажми «Пересканировать»');
    };
    d.append(s, b);
    box.appendChild(d);
  }
}

function renderKeys() {
  const box = $('keys');
  box.textContent = '';
  for (const k of Object.keys(KEY_LABELS)) {
    const row = el('div', 'key');
    const s = el('span'); s.textContent = KEY_LABELS[k];
    const kb = el('kbd'); kb.textContent = S.cfg.hotkeys[k] || 'не задано';
    kb.onclick = () => recordKey(kb, k);
    row.append(s, kb);
    box.appendChild(row);
  }
}

let recording = null;
function recordKey(kb, field) {
  if (recording) { recording.kb.classList.remove('rec'); recording.kb.textContent = S.cfg.hotkeys[recording.field] || 'не задано'; }
  recording = { kb, field };
  kb.classList.add('rec');
  kb.textContent = 'жми клавиши…';
}

window.addEventListener('keydown', e => {
  if (!recording) return;
  e.preventDefault();
  if (e.key === 'Escape') {
    recording.kb.classList.remove('rec');
    recording.kb.textContent = S.cfg.hotkeys[recording.field] || 'не задано';
    recording = null;
    return;
  }
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');

  let key = e.key;
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return;
  const MAP = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
  key = MAP[key] || (key.length === 1 ? key.toUpperCase() : key);
  if (!mods.length) { toast('Нужно с Ctrl или Alt, иначе перехватит всю систему'); return; }

  const accel = mods.concat(key).join('+');
  S.cfg.hotkeys[recording.field] = accel;
  recording.kb.classList.remove('rec');
  recording.kb.textContent = accel;
  recording = null;
  window.api.settings.set({ hotkeys: S.cfg.hotkeys });
  toast('Записал: ' + accel);
}, true);

// все три возвращают функцию, которая перерисует контрол под текущие настройки
function bindSwitch(id, get, set) {
  const inp = $(id);
  const paint = () => { inp.checked = !!get(); };
  paint();
  inp.onchange = () => set(inp.checked);
  return paint;
}

// ряд кнопок, где выбран ровно один вариант
function bindPick(id, get, set) {
  const box = $(id);
  const btns = [...box.querySelectorAll('button')];
  const paint = () => btns.forEach(b => b.classList.toggle('on', b.dataset.v === get()));
  btns.forEach(b => b.onclick = () => { set(b.dataset.v); paint(); });
  paint();
  return paint;
}

function bindRange(id, get, set, fmt) {
  const inp = $(id), out = $(id + '-v');
  const show = v => { if (out) out.textContent = fmt ? fmt(v) : v; };
  const paint = () => { inp.value = get(); show(Number(inp.value)); };
  paint();
  inp.oninput = () => { const v = Number(inp.value); show(v); set(v); };
  return paint;
}

/* ---- конфиденциальность ---- */
const POLICY_URL = 'https://claude.ai/code/artifact/12fe6d53-2d3a-45e2-8c40-c4ee14b0acb4/privacy.html';

// список показывает не только что умеет уходить наружу, но и что включено сейчас
function renderPrivacy() {
  const box = $('priv');
  if (!box) return;
  const d = S.cfg.discord || {};

  const rows = [
    ['lrclib.net', 'артист, название и длительность — чтобы найти текст песни',
      S.cfg.lyrics ? 'on' : 'off'],
    ['Deezer и iTunes', 'артист и название — обложки, альбом, год, отрывок на 30 секунд',
      (S.cfg.artwork || {}).on !== false ? 'on' : 'off'],
    ['YouTube и SoundCloud', 'их встроенный плеер со своими куками — только когда включаешь трек оттуда',
      'ask'],
    ['yt-dlp → YouTube', 'поисковый запрос и адрес видео — только когда сам ищешь или качаешь',
      DL.ok ? 'ask' : 'off'],
    ['Куки браузера', S.cfg.dlCookies
      ? `читаются из ${S.cfg.dlCookies} на этом компьютере и уходят только на YouTube`
      : 'браузер не выбран — куки не читаются',
      S.cfg.dlCookies ? 'on' : 'off'],
    ['Discord', 'название и артист играющего трека',
      (d.on && d.clientId) ? 'on' : 'off'],
    ['Проверка обновлений', 'номер твоей версии — чтобы узнать, вышла ли новее',
      (S.cfg.updates || {}).on !== false ? 'on' : 'off'],
    ['Чужие плееры', 'читается механизмом Windows, наружу не уходит',
      (S.cfg.smtc || {}).on !== false ? 'local' : 'off']
  ];

  const label = { on: 'включено', off: 'выключено', ask: 'по запросу', local: 'не выходит наружу' };

  box.textContent = '';
  for (const [name, what, state] of rows) {
    const i = el('div', 'priv-i');
    const m = el('div', 'priv-m');
    const n = el('div', 'priv-n'); n.textContent = name;
    const w = el('div', 'priv-d'); w.textContent = what;
    m.append(n, w);
    const s = el('span', 'priv-s' + (state === 'on' ? ' on' : state === 'ask' ? ' ask' : ''));
    s.textContent = label[state];
    i.append(m, s);
    box.appendChild(i);
  }

  const old = box.parentElement.querySelector('.priv-never');
  if (old) old.remove();

  const never = el('div', 'priv-never');
  never.innerHTML = '<b>Не отправляется никогда:</b> сами аудиофайлы, пути и имена файлов, '
    + 'список того, что лежит на диске, имя пользователя Windows, история прослушиваний и аналитика.';
  box.parentElement.insertBefore(never, box.nextSibling);
}

/* ---- скачивание ---- */
async function loadDlStatus() {
  const st = await window.api.dl.status();
  DL.ok = !!st.ok;
  DL.folder = st.folder || '';
  DL.version = st.version || '';
  DL.error = st.error || '';
  paintDl();
  renderPrivacy();
  // yt-dlp нашёлся уже после отрисовки результатов - показываем кнопки скачивания
  if (sqResults.length) renderSearch();
}

/* ---------- первый запуск ---------- */

function helloState(msg, bad) {
  const n = $('hello-state');
  if (!n) return;
  n.textContent = msg || '';
  n.classList.toggle('bad', !!bad);
}

function helloBusy(on) {
  for (const id of ['hello-local', 'hello-net']) $(id).disabled = on;
}

function closeHello() {
  $('hello').hidden = true;
  S.cfg.welcomed = true;
  window.api.settings.set({ welcomed: true });
}

function wireHello() {
  // своя музыка: папка, сканирование и сразу в библиотеку
  $('hello-local').onclick = async () => {
    helloBusy(true);
    helloState('жду, пока выберешь папку…');
    S.cfg.folders = await window.api.lib.pick();

    if (!S.cfg.folders.length) {
      helloBusy(false);
      helloState('папку так и не выбрали — можно нажать ещё раз');
      return;
    }

    helloState('читаю файлы…');
    renderFolders();
    closeHello();
    go('library');
    await scan();
  };

  // своей музыки нет: ставим yt-dlp и открываем поиск
  $('hello-net').onclick = async () => {
    helloBusy(true);

    if (!DL.ok) {
      helloState('качаю yt-dlp, это займёт полминуты…');
      const off = window.api.dl.onInstall(p => {
        if (p !== null) helloState('качаю yt-dlp — ' + p + '%');
      });
      const r = await window.api.dl.install();
      if (off) off();

      if (r.error) {
        helloBusy(false);
        helloState('не вышло: ' + r.error + ' — можно поставить позже в настройках', true);
        return;
      }
      await loadDlStatus();
    }

    closeHello();
    go('search');
    $('sm-yt').click();
    setTimeout(() => $('sq').focus(), 120);
    toast('Впиши исполнителя или название — найду и скачаю');
  };

  $('hello-skip').onclick = () => { closeHello(); go('settings'); };
}

function maybeHello() {
  // показываем только тому, у кого ещё ничего нет
  if (S.cfg.welcomed || S.cfg.folders.length || S.tracks.length) return false;
  $('hello').hidden = false;
  helloState('');
  helloBusy(false);
  return true;
}

/* ---------- обновления ---------- */

const UPD = { state: 'idle', version: '', next: '', percent: 0, error: '' };

function paintUpd() {
  const t = $('upd-text'), b = $('upd-act');
  if (!t || !b) return;

  const v = UPD.version ? 'версия ' + UPD.version : '';
  const texts = {
    dev:         v + ' — запущено из исходников, обновлять нечего',
    idle:        v,
    checking:    v + ' — проверяю…',
    none:        v + ' — это последняя',
    found:       'вышла версия ' + UPD.next + ', у тебя ' + UPD.version,
    downloading: 'качаю ' + UPD.next + ' — ' + UPD.percent + '%',
    ready:       'версия ' + UPD.next + ' скачана, осталось перезапустить',
    error:       'не проверилось: ' + UPD.error
  };
  t.textContent = texts[UPD.state] || v;

  const labels = {
    checking: 'Проверяю…',
    found: 'Скачать',
    downloading: UPD.percent + '%',
    ready: 'Перезапустить'
  };
  b.textContent = labels[UPD.state] || 'Проверить';
  b.disabled = UPD.state === 'checking' || UPD.state === 'downloading';
  b.hidden = UPD.state === 'dev';
  t.parentElement.style.opacity = UPD.state === 'found' || UPD.state === 'ready' ? '1' : '.6';
}

function wireUpdates() {
  window.api.upd.onState(s => { Object.assign(UPD, s || {}); paintUpd(); });

  $('upd-act').onclick = () => {
    if (UPD.state === 'found') { window.api.upd.download(); UPD.state = 'downloading'; UPD.percent = 0; paintUpd(); return; }
    if (UPD.state === 'ready') { toast('Перезапускаюсь…'); window.api.upd.install(); return; }
    window.api.upd.check();
    UPD.state = 'checking';
    paintUpd();
  };

  window.api.upd.state().then(s => { Object.assign(UPD, s || {}); paintUpd(); }).catch(() => {});
}

/* ---------- бэкап библиотеки ---------- */

function wireBackup() {
  const info = $('bk-info');
  const busy = on => { $('bk-save').disabled = on; $('bk-load').disabled = on; };

  $('bk-save').onclick = async () => {
    busy(true);
    const r = await window.api.backup.save();
    busy(false);
    if (r.canceled) return;
    if (r.error) { info.textContent = 'Не сохранилось: ' + r.error; return; }
    info.textContent = `Сохранено: ${r.tracks} треков, ${r.playlists} плейлистов, ${r.favorites} в избранном → ${r.file}`;
    toast('Бэкап сохранён');
  };

  $('bk-load').onclick = async () => {
    busy(true);
    info.textContent = 'читаю файл…';
    const r = await window.api.backup.load();
    busy(false);

    if (r.canceled) { info.textContent = 'Отменено'; return; }
    if (r.error) { info.textContent = 'Не вышло: ' + r.error; return; }

    const bits = [`вернул ${r.restored} треков`];
    if (r.added) bits.push(`${r.added} добавил заново`);
    if (r.missing) bits.push(`${r.missing} не нашёл на диске`);
    if (r.playlists) bits.push(`${r.playlists} плейлистов`);
    info.textContent = bits.join(', ') + '. Перезапускаю окно…';

    toast('Восстановлено — обновляю');
    try { audio.pause(); } catch {}
    setTimeout(() => location.reload(), 1400);
  };

  window.api.backup.onProgress(p => {
    if (p) info.textContent = `восстанавливаю ${p.done} из ${p.total}…`;
  });
}

function paintDl() {
  const t = $('dl-text');
  if (!t) return;

  if (DL.busy) t.textContent = DL.busy;
  else if (DL.ok) t.textContent = `yt-dlp ${DL.version} — скачивание работает`;
  else if (DL.error) t.textContent = 'yt-dlp найден, но не запускается: ' + DL.error;
  else t.textContent = 'yt-dlp не найден — без него не работает поиск по YouTube';
  t.parentElement.style.opacity = DL.ok && !DL.busy ? '1' : '.6';

  const g = $('dl-get');
  if (g) {
    g.textContent = DL.ok ? 'Обновить yt-dlp' : 'Скачать yt-dlp';
    g.disabled = !!DL.busy;
  }

  const p = $('dl-path');
  if (p) { p.textContent = DL.folder || 'папка не выбрана'; p.title = DL.folder || ''; }
  const f = $('dl-fold');
  if (f) f.hidden = !DL.ok;
}

function wireYtdlpGet() {
  const g = $('dl-get');
  if (!g) return;

  window.api.dl.onInstall(p => {
    DL.busy = p === null ? '' : `качаю yt-dlp… ${p}%`;
    paintDl();
  });

  g.onclick = async () => {
    DL.busy = 'связываюсь с github…';
    paintDl();

    const r = await window.api.dl.install();
    DL.busy = '';

    if (r.error) {
      paintDl();
      toast('Не вышло: ' + r.error);
      return;
    }

    await loadDlStatus();
    toast(`yt-dlp ${r.version || ''} готов — ${Math.round(r.size / 1048576)} МБ`);
  };
}

/* ---- эквалайзер ---- */
const fmtDb = v => (v > 0 ? '+' : '') + (Math.round(v * 10) / 10);
let eqSaveT = null;
const saveEq = () => {
  clearTimeout(eqSaveT);
  eqSaveT = setTimeout(() => window.api.settings.set({ eq: S.cfg.eq }), 250);
};

function renderEq(onManual) {
  const box = $('eqbars');
  box.textContent = '';
  const g = S.cfg.eq.gains;

  EQ_FREQ.forEach((f, i) => {
    const b = el('div', 'eqb');
    const val = el('u');
    const inp = document.createElement('input');
    const lab = el('b');

    inp.type = 'range'; inp.min = -12; inp.max = 12; inp.step = 0.5;
    inp.value = g[i] ?? 0;
    lab.textContent = f >= 1000 ? (f / 1000) + 'k' : f;
    val.textContent = fmtDb(g[i] || 0);
    b.classList.toggle('hot', Math.abs(g[i] || 0) > 0.01);

    const setv = v => {
      v = Math.max(-12, Math.min(12, v));
      g[i] = v;
      inp.value = v;
      val.textContent = fmtDb(v);
      b.classList.toggle('hot', Math.abs(v) > 0.01);
      applyEq();
      saveEq();
      onManual && onManual();
    };
    inp.oninput = () => setv(Number(inp.value));
    inp.ondblclick = () => setv(0);
    inp.onwheel = e => { e.preventDefault(); setv(Number(inp.value) + (e.deltaY < 0 ? 0.5 : -0.5)); };

    b.append(val, inp, lab);
    box.appendChild(b);
  });
}

function wireEq() {
  if (!S.cfg.eq || typeof S.cfg.eq !== 'object') S.cfg.eq = { on: false, preset: 'flat' };
  const e = S.cfg.eq;
  if (!Array.isArray(e.gains) || e.gains.length !== 10) e.gains = EQ_PRESETS.flat.slice();

  let pEq, swEq;
  // ручная правка полосы превращает пресет в свой
  const manual = () => {
    if (e.preset !== 'custom') { e.preset = 'custom'; pEq && pEq(); }
    if (!e.on) { e.on = true; applyEq(); swEq && swEq(); }
  };

  renderEq(manual);

  pEq = bindPick('p-eq', () => e.preset || 'flat', v => {
    e.preset = v;
    e.gains = (EQ_PRESETS[v] || EQ_PRESETS.flat).slice();
    if (v !== 'flat') e.on = true;
    renderEq(manual);
    applyEq();
    swEq && swEq();
    window.api.settings.set({ eq: e });
  });

  swEq = bindSwitch('s-eqon', () => e.on, v => {
    e.on = v;
    applyEq();
    window.api.settings.set({ eq: e });
    toast(v ? 'Эквалайзер включён' : 'Эквалайзер выключен');
  });
}

/* ---- таймер сна ---- */
const SLEEP = { at: 0, mode: '0', timer: null };
let sleepRepaint = null;

function setSleep(v, quiet) {
  clearInterval(SLEEP.timer);
  SLEEP.timer = null;
  SLEEP.mode = String(v);
  audio.volume = audio.muted ? 0 : S.cfg.volume;

  if (SLEEP.mode === '0') {
    SLEEP.at = 0;
    $('sleep-chip').classList.remove('on');
    if (!quiet) toast('Таймер отменён');
    return;
  }
  if (SLEEP.mode === 'track') {
    SLEEP.at = 0;
    $('sleep-chip').classList.add('on');
    $('sleep-left').textContent = 'до конца';
    if (!quiet) toast('Выключусь в конце трека');
    return;
  }

  const min = Number(SLEEP.mode) || 0;
  SLEEP.at = Date.now() + min * 60000;
  $('sleep-chip').classList.add('on');
  SLEEP.timer = setInterval(tickSleep, 500);
  tickSleep();
  if (!quiet) toast(`Выключусь через ${min} мин`);
}

function tickSleep() {
  if (!SLEEP.at) return;
  const left = SLEEP.at - Date.now();
  if (left <= 0) { sleepNow(); return; }
  $('sleep-left').textContent = fmt(left / 1000);
  // последние полминуты уводим громкость в ноль, чтобы не обрывало резко
  const FADE = 30000;
  if (left < FADE) audio.volume = (audio.muted ? 0 : S.cfg.volume) * (left / FADE);
}

function sleepNow() {
  audio.pause();
  setSleep(0, true);
  sleepRepaint && sleepRepaint();
  toast('Таймер сработал — музыка выключена');
}

/* ---- перетаскивание файлов в окно ---- */
let dragDepth = 0;

function wireDrop() {
  const box = $('drop');
  addEventListener('dragenter', e => {
    e.preventDefault();
    if (++dragDepth === 1) box.classList.add('on');
  });
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; box.classList.remove('on'); } });

  addEventListener('drop', async e => {
    e.preventDefault();
    dragDepth = 0;
    box.classList.remove('on');

    const paths = [...(e.dataTransfer?.files || [])]
      .map(f => window.api.pathForFile(f))
      .filter(Boolean);
    if (!paths.length) return;

    const { dirs, tracks } = await window.api.lib.drop(paths);

    if (dirs.length) {
      S.cfg.folders = [...new Set([...(S.cfg.folders || []), ...dirs])];
      renderFolders();
      toast(dirs.length === 1 ? 'Папка добавлена, собираю библиотеку' : 'Папки добавлены, собираю библиотеку');
      await scan();
    }

    if (tracks.length) {
      // не в библиотеке - подкидываем в память, чтобы сыграть прямо сейчас
      const have = new Set(S.tracks.map(t => t.id));
      const fresh = tracks.filter(t => !have.has(t.id));
      if (fresh.length) S.tracks = S.tracks.concat(fresh);
      setQueue(tracks.map(t => t.id));
      go('library');
      renderRows();
      play(tracks[0]);
      if (!dirs.length) toast(tracks.length === 1 ? 'Играю' : `Играю ${tracks.length} треков`);
    } else if (!dirs.length) {
      toast('Музыки в этом не нашёл');
    }
  });
}

/* ---- вкладка "Темы" ---- */
const PALETTE = ['#9b8cff', '#ff4fd8', '#ff8a3d', '#4ff0c0', '#57a6ff', '#ff5c5c', '#ffd93d', '#e8e6ef'];
let repaintTheme = null;

function wireThemes() {
  renderPresets();
  renderProfiles();

  const th = () => (S.cfg.theme = S.cfg.theme || {});
  // правка руками сбивает отметку с готовой темы - это уже своя
  const setTheme = (patch, manual = true) => {
    Object.assign(th(), patch);
    window.api.settings.set({ theme: patch });
    applyTheme();
    if (manual) offPreset();
  };

  const fUi = renderFonts('f-ui', () => th().fontUi || 'system', v => setTheme({ fontUi: v }));
  const fLy = renderFonts('f-ly', () => th().fontLy || 'system', v => {
    setTheme({ fontLy: v });
    // другой шрифт - другая высота строк, текст надо подвести заново
    requestAnimationFrame(() => centerLyrics(LY.cur, true));
  });

  const pLay  = bindPick('p-lay',  () => th().layout || 'stack', v => setLayout(v));
  const pViz  = bindPick('p-viz',  () => th().viz  || 'ring',  v => setTheme({ viz: v }));
  const pDisc = bindPick('p-disc', () => th().disc || 'vinyl', v => setTheme({ disc: v }));
  const pBg   = bindPick('p-bg',   () => th().bg   || 'cover', v => { setTheme({ bg: v }); paintVid(); });

  const pAuto = bindPick('p-vizauto', () => String(th().vizAuto || 'off'),
                         v => setTheme({ vizAuto: v }));

  const rPow  = bindRange('r-vizpower', () => th().vizPower ?? 100,
                          v => setTheme({ vizPower: v }), v => v + '%');
  const rSpd  = bindRange('r-vizspeed', () => th().vizSpeed ?? 100,
                          v => setTheme({ vizSpeed: v }), v => v + '%');
  const rAl   = bindRange('r-vizalpha', () => th().vizAlpha ?? 100,
                          v => setTheme({ vizAlpha: v }), v => v + '%');
  const rBlur = bindRange('r-blur', () => th().bgBlur ?? 80,
                          v => setTheme({ bgBlur: v }), v => v + ' px');
  const rDim  = bindRange('r-dim',  () => th().bgDim ?? 42,
                          v => setTheme({ bgDim: v }), v => v + ' %');

  const swSpin = bindSwitch('s-spin', () => th().spin !== false, v => setTheme({ spin: v }));
  const swBeat = bindSwitch('s-beat', () => th().beat !== false, v => setTheme({ beat: v }));

  const swPx = bindSwitch('s-px', () => S.cfg.particles, v => {
    S.cfg.particles = v;
    window.api.settings.set({ particles: v });
    $('px').style.display = v ? '' : 'none';
    offPreset();
  });
  const swAc = bindSwitch('s-accent', () => S.cfg.accent, v => {
    S.cfg.accent = v;
    window.api.settings.set({ accent: v });
    accentFrom(coverUrl(S.track));
    offPreset();
  });

  // палитра: свой цвет главнее автоподбора под обложку
  function paintPal() {
    const box = $('pal');
    box.textContent = '';
    const cur = (th().accentColor || '').toLowerCase();

    const auto = el('button', 'auto' + (cur ? '' : ' on'));
    auto.title = 'из обложки';
    auto.onclick = () => { setTheme({ accentColor: '' }); paintPal(); };
    box.appendChild(auto);

    for (const c of PALETTE) {
      const b = el('button', cur === c ? 'on' : '');
      b.style.background = c;
      b.title = c;
      b.onclick = () => { setTheme({ accentColor: c }); paintPal(); };
      box.appendChild(b);
    }
  }
  paintPal();

  function paintVid() {
    const on = th().bg === 'video';
    $('vid-box').hidden = !on;
    $('vid-path').textContent = S.cfg.videoFolder || 'папка не выбрана';
    $('vid-path').title = S.cfg.videoFolder || '';
    if (on) loadVideoList();

    const byUrl = th().bg === 'url';
    $('url-box').hidden = !byUrl;
    if ($('s-bgurl').value !== (th().bgUrl || '')) $('s-bgurl').value = th().bgUrl || '';
    if (byUrl) checkBgUrl(); else urlState('');
  }

  $('s-bgurl').onchange = () => {
    const v = $('s-bgurl').value.trim();
    setTheme({ bgUrl: v });
    VID.url = '';                 // ссылка поменялась - ролик перезапускаем
    applyBg();
    applyVideoBg();
    checkBgUrl();
  };

  $('vid-pick').onclick = async () => {
    S.cfg.videoFolder = await window.api.video.pick();
    VID.cur = null;
    paintVid();
    applyVideoBg();
  };
  $('vid-clear').onclick = async () => {
    S.cfg.videoFolder = await window.api.video.clear();
    VID.list = []; VID.cur = null;
    for (const v of [$('vid-a'), $('vid-b')]) { v.classList.remove('on'); v.pause(); }
    paintVid();
  };
  paintVid();

  repaintTheme = () => {
    fUi(); fLy(); paintPal();
    pLay(); pViz(); pDisc(); pBg(); pAuto();
    rPow(); rSpd(); rAl(); rBlur(); rDim();
    swSpin(); swBeat(); swPx(); swAc();
    paintVid(); renderPresets(); renderProfiles();
  };
}

// смена темы меняет размеры строк - надо заново подвести текущую к середине
function applyLyStyle() {
  lyClasses();
  requestAnimationFrame(() => centerLyrics(LY.cur, true));
}

function wireSettings() {
  renderFolders();
  renderKeys();

  $('add-folder').onclick = $('add-first').onclick = async () => {
    S.cfg.folders = await window.api.lib.pick();
    renderFolders();
    if (S.cfg.folders.length) scan();
  };
  $('rescan').onclick = $('rescan2').onclick = scan;

  $('fix-tags').onclick = async () => {
    const b = $('fix-tags');
    b.disabled = true;
    const res = await window.api.search.fixTags();
    b.disabled = false;
    b.textContent = 'Подобрать теги';

    S.tracks = res.tracks || S.tracks;
    if (S.track) {
      const t = S.tracks.find(x => x.id === S.track.id);
      if (t) { S.track = t; paintTrack(t); loadLyrics(t); }
    }
    renderChips();
    renderRows();
    renderQueue();
    toast(res.fixed ? `Уточнил ${res.fixed} из ${res.checked}` : 'Подходящего в каталоге не нашлось');
  };

  window.api.search.onProgress(p => {
    $('fix-tags').textContent = p ? `ищу… ${p.done + 1}/${p.total}` : 'Подобрать теги';
  });

  bindSwitch('s-lyrics', () => S.cfg.lyrics, v => {
    S.cfg.lyrics = v; window.api.settings.set({ lyrics: v });
    if (S.track) loadLyrics(S.track);
  });
  $('s-lyoff').value = S.cfg.lyricsOffset || 0;
  $('s-lyoff').onchange = () => {
    S.cfg.lyricsOffset = Number($('s-lyoff').value) || 0;
    LY.cur = -2;
    window.api.settings.set({ lyricsOffset: S.cfg.lyricsOffset });
  };

  bindPick('p-theme', () => S.cfg.lyricsTheme || 'soft', v => {
    S.cfg.lyricsTheme = v;
    window.api.settings.set({ lyricsTheme: v });
    applyLyStyle();
  });
  bindPick('p-size', () => S.cfg.lyricsSize || 'md', v => {
    S.cfg.lyricsSize = v;
    window.api.settings.set({ lyricsSize: v });
    applyLyStyle();
  });
  bindSwitch('s-lyglow', () => S.cfg.lyricsGlow !== false, v => {
    S.cfg.lyricsGlow = v; window.api.settings.set({ lyricsGlow: v }); applyLyStyle();
  });
  bindSwitch('s-lyblur', () => S.cfg.lyricsBlur !== false, v => {
    S.cfg.lyricsBlur = v; window.api.settings.set({ lyricsBlur: v }); applyLyStyle();
  });

  $('s-ytkey').value = S.cfg.ytKey || '';
  $('s-ytkey').onchange = () => {
    S.cfg.ytKey = $('s-ytkey').value.trim();
    window.api.settings.set({ ytKey: S.cfg.ytKey });
    toast(S.cfg.ytKey ? 'Ключ сохранён — поиск по YouTube включён' : 'Ключ убран');
  };

  $('s-cookies').value = S.cfg.dlCookies || '';
  $('s-cookies').onchange = () => {
    S.cfg.dlCookies = $('s-cookies').value;
    window.api.settings.set({ dlCookies: S.cfg.dlCookies });
    renderPrivacy();
    toast(S.cfg.dlCookies
      ? 'Беру куки из браузера — закрой его перед скачиванием'
      : 'Куки больше не используются');
  };

  renderPrivacy();
  $('priv-data').onclick = () => window.api.openUserData();
  $('priv-full').onclick = () => window.api.openExternal(POLICY_URL);

  wireBackup();

  paintDl();
  wireYtdlpGet();
  $('dl-pick').onclick = async () => {
    const f = await window.api.dl.pickFolder();
    if (f) { DL.folder = f; paintDl(); }
  };

  wireEq();
  sleepRepaint = bindPick('p-sleep', () => SLEEP.mode, v => setSleep(v));
  $('sleep-chip').onclick = () => { setSleep(0); sleepRepaint(); };

  bindSwitch('s-hk', () => S.cfg.hotkeys.on, v => {
    S.cfg.hotkeys.on = v; window.api.settings.set({ hotkeys: { on: v } });
  });
  bindSwitch('s-mk', () => S.cfg.hotkeys.mediaKeys, v => {
    S.cfg.hotkeys.mediaKeys = v; window.api.settings.set({ hotkeys: { mediaKeys: v } });
  });
  wireUpdates();
  bindSwitch('s-upd', () => S.cfg.updates?.on !== false, v => {
    S.cfg.updates = S.cfg.updates || {};
    S.cfg.updates.on = v;
    window.api.settings.set({ updates: { on: v } });
    renderPrivacy();
  });

  bindSwitch('s-smtc', () => S.cfg.smtc.on, v => {
    S.cfg.smtc.on = v; window.api.settings.set({ smtc: { on: v } });
  });
  bindSwitch('s-art', () => S.cfg.artwork.on, v => {
    S.cfg.artwork.on = v; window.api.settings.set({ artwork: { on: v } });
  });

  bindSwitch('s-dc', () => S.cfg.discord.on, v => {
    S.cfg.discord.on = v; window.api.settings.set({ discord: { on: v } });
  });
  bindSwitch('s-dcsys', () => S.cfg.discord.showSystem, v => {
    S.cfg.discord.showSystem = v; window.api.settings.set({ discord: { showSystem: v } });
  });
  bindSwitch('s-dcidle', () => S.cfg.discord.idleHide, v => {
    S.cfg.discord.idleHide = v; window.api.settings.set({ discord: { idleHide: v } });
  });
  $('s-dcid').value = S.cfg.discord.clientId || '';
  $('s-dcid').onchange = () => {
    const id = $('s-dcid').value.trim();
    S.cfg.discord.clientId = id;
    window.api.settings.set({ discord: { clientId: id } });
  };
  $('dc-retry').onclick = async () => { paintDiscord(await window.api.discord.reconnect()); };

  document.querySelectorAll('[data-ext]').forEach(a => {
    a.onclick = e => { e.preventDefault(); window.api.openExternal(a.dataset.ext); };
  });
}

function paintDiscord(s) {
  const e = $('dc-state');
  if (!s || !s.on) { e.textContent = 'выключено'; e.className = 'dc-state'; return; }
  if (s.ready) { e.textContent = 'подключено'; e.className = 'dc-state ok'; return; }
  e.textContent = s.error ? 'дискорд не отвечает — запущен?' : 'подключаюсь…';
  e.className = 'dc-state' + (s.error ? ' err' : '');
}
window.api.discord.onState(paintDiscord);

/* ===================== кнопки ===================== */
$('w-min').onclick = () => window.api.win.min();
$('w-max').onclick = () => window.api.win.max();
$('w-close').onclick = () => window.api.win.close();

$('c-play').onclick = toggle;
$('c-next').onclick = () => step(1);
$('c-prev').onclick = () => {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  step(-1);
};
$('c-shuffle').onclick = () => {
  S.cfg.shuffle = !S.cfg.shuffle;
  $('c-shuffle').classList.toggle('act', S.cfg.shuffle);
  buildOrder();
  window.api.settings.set({ shuffle: S.cfg.shuffle });
  toast(S.cfg.shuffle ? 'Перемешано' : 'По порядку');
};
$('c-repeat').onclick = () => {
  const next = { off: 'all', all: 'one', one: 'off' }[S.cfg.repeat] || 'all';
  S.cfg.repeat = next;
  $('c-repeat').classList.toggle('act', next !== 'off');
  $('rep-one').hidden = next !== 'one';
  window.api.settings.set({ repeat: next });
  toast({ off: 'Без повтора', all: 'Повтор списка', one: 'Повтор трека' }[next]);
};
$('c-ly').onclick = () => go('now');
$('c-mute').onclick = () => {
  audio.muted = !audio.muted;
  audio.volume = audio.muted ? 0 : S.cfg.volume;
  show($('ic-vol'), !audio.muted);
  show($('ic-mute'), audio.muted);
};

/* --- скорость --- */
const rateLabel = v => (Math.round(v * 100) / 100).toString().replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') + '×';

function applyPitch() {
  // preservesPitch = false -> тон едет вместе со скоростью, это и есть slowed
  const keep = !S.cfg.ratePitch;
  for (const k of ['preservesPitch', 'mozPreservesPitch', 'webkitPreservesPitch']) {
    try { audio[k] = keep; } catch {}
  }
}

function setRate(v, save = true) {
  v = Math.max(0.5, Math.min(2, Math.round(v * 100) / 100));
  S.cfg.rate = v;
  audio.playbackRate = v;
  audio.defaultPlaybackRate = v;
  applyPitch();

  $('c-rate').textContent = rateLabel(v);
  $('c-rate').classList.toggle('act', v !== 1);
  $('r-rate').value = Math.round(v * 100);
  $('r-rate-v').textContent = v.toFixed(2) + '×';
  $('rate-grid').querySelectorAll('button')
    .forEach(b => b.classList.toggle('on', Number(b.dataset.v) === v));

  if (save) window.api.settings.set({ rate: v });
}

function wireRate() {
  setRate(S.cfg.rate || 1, false);

  $('c-rate').onclick = e => {
    e.stopPropagation();
    show($('rate-pop'), $('rate-pop').hasAttribute('hidden'));
  };
  addEventListener('click', e => {
    if (!e.target.closest('.rate-wrap')) show($('rate-pop'), false);
  });
  $('rate-grid').querySelectorAll('button')
    .forEach(b => b.onclick = () => setRate(Number(b.dataset.v)));
  $('r-rate').oninput = () => setRate(Number($('r-rate').value) / 100);

  bindSwitch('s-pitch', () => S.cfg.ratePitch, v => {
    S.cfg.ratePitch = v;
    window.api.settings.set({ ratePitch: v });
    applyPitch();
    toast(v ? 'Тон едет за скоростью' : 'Тон держится');
  });
}

/* --- текст на весь экран --- */
let peekT = null;

function toggleFull(on) {
  const want = on === undefined ? !document.body.classList.contains('full') : !!on;
  document.body.classList.toggle('full', want);
  document.body.classList.remove('peek');
  window.api.win.full(want);
  if (want) go('now');
  $('full-btn').title = want ? 'вернуть обычный вид (Esc)' : 'текст на весь экран (F)';
  setTimeout(() => { sizeViz(); centerLyrics(LY.cur, true); }, 430);
}

$('full-btn').onclick = () => toggleFull();
$('lay-btn').onclick = () => cycleLayout();

// в полном экране панели уезжают, но возвращаются, если поводить мышкой
addEventListener('mousemove', () => {
  if (!document.body.classList.contains('full')) return;
  document.body.classList.add('peek');
  clearTimeout(peekT);
  peekT = setTimeout(() => document.body.classList.remove('peek'), 2200);
});

/* --- поиск --- */
$('q').addEventListener('input', () => {
  S.filter = $('q').value;
  $('q-x').hidden = !S.filter;
  $('lib-scroll').scrollTop = 0;
  renderRows();
});
$('q-x').onclick = () => { $('q').value = ''; S.filter = ''; $('q-x').hidden = true; renderRows(); $('q').focus(); };

/* --- перемотка и громкость мышью --- */
function draggable(node, onSet) {
  const calc = e => {
    const r = node.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };
  node.addEventListener('pointerdown', e => {
    node.setPointerCapture(e.pointerId);
    node.classList.add('drag');
    onSet(calc(e), false);
    const move = ev => onSet(calc(ev), false);
    const up = ev => {
      node.classList.remove('drag');
      onSet(calc(ev), true);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
  });
}

draggable($('seek'), (p, done) => {
  const d = curDur();
  if (!d) return;
  S.seeking = !done;
  $('seek-fill').style.width = p * 100 + '%';
  $('seek-knob').style.left = p * 100 + '%';
  $('t-cur').textContent = fmt(p * d);
  if (done) {
    LY.cur = -2;
    if (S.source === 'local') audio.currentTime = p * d;
    else streamSeek(p * d);
  }
});
draggable(document.querySelector('.vol'), p => {
  if (audio.muted) { audio.muted = false; show($('ic-vol'), true); show($('ic-mute'), false); }
  setVolume(p);
});
document.querySelector('.vol').addEventListener('wheel', e => {
  e.preventDefault();
  setVolume(S.cfg.volume + (e.deltaY < 0 ? 0.05 : -0.05));
}, { passive: false });

function seekBy(sec) {
  const d = curDur();
  if (!d) return;
  const to = Math.max(0, Math.min(d, curTime() + sec));
  LY.cur = -2;
  if (S.source === 'local') { if (S.track) audio.currentTime = to; }
  else streamSeek(to);
}

/* --- клавиатура --- */
window.addEventListener('keydown', e => {
  if (recording) return;
  const typing = /INPUT|TEXTAREA/.test(e.target.tagName);
  if (typing) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  switch (e.key) {
    case 'Escape':
      if (!$('rate-pop').hasAttribute('hidden')) show($('rate-pop'), false);
      else if (document.body.classList.contains('full')) toggleFull(false);
      break;
    case ' ': e.preventDefault(); toggle(); break;
    case 'ArrowRight': seekBy(5); break;
    case 'ArrowLeft': seekBy(-5); break;
    case 'ArrowUp': e.preventDefault(); setVolume(S.cfg.volume + 0.05); break;
    case 'ArrowDown': e.preventDefault(); setVolume(S.cfg.volume - 0.05); break;
    case 'f': case 'F': case 'а': case 'А':
      e.preventDefault();
      if (e.ctrlKey) { go('library'); $('q').focus(); }
      else toggleFull();
      break;
    case 'l': case 'L': case 'д': case 'Д':
      if (e.ctrlKey || e.altKey) break;
      e.preventDefault();
      cycleLayout();
      break;
    case 'n': case 'N': if (e.ctrlKey) step(1); break;
    case 'p': case 'P': if (e.ctrlKey) step(-1); break;
  }
});

window.api.onHotkey(what => {
  if (what === 'playpause') toggle();
  else if (what === 'next') step(1);
  else if (what === 'prev') step(-1);
  else if (what === 'volup') setVolume(S.cfg.volume + 0.05);
  else if (what === 'voldown') setVolume(S.cfg.volume - 0.05);
});

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  try {
    ms.setActionHandler('play', () => audio.play());
    ms.setActionHandler('pause', () => audio.pause());
    ms.setActionHandler('nexttrack', () => step(1));
    ms.setActionHandler('previoustrack', () => step(-1));
  } catch {}
}

window.api.win.onMax(() => {});

/* ===================== визуализация ===================== */
const vizC = $('viz'), vizX = vizC.getContext('2d');
const miniC = $('mini-eq'), miniX = miniC.getContext('2d');
let vw = 0, vh = 0;
let geo = { cx: 0, cy: 0, r: 90 };
let beatSm = 0;

function sizeViz() {
  const view = $('v-now');
  const w = view.clientWidth, h = view.clientHeight;
  if (!w || !h) return;
  vw = w; vh = h;
  const d = Math.min(2, devicePixelRatio || 1);
  vizC.width = w * d; vizC.height = h * d;
  vizC.style.width = w + 'px'; vizC.style.height = h + 'px';
  vizX.setTransform(d, 0, 0, d, 0, 0);

  miniC.width = 52 * d; miniC.height = 22 * d;
  miniX.setTransform(d, 0, 0, d, 0, 0);
  refreshGeo();
}

// где сейчас центр обложки - считаем редко, каждый кадр это дорого
function refreshGeo() {
  const box = document.querySelector('.disc-box');
  const view = $('v-now');
  if (!view || !view.clientWidth) return;
  const v = view.getBoundingClientRect();
  const b = box ? box.getBoundingClientRect() : null;

  // в раскладке "только текст" обложки нет - тогда крутим вокруг середины экрана,
  // иначе визуализация осталась бы висеть там, где обложка была в прошлый раз
  if (!b || !b.width) {
    geo = { cx: v.width / 2, cy: v.height / 2, r: Math.min(v.width, v.height) * 0.28 };
    return;
  }
  geo = { cx: b.left - v.left + b.width / 2, cy: b.top - v.top + b.height / 2, r: b.width / 2 };
}
setInterval(refreshGeo, 500);
new ResizeObserver(sizeViz).observe($('v-now'));

const BARS = 72, NBARS = 64, NRAD = 168;
const NMIR = 96, NSPI = 230, NBLO = 128;
const smooth = new Float32Array(BARS);
const barSm = new Float32Array(NBARS);
const radSm = new Float32Array(NRAD);
const mirSm = new Float32Array(NMIR);
const spiSm = new Float32Array(NSPI);
const bloSm = new Float32Array(NBLO);
const miniSmooth = new Float32Array(20);
const dust = [];

// приход доли: считается один раз за кадр, пользуются несколько визуализаций
let bassAvg = 0, lastBeat = 0, lastRing = 0, beatNow = false, vizT = 0;

// vizT - настоящее время, по нему ловим доли и его нельзя растягивать.
// vizClock - часы самой анимации: их и замедляет ползунок "скорость"
let vizClock = 0, vizDt = 16.7, vizSpd = 1, vizA = 1, lastFrameAt = 0;
const rings = [];
let fallC = null, fallX = null;
const stars = [];
let gridZ = 0;
const NGRD = 40, grdSm = new Float32Array(NGRD);

function accentRgb() {
  return getComputedStyle(document.documentElement).getPropertyValue('--ac').trim() || '150,140,255';
}

function drawViz() {
  requestAnimationFrame(drawViz);
  tickLyrics();          // здесь, а не в timeupdate - заливка строки должна быть плавной
  if (!vw || !S.cfg) return;

  const th = S.cfg.theme || {};
  const live = !!analyser && !audio.paused;
  if (live) {
    analyser.getByteFrequencyData(freq);
    if (timeData) analyser.getByteTimeDomainData(timeData);
  }

  // бас для пульса обложки и для "пыли"
  let bass = 0;
  if (live && freq) { for (let i = 1; i < 10; i++) bass += freq[i]; bass /= 9 * 255; }
  beatSm += (bass - beatSm) * (bass > beatSm ? 0.5 : 0.07);
  document.documentElement.style.setProperty('--beat',
    th.beat !== false && live ? (1 + beatSm * 0.06).toFixed(4) : '1');

  // доля - это когда бас заметно громче своего же среднего, но не чаще раза в 150 мс
  vizT = performance.now();
  bassAvg += (bass - bassAvg) * 0.035;
  beatNow = live && bass > 0.15 && bass > bassAvg * 1.3 && vizT - lastBeat > 150;
  if (beatNow) lastBeat = vizT;

  const ac = accentRgb();
  const p = Math.max(0.3, (th.vizPower ?? 100) / 100);

  // часы анимации: реальное время, растянутое ползунком скорости
  vizDt = lastFrameAt ? Math.min(50, vizT - lastFrameAt) : 16.7;
  lastFrameAt = vizT;
  vizSpd = Math.max(0.3, (th.vizSpeed ?? 100) / 100);
  vizClock += vizDt * vizSpd;
  vizAutoTick();

  vizX.clearRect(0, 0, vw, vh);
  vizA = Math.min(1, Math.max(0.15, (th.vizAlpha ?? 100) / 100));
  vizX.globalAlpha = vizA;

  const kind = th.viz || 'ring';
  const big = window.VIZ2 && window.VIZ2[kind];
  if (big) {
    big({
      x: vizX, w: vw, h: vh, geo: geo,
      freq: freq, time: timeData, live: live,
      beat: beatSm, hit: beatNow,
      t: vizClock, dt: vizDt * vizSpd, p: p, ac: ac
    });
  } else switch (kind) {
    case 'ring':   vizRing(ac, live, p);   break;
    case 'radial': vizRadial(ac, live, p); break;
    case 'wave':   vizWave(ac, live, p);   break;
    case 'bars':   vizBars(ac, live, p);   break;
    case 'dust':   vizDust(ac, live, p);   break;
    case 'tunnel': vizTunnel(ac, live, p); break;
    case 'fall':   vizFall(ac, live, p);   break;
    case 'mirror': vizMirror(ac, live, p); break;
    case 'spiral': vizSpiral(ac, live, p); break;
    case 'bloom':  vizBloom(ac, live, p);  break;
    case 'warp':   vizWarp(ac, live, p);   break;
    case 'grid':   vizGrid(ac, live, p);   break;
  }

  // холст общий с мини-эквалайзером - прозрачность за собой убираем
  vizX.globalAlpha = 1;
  drawMini(live, ac);
}

/* ---- сама меняет вид ---- */

// "выключить" в переборе не участвует: незачем самим себя гасить
const VIZ_CYCLE = [
  'ring', 'radial', 'tunnel', 'spiral', 'bloom', 'sphere', 'kaleid', 'pulsar',
  'wave', 'bars', 'mirror', 'fall', 'aurora', 'ribbon',
  'dust', 'warp', 'grid', 'rain'
];
let vizAutoAt = 0;

function nextViz(why) {
  const th = S.cfg.theme || (S.cfg.theme = {});
  const cur = th.viz || 'ring';
  let list = VIZ_CYCLE.filter(v => v !== cur);
  if (!list.length) return;
  const v = list[(Math.random() * list.length) | 0];
  th.viz = v;
  window.api.settings.set({ theme: { viz: v } });
  // это не ручная правка, отметку с готовой темы не снимаем
  if (typeof repaintTheme === 'function') repaintTheme();
  if (why === 'timer') toast('Вид: ' + vizName(v));
}

function vizName(v) {
  const b = document.querySelector(`#p-viz button[data-v="${v}"]`);
  return b ? b.textContent : v;
}

function vizAutoTick() {
  const mode = (S.cfg.theme || {}).vizAuto || 'off';
  if (mode === 'off' || mode === 'track') { vizAutoAt = 0; return; }
  const ms = (parseInt(mode, 10) || 60) * 1000;
  if (!vizAutoAt) { vizAutoAt = vizT + ms; return; }
  if (vizT < vizAutoAt) return;
  vizAutoAt = vizT + ms;
  nextViz('timer');
}

// палочки по кругу
function vizRing(ac, live, p) {
  const { cx, cy, r } = geo;
  const out = 30 * p, r0 = r + 5;
  vizX.lineCap = 'round';
  vizX.lineWidth = 2.4;

  for (let i = 0; i < BARS; i++) {
    // зеркалим спектр: низы сверху, к бокам - верхи
    const half = BARS / 2;
    const k = i < half ? i : BARS - 1 - i;
    const idx = Math.floor(Math.pow(k / half, 1.35) * (freq ? freq.length * 0.62 : 1));
    const raw = live && freq ? freq[idx] / 255 : 0;
    smooth[i] += (raw - smooth[i]) * (raw > smooth[i] ? 0.45 : 0.11);

    const len = 2 + smooth[i] * out * 1.18;
    const a = (i / BARS) * Math.PI * 2 - Math.PI / 2;
    const cos = Math.cos(a), sin = Math.sin(a);

    const g = vizX.createLinearGradient(cx + cos * r0, cy + sin * r0,
                                        cx + cos * (r0 + len), cy + sin * (r0 + len));
    g.addColorStop(0, `rgba(${ac},${0.28 + smooth[i] * 0.5})`);
    g.addColorStop(1, `rgba(${ac},0)`);
    vizX.strokeStyle = g;
    vizX.beginPath();
    vizX.moveTo(cx + cos * r0, cy + sin * r0);
    vizX.lineTo(cx + cos * (r0 + len), cy + sin * (r0 + len));
    vizX.stroke();
  }
}

// замкнутая волна вокруг обложки
function vizRadial(ac, live, p) {
  const { cx, cy, r } = geo;
  const r0 = r + 16, amp = 52 * p;

  const ring = (mul, alpha, width) => {
    vizX.beginPath();
    for (let i = 0; i <= NRAD; i++) {
      const t = i % NRAD;
      const rr = r0 + radSm[t] * amp * mul;
      const a = (t / NRAD) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      i ? vizX.lineTo(x, y) : vizX.moveTo(x, y);
    }
    vizX.closePath();
    vizX.strokeStyle = `rgba(${ac},${alpha})`;
    vizX.lineWidth = width;
    vizX.stroke();
  };

  for (let t = 0; t < NRAD; t++) {
    const v = live && timeData ? (timeData[Math.floor(t / NRAD * timeData.length)] - 128) / 128 : 0;
    radSm[t] += (v - radSm[t]) * 0.32;
  }
  ring(1, 0.75, 2);
  ring(1.7, 0.22, 1.2);        // эхо пожиже, для объёма
}

// осциллограмма по низу
function vizWave(ac, live, p) {
  const y0 = vh - 96, amp = Math.min(vh * 0.19, 130) * p;
  const N = 260;

  const line = (mul, alpha, width) => {
    vizX.beginPath();
    for (let i = 0; i <= N; i++) {
      const v = live && timeData ? (timeData[Math.floor(i / N * timeData.length)] - 128) / 128 : 0;
      const x = i / N * vw, y = y0 + v * amp * mul;
      i ? vizX.lineTo(x, y) : vizX.moveTo(x, y);
    }
    vizX.strokeStyle = `rgba(${ac},${alpha})`;
    vizX.lineWidth = width;
    vizX.lineJoin = 'round';
    vizX.stroke();
  };
  line(1, 0.6, 2);
  line(-0.45, 0.18, 1.2);      // отражение
}

// столбики по низу экрана
function vizBars(ac, live, p) {
  const gap = 3;
  const bw = (vw - (NBARS - 1) * gap) / NBARS;
  const maxH = Math.min(vh * 0.34, 300) * p;

  for (let i = 0; i < NBARS; i++) {
    const idx = Math.floor(Math.pow(i / NBARS, 1.55) * (freq ? freq.length * 0.72 : 1));
    const raw = live && freq ? freq[idx] / 255 : 0;
    barSm[i] += (raw - barSm[i]) * (raw > barSm[i] ? 0.5 : 0.1);

    const bh = 2 + barSm[i] * maxH;
    const x = i * (bw + gap);
    const g = vizX.createLinearGradient(0, vh - bh, 0, vh);
    g.addColorStop(0, `rgba(${ac},0)`);
    g.addColorStop(1, `rgba(${ac},${0.22 + barSm[i] * 0.45})`);
    vizX.fillStyle = g;
    vizX.fillRect(x, vh - bh, bw, bh);
  }
}

// частицы, которые расталкивает басом
function vizDust(ac, live, p) {
  const { cx, cy, r } = geo;
  if (!dust.length) {
    for (let i = 0; i < 110; i++) {
      dust.push({
        a: Math.random() * 6.283,
        d: r + 24 + Math.random() * 300,
        s: (Math.random() < 0.5 ? -1 : 1) * (0.0004 + Math.random() * 0.0017),
        v: 0,
        z: 0.7 + Math.random() * 2.1
      });
    }
  }
  const kick = beatSm * 30 * p;
  for (const d of dust) {
    d.a += d.s * (1 + beatSm * 2.4) * vizSpd;
    d.v += (kick - d.v) * 0.12;
    const rr = d.d + d.v;
    const x = cx + Math.cos(d.a) * rr;
    const y = cy + Math.sin(d.a) * rr * 0.66;
    vizX.fillStyle = `rgba(${ac},${(0.22 + beatSm * 0.5).toFixed(3)})`;
    vizX.beginPath();
    vizX.arc(x, y, d.z * (1 + beatSm * 0.9), 0, 6.283);
    vizX.fill();
  }
}

// кольца, разлетающиеся от обложки на каждую долю
function vizTunnel(ac, live, p) {
  const { cx, cy, r } = geo;

  // доли может не быть вовсе (тихий трек, вступление) - тогда пускаем по таймеру,
  // иначе экран пустой и кажется, что визуализация сломалась
  if (live && (beatNow || vizT - lastRing > 420)) {
    if (rings.length < 44) rings.push({ r: r + 4, a: beatNow ? 0.9 : 0.42, w: beatNow ? 4 : 2 });
    lastRing = vizT;
  }

  const far = Math.max(vw, vh) * 0.85;
  for (let i = rings.length - 1; i >= 0; i--) {
    const g = rings[i];
    // чем дальше кольцо, тем быстрее уходит - это и даёт ощущение скорости
    g.r += (1.1 + g.r * 0.011) * p * vizSpd;
    if (g.r > far) { rings.splice(i, 1); continue; }

    // гаснет не по времени, а по расстоянию: ближние яркие, дальние растворяются
    const k = 1 - g.r / far;
    const a = g.a * k * k;
    if (a < 0.008) continue;

    vizX.beginPath();
    vizX.arc(cx, cy, g.r, 0, 6.283);
    vizX.strokeStyle = `rgba(${ac},${a.toFixed(3)})`;
    vizX.lineWidth = Math.max(0.8, g.w * k);
    vizX.stroke();
  }
}

// водопад: каждый кадр дорисовывает снизу строку спектра, старое уползает вверх
const FALL_W = 220, FALL_H = 150;
function vizFall(ac, live, p) {
  if (!fallC) {
    fallC = document.createElement('canvas');
    fallC.width = FALL_W; fallC.height = FALL_H;
    fallX = fallC.getContext('2d');
  }

  // copy + рисование самого себя со сдвигом = сдвинуть картинку на пиксель вверх
  fallX.globalCompositeOperation = 'copy';
  fallX.drawImage(fallC, 0, -1);
  fallX.globalCompositeOperation = 'source-over';

  for (let i = 0; i < FALL_W; i++) {
    const idx = Math.floor(Math.pow(i / FALL_W, 1.5) * (freq ? freq.length * 0.8 : 1));
    const v = live && freq ? freq[idx] / 255 : 0;
    const a = Math.min(1, Math.pow(v, 1.3) * 1.6 * p);
    if (a < 0.02) continue;
    fallX.fillStyle = `rgba(${ac},${a.toFixed(3)})`;
    fallX.fillRect(i, FALL_H - 1, 1, 1);
  }

  // текст поверх должен оставаться читаемым, поэтому полоса пониже и пожиже
  const h = Math.min(vh * 0.34, 260);
  vizX.globalAlpha = vizA * 0.6;
  vizX.drawImage(fallC, 0, vh - h, vw, h);
  vizX.globalAlpha = vizA;

  // верхний край растворяем, иначе полоса обрывается линейкой
  vizX.globalCompositeOperation = 'destination-out';
  const g = vizX.createLinearGradient(0, vh - h, 0, vh - h * 0.35);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  vizX.fillStyle = g;
  vizX.fillRect(0, vh - h, vw, h * 0.65);
  vizX.globalCompositeOperation = 'source-over';
}

// столбики от средней линии в обе стороны, низы - в центре экрана
function vizMirror(ac, live, p) {
  const y0 = vh * 0.79;
  const maxH = Math.min(vh * 0.19, 180) * p;
  const gap = 2;
  const bw = (vw - (NMIR - 1) * gap) / NMIR;
  const half = NMIR / 2;

  for (let i = 0; i < NMIR; i++) {
    const k = i < half ? half - 1 - i : i - half;      // от середины к краям
    const idx = Math.floor(Math.pow(k / half, 1.5) * (freq ? freq.length * 0.75 : 1));
    const raw = live && freq ? freq[idx] / 255 : 0;
    mirSm[i] += (raw - mirSm[i]) * (raw > mirSm[i] ? 0.5 : 0.1);

    const bh = 1.5 + mirSm[i] * maxH;
    const x = i * (bw + gap);
    const g = vizX.createLinearGradient(0, y0 - bh, 0, y0 + bh);
    g.addColorStop(0, `rgba(${ac},0)`);
    g.addColorStop(0.5, `rgba(${ac},${(0.3 + mirSm[i] * 0.5).toFixed(3)})`);
    g.addColorStop(1, `rgba(${ac},0)`);
    vizX.fillStyle = g;
    vizX.fillRect(x, y0 - bh, bw, bh * 2);
  }
}

// спираль: у центра низы, к краю - верхи; точка растёт от своей полосы
function vizSpiral(ac, live, p) {
  const { cx, cy, r } = geo;
  const r0 = r + 14;
  const rMax = Math.min(vw * 0.44, vh * 0.46);
  const span = Math.max(40, rMax - r0);
  const rot = vizClock / 11000;

  for (let i = 0; i < NSPI; i++) {
    const t = i / NSPI;
    // до верхних полос почти никогда не доходит звук - жмём диапазон,
    // иначе дальняя половина спирали всегда пустая
    const idx = Math.floor(Math.pow(t, 1.5) * (freq ? freq.length * 0.5 : 1));
    const raw = live && freq ? freq[idx] / 255 : 0;
    spiSm[i] += (raw - spiSm[i]) * (raw > spiSm[i] ? 0.5 : 0.09);

    const a = t * 2.2 * 6.283 + rot;
    const rr = r0 + t * span;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr * 0.92;

    // точка видна всегда - спираль читается как фигура, звук только раздувает её
    const s = 1.3 + spiSm[i] * 6 * p;
    vizX.fillStyle = `rgba(${ac},${(0.16 + spiSm[i] * 0.62).toFixed(3)})`;
    vizX.beginPath();
    vizX.arc(x, y, s, 0, 6.283);
    vizX.fill();
  }
}

// цветок: лепестков ровно столько, сколько полос, и каждый дышит своей
const BLO_PETALS = 6;
const bloBand = new Float32Array(BLO_PETALS);
function vizBloom(ac, live, p) {
  const { cx, cy, r } = geo;
  const r0 = r + 10, amp = 86 * p;
  const rot = vizT / 15000;

  // одна полоса спектра на лепесток: так фигура остаётся цветком,
  // а не рваным пятном из 128 независимых точек
  for (let j = 0; j < BLO_PETALS; j++) {
    let sum = 0, n = 0;
    const lo = Math.floor(Math.pow(j / BLO_PETALS, 1.6) * (freq ? freq.length * 0.6 : 1));
    const hi = Math.floor(Math.pow((j + 1) / BLO_PETALS, 1.6) * (freq ? freq.length * 0.6 : 1));
    for (let k = lo; k <= Math.max(lo, hi); k++) { sum += live && freq ? freq[k] : 0; n++; }
    const raw = n ? sum / n / 255 : 0;
    bloBand[j] += (raw - bloBand[j]) * (raw > bloBand[j] ? 0.35 : 0.06);
  }

  const shape = (mul, alpha, width, fill) => {
    vizX.beginPath();
    for (let i = 0; i <= NBLO; i++) {
      const t = i % NBLO;
      const a = (t / NBLO) * 6.283 - Math.PI / 2;
      const lobe = Math.pow(Math.abs(Math.sin(BLO_PETALS * a / 2)), 0.75);  // 0 во впадине, 1 на кончике
      const band = bloBand[Math.floor((t / NBLO) * BLO_PETALS) % BLO_PETALS];
      const rr = r0 + lobe * (10 + band * amp) * mul;
      const x = cx + Math.cos(a + rot) * rr, y = cy + Math.sin(a + rot) * rr;
      i ? vizX.lineTo(x, y) : vizX.moveTo(x, y);
    }
    vizX.closePath();
    if (fill) { vizX.fillStyle = `rgba(${ac},${alpha})`; vizX.fill(); }
    else { vizX.strokeStyle = `rgba(${ac},${alpha})`; vizX.lineWidth = width; vizX.stroke(); }
  };

  shape(1.5, 0.08, 0, true);      // тень пожиже, для объёма
  shape(1, 0.6, 1.9, false);
}

// звёзды летят на тебя; скорость держит бас
function vizWarp(ac, live, p) {
  const cx = vw / 2, cy = vh / 2;
  if (!stars.length) {
    for (let i = 0; i < 260; i++) {
      stars.push({ x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: Math.random() * 0.98 + 0.02 });
    }
  }

  // даже на паузе звёзды медленно едут - статичная точка выглядит как мусор на экране
  const speed = (0.0045 + beatSm * 0.02) * p * vizSpd;
  const f = Math.min(vw, vh) * 0.62;
  vizX.lineCap = 'round';

  for (const s of stars) {
    const z0 = s.z;
    s.z -= speed;
    if (s.z <= 0.02) {
      s.x = (Math.random() - 0.5) * 2;
      s.y = (Math.random() - 0.5) * 2;
      s.z = 1;
      continue;
    }

    const x1 = cx + s.x / s.z * f, y1 = cy + s.y / s.z * f;
    const x0 = cx + s.x / z0 * f, y0 = cy + s.y / z0 * f;
    if (x1 < -60 || x1 > vw + 60 || y1 < -60 || y1 > vh + 60) continue;

    // ближняя звезда ярче и оставляет хвост подлиннее
    const k = 1 - s.z;
    vizX.strokeStyle = `rgba(${ac},${(0.2 + k * k * 0.78).toFixed(3)})`;
    vizX.lineWidth = 0.9 + k * 2.8;
    vizX.beginPath();
    vizX.moveTo(x0, y0);
    vizX.lineTo(x1, y1);
    vizX.stroke();
  }
}

// уходящая за горизонт сетка, на горизонте - спектр
function vizGrid(ac, live, p) {
  const hy = vh * 0.56;             // линия горизонта
  const cx = vw / 2;
  const depth = 15;

  gridZ = (gridZ + (0.006 + beatSm * 0.03) * p * vizSpd) % 1;

  // поперечные линии: чем дальше, тем плотнее друг к другу
  for (let i = 0; i < depth; i++) {
    const t = (i + gridZ) / depth;
    const y = hy + Math.pow(t, 2.4) * (vh - hy) * 1.25;
    if (y > vh + 4) continue;
    const a = 0.4 * Math.pow(t, 0.7);
    vizX.strokeStyle = `rgba(${ac},${a.toFixed(3)})`;
    vizX.lineWidth = 0.7 + t * 1.4;
    vizX.beginPath();
    vizX.moveTo(0, y);
    vizX.lineTo(vw, y);
    vizX.stroke();
  }

  // продольные сходятся в точку схода
  for (let i = -9; i <= 9; i++) {
    const x = cx + i * (vw / 7);
    vizX.strokeStyle = `rgba(${ac},.22)`;
    vizX.lineWidth = 1;
    vizX.beginPath();
    vizX.moveTo(cx + i * 12, hy);
    vizX.lineTo(x, vh);
    vizX.stroke();
  }

  // на самом горизонте - столбики спектра, как далёкий город
  const bw = vw / NGRD;
  for (let i = 0; i < NGRD; i++) {
    const k = i < NGRD / 2 ? NGRD / 2 - 1 - i : i - NGRD / 2;
    const idx = Math.floor(Math.pow(k / (NGRD / 2), 1.5) * (freq ? freq.length * 0.6 : 1));
    const raw = live && freq ? freq[idx] / 255 : 0;
    grdSm[i] += (raw - grdSm[i]) * (raw > grdSm[i] ? 0.5 : 0.1);

    const bh = grdSm[i] * Math.min(vh * 0.3, 240) * p;
    if (bh < 1) continue;
    const g = vizX.createLinearGradient(0, hy - bh, 0, hy);
    g.addColorStop(0, `rgba(${ac},0)`);
    g.addColorStop(1, `rgba(${ac},${(0.2 + grdSm[i] * 0.45).toFixed(3)})`);
    vizX.fillStyle = g;
    vizX.fillRect(i * bw + 0.5, hy - bh, bw - 1, bh);
  }
}

function drawMini(live, ac) {
  const N = 20, w = 52, h = 22;
  miniX.clearRect(0, 0, w, h);
  const bw = 1.8, gap = (w - N * bw) / (N - 1);
  for (let i = 0; i < N; i++) {
    const idx = Math.floor(Math.pow(i / N, 1.4) * (freq ? freq.length * 0.55 : 1));
    const raw = live && freq ? freq[idx] / 255 : 0;
    miniSmooth[i] += (raw - miniSmooth[i]) * (raw > miniSmooth[i] ? 0.5 : 0.12);
    const bh = Math.max(1.5, miniSmooth[i] * h);
    miniX.fillStyle = `rgba(${ac},${0.35 + miniSmooth[i] * 0.55})`;
    miniX.fillRect(i * (bw + gap), (h - bh) / 2, bw, bh);
  }
}
requestAnimationFrame(drawViz);

/* ===================== частицы ===================== */
const pxC = $('px'), pxX = pxC.getContext('2d');
let parts = [], pw = 0, ph = 0;
const mouse = { x: 0, y: 0, tx: 0, ty: 0 };

function sizePx() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  pw = innerWidth; ph = innerHeight;
  pxC.width = pw * dpr; pxC.height = ph * dpr;
  pxC.style.width = pw + 'px'; pxC.style.height = ph + 'px';
  pxX.setTransform(dpr, 0, 0, dpr, 0, 0);

  const want = Math.round(Math.min(90, pw * ph / 22000));
  parts = Array.from({ length: want }, () => ({
    x: Math.random() * pw, y: Math.random() * ph,
    vx: (Math.random() - 0.5) * 0.22, vy: (Math.random() - 0.5) * 0.22,
    r: Math.random() * 1.6 + 0.5
  }));
}
addEventListener('resize', () => { sizePx(); sizeViz(); centerLyrics(LY.cur, true); });
addEventListener('pointermove', e => { mouse.tx = (e.clientX / innerWidth - 0.5) * 20; mouse.ty = (e.clientY / innerHeight - 0.5) * 20; });
sizePx();

function drawPx() {
  requestAnimationFrame(drawPx);
  if (!S.cfg?.particles) { pxX.clearRect(0, 0, pw, ph); return; }

  mouse.x += (mouse.tx - mouse.x) * 0.05;
  mouse.y += (mouse.ty - mouse.y) * 0.05;

  pxX.clearRect(0, 0, pw, ph);
  const ac = accentRgb();

  for (const p of parts) {
    p.x += p.vx; p.y += p.vy;
    if (p.x < -20) p.x = pw + 20; if (p.x > pw + 20) p.x = -20;
    if (p.y < -20) p.y = ph + 20; if (p.y > ph + 20) p.y = -20;
  }
  for (let i = 0; i < parts.length; i++) {
    const a = parts[i];
    const ax = a.x + mouse.x, ay = a.y + mouse.y;
    for (let j = i + 1; j < parts.length; j++) {
      const b = parts[j];
      const dx = a.x - b.x, dy = a.y - b.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 13000) {
        pxX.strokeStyle = `rgba(${ac},${(1 - d2 / 13000) * 0.12})`;
        pxX.lineWidth = 0.6;
        pxX.beginPath();
        pxX.moveTo(ax, ay);
        pxX.lineTo(b.x + mouse.x, b.y + mouse.y);
        pxX.stroke();
      }
    }
    pxX.fillStyle = `rgba(${ac},.34)`;
    pxX.beginPath();
    pxX.arc(ax, ay, a.r, 0, 6.3);
    pxX.fill();
  }
}
requestAnimationFrame(drawPx);

/* ===================== запуск ===================== */
(async function boot() {
  S.cfg = await window.api.settings.get();

  setVolume(S.cfg.volume, false);
  $('c-shuffle').classList.toggle('act', S.cfg.shuffle);
  $('c-repeat').classList.toggle('act', S.cfg.repeat !== 'off');
  $('rep-one').hidden = S.cfg.repeat !== 'one';

  $('lib-sort').value = S.cfg.libSort || 'artist';
  $('lib-sort').onchange = () => {
    S.cfg.libSort = $('lib-sort').value;
    window.api.settings.set({ libSort: S.cfg.libSort });
    $('lib-scroll').scrollTop = 0;
    renderRows();
  };

  // одна кривая настройка не должна утаскивать за собой весь запуск
  const safe = (name, fn) => { try { fn(); } catch (e) { console.error('[' + name + ']', e); } };
  safe('настройки', wireSettings);
  safe('поиск', wireSearchModes);
  loadDlStatus();
  window.api.dl.queue().then(renderDlq).catch(() => {});
  safe('темы', wireThemes);
  safe('профиль', wireProfile);
  safe('шапка плейлиста', wirePlHead);
  safe('скорость', wireRate);
  safe('перетаскивание', wireDrop);
  safe('оформление', applyTheme);

  await loadLibrary();
  renderChips();
  sizeViz();

  S.sys = await window.api.smtc.get();
  renderSys();
  paintDiscord(await window.api.discord.state());

  const info = await window.api.info();
  $('about-line').innerHTML =
    `Вслух ${info.version} · Electron ${info.versions.electron} · Chromium ${info.versions.chrome.split('.')[0]}<br>` +
    `Настройки и обложки лежат в <b>${info.userData}</b>`;

  go(S.cfg.view && document.getElementById('v-' + S.cfg.view) ? S.cfg.view : 'now');

  safe('первый запуск', wireHello);

  if (!maybeHello()) {
    if (S.cfg.folders.length && !S.tracks.length) {
      scan();   // папки есть, а библиотеки нет - собираем сами
    } else if (!S.cfg.folders.length && !S.tracks.length) {
      // экран приветствия почему-то не показался, а слушать всё равно нечего.
      // не бросаем человека на пустом плеере - отправляем туда, где есть кнопки
      go('settings');
      toast('Добавь папку с музыкой или поставь yt-dlp, чтобы качать');
    }
  }
})();
