/* ===== мини-плеер =====
   своего звука тут нет. окошко показывает то, что прислало большое окно,
   и отправляет ему обратно нажатия. так трек не прерывается: играет всё
   там же, где играл */

const $ = id => document.getElementById(id);

// как в большом окне: часы показываем только когда они есть
const fmt = s => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return (h ? h + ':' : '') + mm + ':' + String(x).padStart(2, '0');
};

let st = { playing: false, position: 0, duration: 0, canFav: false, fav: false };
let dragging = false;

/* ---- рисуем ---- */

function paintTime() {
  const d = st.duration || 0;
  const c = Math.min(st.position || 0, d || Infinity);
  const p = d ? Math.min(100, c / d * 100) : 0;
  $('seek-fill').style.width = p + '%';
  $('seek-knob').style.left = p + '%';
  // пока трек не начался, длительности ещё нет - показываем одно текущее время
  $('time').textContent = d ? fmt(c) + ' / ' + fmt(d) : fmt(c);
}

function paint(s) {
  // в частых досылках приходит только время - остальное не трогаем
  if (!s.tick) {
    const art = $('art');
    const img = $('art-img');
    if (s.cover !== art.dataset.src) {
      art.dataset.src = s.cover || '';
      if (s.cover) { img.src = s.cover; art.classList.add('has'); }
      else { img.removeAttribute('src'); art.classList.remove('has'); }
    }
    $('title').textContent = s.title || '—';
    $('artist').textContent = s.artist || '';
    document.title = s.title ? (s.artist ? s.artist + ' — ' + s.title : s.title) : 'Вслух';

    if (s.accent) document.documentElement.style.setProperty('--ac', s.accent);

    $('b-fav').disabled = !s.canFav;
    $('b-fav').classList.toggle('on', !!s.fav);

    // подписи приходят переведёнными: словарь ради шести строк сюда не тащим
    for (const [id, text] of Object.entries(s.labels || {})) {
      const el = $(id);
      if (el) { el.title = text; el.setAttribute('aria-label', text); }
    }
  }

  st = Object.assign(st, s);

  const on = !!st.playing;
  // у svg нет свойства hidden - только атрибут, его и переключаем
  $('ic-play').toggleAttribute('hidden', on);
  $('ic-pause').toggleAttribute('hidden', !on);
  // одна кнопка на два действия - подпись меняется вместе со значком
  const lab = st.labels && (on ? st.labels.pause : st.labels.play);
  if (lab) { $('b-play').title = lab; $('b-play').setAttribute('aria-label', lab); }

  if (!dragging) paintTime();
}

window.api.mini.onState(paint);

/* ---- нажатия ---- */

const cmd = what => window.api.mini.cmd(what);

$('b-play').onclick = () => cmd('toggle');
$('b-next').onclick = () => cmd('next');
$('b-prev').onclick = () => cmd('prev');
$('b-fav').onclick  = () => cmd('fav');
$('b-up').onclick   = () => window.api.mini.close();

/* колесо над окошком - громкость: до ползунка тут места нет */
window.addEventListener('wheel', e => {
  cmd(e.deltaY < 0 ? 'volup' : 'voldown');
}, { passive: true });

/* двойной щелчок по обложке - тоже назад в большое окно */
$('art').ondblclick = () => window.api.mini.close();

/* ---- перемотка ---- */

const seek = $('seek');

const pctAt = e => {
  const r = seek.getBoundingClientRect();
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
};

const showAt = k => {
  $('seek-fill').style.width = (k * 100) + '%';
  $('seek-knob').style.left = (k * 100) + '%';
  if (st.duration) $('time').textContent = fmt(k * st.duration) + ' / ' + fmt(st.duration);
};

seek.addEventListener('pointerdown', e => {
  if (!st.duration) return;
  dragging = true;
  seek.setPointerCapture(e.pointerId);
  showAt(pctAt(e));
});

seek.addEventListener('pointermove', e => { if (dragging) showAt(pctAt(e)); });

seek.addEventListener('pointerup', e => {
  if (!dragging) return;
  dragging = false;
  try { seek.releasePointerCapture(e.pointerId); } catch {}
  cmd('seek:' + pctAt(e).toFixed(5));
});

// перемотку оборвали - возвращаем полосу к настоящему времени
seek.addEventListener('pointercancel', () => {
  if (!dragging) return;
  dragging = false;
  paintTime();
});

/* ---- клавиши ---- */
window.addEventListener('keydown', e => {
  if (e.key === ' ') { e.preventDefault(); cmd('toggle'); }
  else if (e.key === 'ArrowRight') cmd('next');
  else if (e.key === 'ArrowLeft') cmd('prev');
  else if (e.key === 'Escape') window.api.mini.close();
});

/* большое окно могло нарисоваться раньше, чем мы подписались - просим состояние сами */
cmd('hello');
