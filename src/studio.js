/* ===================== студия: карточка и клип =====================
   кадр рисуем сами на своём холсте, а не снимаем окно: так нет ни рамки,
   ни боковой панели, и можно выдать вертикаль под сторис */

const STU_SIZES = {
  story:  { w: 1080, h: 1920, name: 'сторис' },
  square: { w: 1080, h: 1080, name: 'квадрат' },
  wide:   { w: 1920, h: 1080, name: 'широкий' }
};

const STU = {
  fmt: 'story',
  secs: 30,
  open: false,
  rec: null,
  chunks: [],
  raf: 0,
  recC: null,          // холст записи: превью во время клипа берёт кадр у него
  dest: null,
  img: null,
  imgSrc: '',
  bg: null,
  bgKey: '',
  sm: new Float32Array(84)
};

/* ---------- что просит тема ----------
   кадр должен быть похож на то, что человек видит в окне прямо сейчас,
   а не жить своей жизнью. отсюда берём форму обложки, фон, вид спектра
   и его силу - цвет и шрифты кадр и так брал из темы */

function stuTheme() {
  const th = (S.cfg && S.cfg.theme) || {};
  return {
    disc:  th.disc || 'vinyl',
    // видео и картинку по ссылке кадр повторить не может - для него это
    // всё равно «обложка размытая»; ровный фон учитываем честно
    plain: th.bg === 'plain',
    dim:   Math.min(0.9, Math.max(0, (th.bgDim ?? 42) / 100)),
    blur:  Math.max(0, (th.bgBlur ?? 80) / 100),
    viz:   th.viz || 'ring',
    power: Math.max(0.3, (th.vizPower ?? 100) / 100),
    alpha: Math.min(1, Math.max(0.15, (th.vizAlpha ?? 100) / 100))
  };
}

/* ---------- обложка и фон ---------- */

function stuCover() {
  const url = coverUrl(S.track);
  if (!url) { STU.img = null; STU.imgSrc = ''; return null; }
  if (STU.imgSrc !== url) {
    STU.imgSrc = url;
    STU.img = null;
    const im = new Image();
    im.onload = () => { if (STU.imgSrc === url) { STU.img = im; STU.bgKey = ''; } };
    im.onerror = () => { if (STU.imgSrc === url) STU.img = null; };
    im.src = url;
  }
  return STU.img;
}

// размытый фон считаем один раз на обложку и формат: blur в каждом кадре съел бы всё
function stuBg(W, H) {
  const th = stuTheme();
  const key = [W, H, STU.imgSrc, STU.img ? 1 : 0, accentRgb(),
               th.plain ? 'plain' : 'cover', th.dim, th.blur].join('|');
  if (STU.bgKey === key && STU.bg) return STU.bg;

  const c = STU.bg || document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const ac = accentRgb();

  x.fillStyle = '#08070a';
  x.fillRect(0, 0, W, H);

  const im = STU.img;
  if (im && im.width && !th.plain) {
    const s = Math.max(W / im.width, H / im.height) * 1.35;
    const dw = im.width * s, dh = im.height * s;
    x.save();
    // в окне размытие задано в пикселях экрана; кадр крупнее, поэтому берём долей
    x.filter = 'blur(' + Math.round(Math.min(W, H) * 0.11 * th.blur) + 'px) saturate(1.5) brightness(.62)';
    x.drawImage(im, (W - dw) / 2, (H - dh) / 2, dw, dh);
    x.restore();
  } else {
    const g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, 'rgba(' + ac + ',' + (th.plain ? '.18' : '.35') + ')');
    g.addColorStop(1, '#08070a');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
  }

  // затемнение и виньетка, чтобы текст читался при любой обложке
  x.fillStyle = 'rgba(8,7,10,' + (th.plain ? th.dim * 0.5 : th.dim).toFixed(3) + ')';
  x.fillRect(0, 0, W, H);
  const v = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,.62)');
  x.fillStyle = v;
  x.fillRect(0, 0, W, H);

  STU.bg = c;
  STU.bgKey = key;
  return c;
}

/* ---------- раскладка кадра ----------
   обложка занимает половину кадра, под ней мелким: название, исполнитель
   и полоса времени. текст песни - справа (широкий) или ниже (остальные) */

function stuLayout(kind, W, H, hasLy) {
  const size = Math.min(W, H);      // все размеры считаем от короткой стороны
  const d = size * 0.5;

  if (kind === 'wide') {
    // без текста колонке незачем жаться к левому краю - ставим её посередине
    const cx = hasLy ? W * 0.27 : W * 0.5;
    const cy = hasLy ? H * 0.40 : H * 0.42;
    return {
      size, d, cx, cy, align: 'center', tx: cx, tw: d * 1.45,
      infoY: cy + d / 2 + size * 0.062,
      barW: d,
      lyX: W * 0.57, lyW: W * 0.37, lyY: H * 0.52, lyAlign: 'left'
    };
  }

  if (kind === 'square') {
    const cx = W / 2, cy = hasLy ? H * 0.30 : H * 0.42;
    return {
      size, d, cx, cy, align: 'center', tx: cx, tw: W * 0.8,
      infoY: cy + d / 2 + size * 0.055,
      barW: d,
      lyX: cx, lyW: W * 0.82, lyY: H * 0.83, lyAlign: 'center'
    };
  }

  const cx = W / 2, cy = hasLy ? H * 0.28 : H * 0.44;
  return {
    size, d, cx, cy, align: 'center', tx: cx, tw: W * 0.84,
    infoY: cy + d / 2 + size * 0.062,
    barW: d,
    lyX: cx, lyW: W * 0.84, lyY: H * 0.73, lyAlign: 'center'
  };
}

/* ---------- текст ---------- */

function stuWrap(x, text, maxW) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  let line = words[0];
  for (let i = 1; i < words.length; i++) {
    const t = line + ' ' + words[i];
    if (x.measureText(t).width > maxW) { out.push(line); line = words[i]; }
    else line = t;
  }
  out.push(line);
  return out;
}

// строка с караоке-заливкой: сначала непропетое, поверх - залитая часть по клипу
function stuKaraoke(x, lines, ax, y, lineH, p, ac, align) {
  const total = lines.reduce((s, l) => s + l.length, 0) || 1;
  let seen = 0;

  for (const l of lines) {
    const w = x.measureText(l).width;
    const left = align === 'left' ? ax : ax - w / 2;
    const k = Math.max(0, Math.min(1, (p * total - seen) / (l.length || 1)));
    seen += l.length;

    x.fillStyle = 'rgba(255,255,255,.36)';
    x.fillText(l, align === 'left' ? left : ax, y);

    if (k > 0) {
      x.save();
      x.beginPath();
      x.rect(left, y - lineH, w * k, lineH * 2);
      x.clip();
      x.fillStyle = 'rgb(' + ac + ')';
      x.shadowColor = 'rgba(' + ac + ',.55)';
      x.shadowBlur = lineH * 0.5;
      x.fillText(l, align === 'left' ? left : ax, y);
      x.restore();
    }
    y += lineH;
  }
  return y;
}

/* ---------- кольцо спектра вокруг обложки ---------- */

function stuRing(x, L, ac, live, advance, power) {
  const N = STU.sm.length;
  const r0 = L.d / 2 + L.size * 0.012;
  const out = L.size * 0.055 * (power || 1);

  x.lineCap = 'round';
  x.lineWidth = Math.max(1.5, L.size * 0.0038);

  for (let i = 0; i < N; i++) {
    const half = N / 2;
    const k = i < half ? i : N - 1 - i;
    const idx = Math.floor(Math.pow(k / half, 1.35) * (freq ? freq.length * 0.62 : 1));
    const raw = live && freq ? freq[idx] / 255 : 0;
    // сглаживание двигаем один раз за кадр, иначе превью и запись гонят его вдвое
    if (advance) STU.sm[i] += (raw - STU.sm[i]) * (raw > STU.sm[i] ? 0.45 : 0.11);

    const len = L.size * 0.006 + STU.sm[i] * out;
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    const cos = Math.cos(a), sin = Math.sin(a);
    const g = x.createLinearGradient(L.cx + cos * r0, L.cy + sin * r0,
                                     L.cx + cos * (r0 + len), L.cy + sin * (r0 + len));
    g.addColorStop(0, 'rgba(' + ac + ',' + (0.35 + STU.sm[i] * 0.5) + ')');
    g.addColorStop(1, 'rgba(' + ac + ',0)');
    x.strokeStyle = g;
    x.beginPath();
    x.moveTo(L.cx + cos * r0, L.cy + sin * r0);
    x.lineTo(L.cx + cos * (r0 + len), L.cy + sin * (r0 + len));
    x.stroke();
  }
}

/* ---------- спектр из темы ----------
   Виды из viz2.js и viz3.js нарочно написаны так, что всё нужное им отдают
   одним объектом: их можно нарисовать на любом холсте, и кадр выходит ровно
   как окно. Остальные двенадцать живут внутри app.js и привязаны к экранному
   холсту вместе со своим состоянием - для них остаётся кольцо. */

function stuViz(x, W, H, L, ac, live, advance) {
  const th = stuTheme();
  if (th.viz === 'off') return;

  const big = (window.VIZ2 && window.VIZ2[th.viz]) || (window.VIZ3 && window.VIZ3[th.viz]);

  x.save();
  x.globalAlpha = th.alpha;
  if (big) {
    big({
      x: x, w: W, h: H,
      geo: { cx: L.cx, cy: L.cy, r: L.d / 2 },
      freq: freq, time: timeData, live: live,
      beat: beatSm, hit: beatNow,
      t: vizClock, dt: vizDt * vizSpd, p: th.power, ac: ac
    });
  } else {
    stuRing(x, L, ac, live, advance, th.power);
  }
  x.restore();
}

/* ---------- форма обложки ---------- */

// та же, что выбрана в теме: пластинка, скруглённый квадрат или просто квадрат
function stuShape(x, cx, cy, d, kind) {
  const r = d / 2;
  x.beginPath();
  if (kind === 'vinyl') x.arc(cx, cy, r, 0, 6.283);
  else x.roundRect(cx - r, cy - r, d, d, d * (kind === 'square' ? 0.075 : 0.052));
  x.closePath();
}

/* ---------- полоса времени ---------- */

// идёт сразу под исполнителем, а не по нижнему краю кадра: так весь блок
// "обложка - название - исполнитель - время" читается одной колонкой
function stuBar(x, L, y, ac, fUi, t) {
  const dur = (t && t.duration) || audio.duration || 0;
  const bw = L.barW, bx = L.tx - bw / 2;
  const hh = Math.max(2, L.size * 0.0035);
  const k = dur > 0 ? Math.max(0, Math.min(1, curTime() / dur)) : 0;

  x.fillStyle = 'rgba(255,255,255,.14)';
  x.fillRect(bx, y, bw, hh);
  if (k > 0) {
    x.fillStyle = 'rgb(' + ac + ')';
    x.fillRect(bx, y, bw * k, hh);
  }

  const ts = L.size * 0.017;
  const ty = y + L.size * 0.032;
  x.font = '400 ' + ts + 'px ' + fUi;
  x.fillStyle = 'rgba(236,233,240,.42)';
  x.textAlign = 'left';
  x.fillText(fmt(curTime()), bx, ty);
  x.textAlign = 'right';
  if (dur > 0) x.fillText(fmt(dur), bx + bw, ty);

  // между временами - подпись: кадр уезжает в чужие ленты, пусть говорит, чей он.
  // ромбик рисуем сами, чтобы не зависеть от того, есть ли значок в шрифте
  const mark = 'Вслух';
  x.textAlign = 'left';
  const mw = x.measureText(mark).width;
  const dsz = ts * 0.34, gap = ts * 0.44;
  const mx = L.tx - (mw + gap + dsz) / 2;

  x.save();
  x.translate(mx + dsz / 2, ty - ts * 0.31);
  x.rotate(Math.PI / 4);
  x.fillStyle = 'rgba(' + ac + ',.8)';
  x.fillRect(-dsz / 2, -dsz / 2, dsz, dsz);
  x.restore();

  x.fillStyle = 'rgba(236,233,240,.34)';
  x.fillText(mark, mx + dsz + gap, ty);

  x.textAlign = L.align;
  return ty;
}

/* ---------- сам кадр ---------- */

function stuFrame(x, W, H, opts) {
  const advance = !!(opts && opts.advance);
  const live = !!analyser && !audio.paused;
  const ac = accentRgb();
  const th = stuTheme();
  // без синхронного текста нижняя половина кадра пустовала бы - раскладка
  // про это знает и ставит обложку с подписями посередине
  const hasLy = !!(LY.lines.length && !LY.plain);
  const L = stuLayout(STU.fmt, W, H, hasLy);
  const t = S.track;

  x.clearRect(0, 0, W, H);
  x.drawImage(stuBg(W, H), 0, 0, W, H);

  const cs = getComputedStyle(document.documentElement);
  const fLy = cs.getPropertyValue('--font-ly').trim() || 'sans-serif';
  const fUi = cs.getPropertyValue('--font-ui').trim() || 'sans-serif';

  stuViz(x, W, H, L, ac, live, advance);

  // обложка той же формы, что и в окне
  const im = stuCover();
  x.save();
  stuShape(x, L.cx, L.cy, L.d, th.disc);
  x.shadowColor = 'rgba(0,0,0,.6)';
  x.shadowBlur = L.size * (th.disc === 'plain' ? 0.03 : 0.04);
  x.fillStyle = '#15131d';
  x.fill();
  x.shadowBlur = 0;
  x.clip();
  if (im && im.width) {
    const s = Math.max(L.d / im.width, L.d / im.height);
    x.drawImage(im, L.cx - im.width * s / 2, L.cy - im.height * s / 2, im.width * s, im.height * s);
  }
  x.restore();

  // дырка бывает только у пластинки
  if (th.disc === 'vinyl') {
    x.fillStyle = 'rgba(0,0,0,.85)';
    x.beginPath();
    x.arc(L.cx, L.cy, L.d * 0.075, 0, 6.283);
    x.fill();
  }

  x.textAlign = L.align;
  x.textBaseline = 'alphabetic';

  // под обложкой мелким: название, исполнитель, полоса времени
  let y = L.infoY;

  const tSize = L.size * 0.032;
  x.font = '600 ' + tSize + 'px ' + fLy;
  x.fillStyle = '#fff';
  const title = (t && t.title) || 'Ничего не играет';
  for (const l of stuWrap(x, title, L.tw).slice(0, 2)) { x.fillText(l, L.tx, y); y += tSize * 1.2; }

  const aSize = L.size * 0.023;
  if (t && t.artist) {
    x.font = '400 ' + aSize + 'px ' + fUi;
    x.fillStyle = 'rgba(236,233,240,.52)';
    x.fillText(t.artist, L.tx, y + aSize * 0.2);
    y += aSize * 1.4;
  }

  stuBar(x, L, y + L.size * 0.03, ac, fUi, t);

  // текст песни: предыдущая строка, текущая с заливкой, следующая
  if (hasLy) {
    const now = curTime() + (Number(S.cfg.lyricsOffset) || 0);
    let i = -1;
    for (let k = 0; k < LY.lines.length; k++) { if (LY.lines[k].t <= now) i = k; else break; }

    const big = L.size * 0.038;
    const small = L.size * 0.026;
    const lineH = big * 1.28;

    // соседние строки ищем непустые: между куплетами в lrc стоят паузы,
    // и иначе сверху и снизу от текущей строки просто пусто
    const near = (from, step) => {
      for (let k = from; k >= 0 && k < LY.lines.length; k += step) {
        if (LY.lines[k] && LY.lines[k].text) return LY.lines[k];
      }
      return null;
    };

    x.textAlign = L.lyAlign;

    x.font = '400 ' + small + 'px ' + fLy;
    x.fillStyle = 'rgba(236,233,240,.22)';
    const prev = near(i - 1, -1);
    if (prev) {
      const pl = stuWrap(x, prev.text, L.lyW);
      x.fillText(pl[0], L.lyX, L.lyY - lineH * 1.45);
    }

    x.font = '650 ' + big + 'px ' + fLy;
    const cur = LY.lines[i];
    let after = L.lyY;
    if (cur && cur.text) {
      const cl = stuWrap(x, cur.text, L.lyW).slice(0, 3);
      after = stuKaraoke(x, cl, L.lyX, L.lyY, lineH, Math.max(0, lineFill(now, i)), ac, L.lyAlign);
    }

    x.font = '400 ' + small + 'px ' + fLy;
    x.fillStyle = 'rgba(236,233,240,.3)';
    const next = near(i + 1, 1);
    if (next) {
      const nl = stuWrap(x, next.text, L.lyW);
      x.fillText(nl[0], L.lyX, after + lineH * 0.3);
    }
  }
}

/* ---------- сохранение ---------- */

function stuName(ext) {
  const t = S.track;
  const base = [(t && t.artist) || '', (t && t.title) || '']
    .filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]+/g, '').trim() || 'vsluh';
  return base.slice(0, 60) + '.' + ext;
}

function stuStatus(msg) {
  const n = $('stu-status');
  if (n) n.textContent = msg || '';
}

async function stuSave(blob, ext) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const r = await window.api.studio.save({ name: stuName(ext), ext, data: buf });
  if (r.canceled) return null;
  if (r.error) { stuStatus('Не сохранилось: ' + r.error); return null; }
  return r.file;
}

/* ---------- карточка ---------- */

async function stuCard() {
  const s = STU_SIZES[STU.fmt];
  const c = document.createElement('canvas');
  c.width = s.w; c.height = s.h;
  stuFrame(c.getContext('2d'), s.w, s.h, { advance: false });

  stuStatus('собираю картинку…');
  const blob = await new Promise(res => c.toBlob(res, 'image/png'));
  if (!blob) { stuStatus('картинка не собралась'); return; }

  const file = await stuSave(blob, 'png');
  if (file) { stuStatus('Сохранено: ' + file); toast('Карточка сохранена'); }
  else stuStatus('');
}

/* ---------- клип ---------- */

const STU_MIMES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm'
];

function stuMime() {
  for (const m of STU_MIMES) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {}
  }
  return '';
}

function stuAudioTrack() {
  if (!actx || !analyser) return null;
  if (!STU.dest) {
    STU.dest = actx.createMediaStreamDestination();
    analyser.connect(STU.dest);       // отдельная ветка для записи, колонки не трогаем
  }
  return STU.dest.stream.getAudioTracks()[0] || null;
}

function stuStopRec() {
  if (!STU.rec) return;
  try { STU.rec.stop(); } catch { /* уже остановлен */ }
}

async function stuRecord() {
  if (STU.rec) { stuStopRec(); return; }

  if (S.source !== 'local') { stuStatus('Клип пишется только со своих файлов — стрим звук не отдаёт'); return; }
  if (!S.track) { stuStatus('Сначала включи трек'); return; }

  initAudio();
  const at = stuAudioTrack();
  if (!at) { stuStatus('Не получилось взять звук'); return; }

  const mime = stuMime();
  if (!mime) { stuStatus('Этот Chromium не умеет писать видео'); return; }

  const s = STU_SIZES[STU.fmt];
  const c = document.createElement('canvas');
  c.width = s.w; c.height = s.h;
  const x = c.getContext('2d');
  STU.recC = c;
  stuFrame(x, s.w, s.h, { advance: false });     // первый кадр до старта потока

  const stream = new MediaStream([...c.captureStream(30).getVideoTracks(), at]);
  STU.chunks = [];

  let rec;
  try {
    rec = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: STU.fmt === 'wide' ? 9e6 : 7e6,
      audioBitsPerSecond: 192000
    });
  } catch (e) { stuStatus('Запись не завелась: ' + e.message); return; }

  STU.rec = rec;
  rec.ondataavailable = e => { if (e.data && e.data.size) STU.chunks.push(e.data); };

  const ext = mime.indexOf('video/mp4') === 0 ? 'mp4' : 'webm';
  rec.onstop = async () => {
    cancelAnimationFrame(STU.raf);
    STU.raf = 0;
    STU.rec = null;
    STU.recC = null;
    paintStudio();

    const blob = new Blob(STU.chunks, { type: mime });
    STU.chunks = [];
    stuStatus('готовлю файл, ' + Math.max(1, Math.round(blob.size / 1048576)) + ' МБ…');

    const file = await stuSave(blob, ext);
    if (file) { stuStatus('Сохранено: ' + file); toast('Клип сохранён'); }
    else stuStatus('');
  };

  if (audio.paused) audio.play().catch(() => {});

  const t0 = performance.now();
  const ms = STU.secs * 1000;
  const tick = () => {
    STU.raf = requestAnimationFrame(tick);
    stuFrame(x, s.w, s.h, { advance: true });

    const left = Math.max(0, ms - (performance.now() - t0));
    stuStatus('пишу, осталось ' + Math.ceil(left / 1000) + ' с — нажми ещё раз, чтобы остановить');
    if (left <= 0 || audio.ended) stuStopRec();
  };

  rec.start(1000);
  STU.raf = requestAnimationFrame(tick);
  paintStudio();
}

/* ---------- панель ---------- */

let stuPrevRaf = 0;

function stuPreview() {
  stuPrevRaf = requestAnimationFrame(stuPreview);
  if (!STU.open) return;

  const c = $('stu-canvas');
  const s = STU_SIZES[STU.fmt];
  const k = 340 / s.h;                    // превью мелкое, оно только для глаз
  const w = Math.round(s.w * k), h = Math.round(s.h * k);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }

  // во время записи кадр уже собран в полном размере - просто уменьшаем его.
  // собирать второй раз нельзя: у части видов состояние одно на всех
  if (STU.rec && STU.recC) c.getContext('2d').drawImage(STU.recC, 0, 0, w, h);
  else stuFrame(c.getContext('2d'), w, h, { advance: true });
}

function paintStudio() {
  document.querySelectorAll('#stu-fmt button').forEach(b => b.classList.toggle('on', b.dataset.v === STU.fmt));

  let preset = false;
  document.querySelectorAll('#stu-len button').forEach(b => {
    const on = +b.dataset.v === STU.secs;
    if (on) preset = true;
    b.classList.toggle('on', on);
  });
  // своё время держим в поле, но пока оно совпало с готовым - поле пустое
  const own = $('stu-own');
  if (own && document.activeElement !== own) own.value = preset ? '' : String(STU.secs);
  if (own) own.classList.toggle('on', !preset);
  const rec = $('stu-rec');
  rec.textContent = STU.rec ? 'Остановить' : 'Записать клип';
  rec.classList.toggle('on-air', !!STU.rec);
  $('stu-png').disabled = !!STU.rec;
}

function openStudio(on) {
  STU.open = on;
  $('studio').hidden = !on;

  if (on) {
    STU.bgKey = '';
    stuCover();
    paintStudio();
    stuStatus(S.source === 'local'
      ? 'Клип пишется в реальном времени: сколько секунд, столько и ждать.'
      : 'Со стрима звук не снимается — картинку сохранить можно, клип нет.');
    if (!stuPrevRaf) stuPreview();
  } else if (STU.rec) {
    stuStopRec();
  }
}

$('stu-btn').onclick = () => openStudio(true);
$('stu-x').onclick = () => openStudio(false);
$('studio').addEventListener('click', e => { if (e.target.id === 'studio') openStudio(false); });

document.querySelectorAll('#stu-fmt button').forEach(b => {
  b.onclick = () => { STU.fmt = b.dataset.v; STU.bgKey = ''; paintStudio(); };
});
document.querySelectorAll('#stu-len button').forEach(b => {
  b.onclick = () => { STU.secs = +b.dataset.v; paintStudio(); };
});

// своё время: от трёх секунд до десяти минут - дольше клип не влезет ни в одну ленту
$('stu-own').oninput = () => {
  const v = Math.round(Number($('stu-own').value));
  if (!Number.isFinite(v) || v < 3) return;
  STU.secs = Math.min(600, v);
  paintStudio();
};
$('stu-own').onblur = () => paintStudio();
$('stu-own').onkeydown = e => { if (e.key === 'Enter') $('stu-own').blur(); };
$('stu-png').onclick = () => stuCard();
$('stu-rec').onclick = () => stuRecord();
