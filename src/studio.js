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
  dest: null,
  img: null,
  imgSrc: '',
  bg: null,
  bgKey: '',
  sm: new Float32Array(84)
};

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
  const key = W + 'x' + H + '|' + STU.imgSrc + '|' + (STU.img ? '1' : '0') + '|' + accentRgb();
  if (STU.bgKey === key && STU.bg) return STU.bg;

  const c = STU.bg || document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const ac = accentRgb();

  x.fillStyle = '#08070a';
  x.fillRect(0, 0, W, H);

  const im = STU.img;
  if (im && im.width) {
    const s = Math.max(W / im.width, H / im.height) * 1.35;
    const dw = im.width * s, dh = im.height * s;
    x.save();
    x.filter = 'blur(' + Math.round(Math.min(W, H) * 0.09) + 'px) saturate(1.5) brightness(.62)';
    x.drawImage(im, (W - dw) / 2, (H - dh) / 2, dw, dh);
    x.restore();
  } else {
    const g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, 'rgba(' + ac + ',.35)');
    g.addColorStop(1, '#08070a');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
  }

  // затемнение и виньетка, чтобы текст читался при любой обложке
  x.fillStyle = 'rgba(8,7,10,.46)';
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

/* ---------- раскладка кадра ---------- */

function stuLayout(kind, W, H) {
  if (kind === 'wide') {
    const d = H * 0.54;
    return {
      d, cx: W * 0.29, cy: H * 0.5, size: H, align: 'left',
      tx: W * 0.5, tw: W * 0.42,
      titleY: H * 0.34, lyY: H * 0.58, lyW: W * 0.42
    };
  }
  if (kind === 'square') {
    const d = W * 0.42;
    return {
      d, cx: W / 2, cy: H * 0.3, size: H, align: 'center',
      tx: W / 2, tw: W * 0.82,
      titleY: H * 0.3 + d / 2 + H * 0.09, lyY: H * 0.78, lyW: W * 0.82
    };
  }
  const d = W * 0.58;
  return {
    d, cx: W / 2, cy: H * 0.3, size: H, align: 'center',
    tx: W / 2, tw: W * 0.86,
    titleY: H * 0.3 + d / 2 + H * 0.05, lyY: H * 0.73, lyW: W * 0.86
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

function stuRing(x, L, ac, live, advance) {
  const N = STU.sm.length;
  const r0 = L.d / 2 + L.size * 0.012;
  const out = L.size * 0.055;

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

/* ---------- сам кадр ---------- */

function stuFrame(x, W, H, opts) {
  const advance = !!(opts && opts.advance);
  const live = !!analyser && !audio.paused;
  const ac = accentRgb();
  const L = stuLayout(STU.fmt, W, H);
  const t = S.track;

  x.clearRect(0, 0, W, H);
  x.drawImage(stuBg(W, H), 0, 0, W, H);

  const cs = getComputedStyle(document.documentElement);
  const fLy = cs.getPropertyValue('--font-ly').trim() || 'sans-serif';
  const fUi = cs.getPropertyValue('--font-ui').trim() || 'sans-serif';

  stuRing(x, L, ac, live, advance);

  // обложка кружком, как в самом плеере
  const im = stuCover();
  x.save();
  x.beginPath();
  x.arc(L.cx, L.cy, L.d / 2, 0, 6.283);
  x.closePath();
  x.shadowColor = 'rgba(0,0,0,.6)';
  x.shadowBlur = L.size * 0.04;
  x.fillStyle = '#15131d';
  x.fill();
  x.shadowBlur = 0;
  x.clip();
  if (im && im.width) {
    const s = Math.max(L.d / im.width, L.d / im.height);
    x.drawImage(im, L.cx - im.width * s / 2, L.cy - im.height * s / 2, im.width * s, im.height * s);
  }
  x.restore();

  // дырка от пластинки
  x.fillStyle = 'rgba(0,0,0,.85)';
  x.beginPath();
  x.arc(L.cx, L.cy, L.d * 0.07, 0, 6.283);
  x.fill();

  x.textAlign = L.align;
  x.textBaseline = 'alphabetic';

  // название и артист
  const titleSize = L.size * 0.042;
  x.font = '700 ' + titleSize + 'px ' + fLy;
  x.fillStyle = '#fff';
  const title = (t && t.title) || 'Ничего не играет';
  const tl = stuWrap(x, title, L.tw).slice(0, 2);
  let ty = L.titleY;
  for (const l of tl) { x.fillText(l, L.tx, ty); ty += titleSize * 1.18; }

  x.font = '400 ' + (L.size * 0.026) + 'px ' + fUi;
  x.fillStyle = 'rgba(236,233,240,.56)';
  if (t && t.artist) x.fillText(t.artist, L.tx, ty + L.size * 0.008);

  // текст песни: предыдущая строка, текущая с заливкой, следующая
  if (LY.lines.length && !LY.plain) {
    const now = curTime() + (Number(S.cfg.lyricsOffset) || 0);
    let i = -1;
    for (let k = 0; k < LY.lines.length; k++) { if (LY.lines[k].t <= now) i = k; else break; }

    const big = L.size * 0.036;
    const small = L.size * 0.025;
    const lineH = big * 1.28;

    // соседние строки ищем непустые: между куплетами в lrc стоят паузы,
    // и иначе сверху и снизу от текущей строки просто пусто
    const near = (from, step) => {
      for (let k = from; k >= 0 && k < LY.lines.length; k += step) {
        if (LY.lines[k] && LY.lines[k].text) return LY.lines[k];
      }
      return null;
    };

    x.font = '400 ' + small + 'px ' + fLy;
    x.fillStyle = 'rgba(236,233,240,.22)';
    const prev = near(i - 1, -1);
    if (prev) {
      const pl = stuWrap(x, prev.text, L.lyW);
      x.fillText(pl[0], L.tx, L.lyY - lineH * 1.45);
    }

    x.font = '650 ' + big + 'px ' + fLy;
    const cur = LY.lines[i];
    let after = L.lyY;
    if (cur && cur.text) {
      const cl = stuWrap(x, cur.text, L.lyW).slice(0, 3);
      after = stuKaraoke(x, cl, L.tx, L.lyY, lineH, Math.max(0, lineFill(now, i)), ac, L.align);
    }

    x.font = '400 ' + small + 'px ' + fLy;
    x.fillStyle = 'rgba(236,233,240,.3)';
    const next = near(i + 1, 1);
    if (next) {
      const nl = stuWrap(x, next.text, L.lyW);
      x.fillText(nl[0], L.tx, after + lineH * 0.3);
    }
  }

  // полоска времени по низу
  const dur = (t && t.duration) || audio.duration || 0;
  if (dur > 0) {
    const bw = W * (STU.fmt === 'wide' ? 0.42 : 0.72);
    const bx = STU.fmt === 'wide' ? L.tx : (W - bw) / 2;
    const by = H - H * 0.06;
    const hh = Math.max(2, H * 0.0035);
    const k = Math.max(0, Math.min(1, curTime() / dur));

    x.fillStyle = 'rgba(255,255,255,.14)';
    x.fillRect(bx, by, bw, hh);
    x.fillStyle = 'rgb(' + ac + ')';
    x.fillRect(bx, by, bw * k, hh);

    x.font = '400 ' + (L.size * 0.017) + 'px ' + fUi;
    x.fillStyle = 'rgba(236,233,240,.42)';
    x.textAlign = 'left';
    x.fillText(fmt(curTime()), bx, by + H * 0.032);
    x.textAlign = 'right';
    x.fillText(fmt(dur), bx + bw, by + H * 0.032);
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
  // пока идёт запись, сглаживание двигает она - превью только показывает
  stuFrame(c.getContext('2d'), w, h, { advance: !STU.rec });
}

function paintStudio() {
  document.querySelectorAll('#stu-fmt button').forEach(b => b.classList.toggle('on', b.dataset.v === STU.fmt));
  document.querySelectorAll('#stu-len button').forEach(b => b.classList.toggle('on', +b.dataset.v === STU.secs));
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
$('stu-png').onclick = () => stuCard();
$('stu-rec').onclick = () => stuRecord();
