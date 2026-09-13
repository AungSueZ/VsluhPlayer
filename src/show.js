/* ===================== показ =====================
   Плеер сам проводит сорокасекундную демонстрацию: включает трек с нужной
   секунды и переключает вид по сетке, посчитанной под его темп. Снимать надо
   обычным экранным рекордером - одним дублем, монтировать потом нечего.

   Запуск: Ctrl+Alt+Shift+P. Ещё раз - остановить досрочно.

   Это инструмент для съёмки ролика, не возможность приложения: своей кнопки
   в интерфейсе у него нет и пользователю он на глаза не попадается.

   Сетка привязана к треку тёмный принц - Утекай: 90.4 удара в минуту,
   доля 0.6635 с, такт 2.654 с. Низ пропадает на 68.2 с и возвращается на 70.35,
   припев заходит на 76.7. Окно 41.15-81.15 выбрано так, чтобы части показа
   легли ровно на части трека: 0-15 вайб идёт по проигрышу и второму куплету,
   15-30 показ - по строчкам, что меняются каждые три секунды (видно заливку),
   30-40 финал начинается ровно там, где вернулся низ. */

const SHOW = {
  find: 'утекай',       // по названию трека
  from: 41.15,          // с какой секунды трека
  len: 40,
  on: false,
  timer: null,
  at: -1,               // какой шаг уже отыграли
  back: null            // что вернуть после показа
};

/* короткие ручки поверх того, что уже умеет плеер */
const shViz = v => { th().viz = v; applyTheme(); };
const shLay = v => { th().layout = v; applyTheme(); };
const shLy = v => { S.cfg.lyricsTheme = v; applyLyStyle(); };
const shTint = v => { th().tint = v; applyTheme(); };
const shAcc = c => { th().accentColor = c; applyTheme(); };
const th = () => (S.cfg.theme = S.cfg.theme || {});

/* ---- сетка ----
   at - секунда клипа, и каждая цифра тут кратна такту: вайб шагает по два,
   показ по одному, финал по половине, а концовка по доле - к концу быстрее */
const STEPS = [
  // вайб: только вид, ничего не объясняем. первые две секунды решают всё
  { at: 0.00,  go: () => { go('now'); shLay('cover'); shViz('kaleid'); shTint('mid'); } },
  { at: 5.31,  go: () => shViz('sphere') },
  { at: 10.62, go: () => shViz('ripple') },
  { at: 13.27, go: () => { shViz('pulsar'); shLay('stack'); } },

  // показ: строки тут меняются часто, заливку по словам видно целиком
  { at: 15.92, go: () => go('profile') },
  { at: 18.58, go: () => { go('themes'); shScroll('#v-themes', 1180); } },
  { at: 21.23, go: () => { shTint('full'); shAcc('#ba7878'); } },
  { at: 23.89, go: () => { go('now'); shLay('text'); shLy('word'); shAcc(''); shTint('mid'); } },
  { at: 26.54, go: () => shLy('marker') },

  // финал: низ вернулся, отпускаем
  { at: 29.19, go: () => { shLay('cover'); shLy('karaoke'); shViz('warp'); shTint('full'); } },
  { at: 30.52, go: () => shViz('ridge') },
  { at: 31.85, go: () => shViz('rain') },
  { at: 33.18, go: () => shViz('strings') },
  { at: 34.50, go: () => shViz('mirror') },
  { at: 35.83, go: () => shViz('radar') },
  { at: 37.16, go: () => shViz('tunnel') },
  { at: 37.82, go: () => shViz('vector') },
  { at: 38.48, go: () => shViz('pendulum') },
  { at: 39.15, go: () => shViz('kaleid') }
];

function shScroll(sel, top) {
  const n = document.querySelector(sel + ' .set-scroll');
  if (n) n.scrollTo({ top, behavior: 'smooth' });
}

/* ---- накладка с отсчётом ----
   нужна, чтобы было по чему обрезать начало записи */
function shCount(n) {
  let box = document.getElementById('show-count');
  if (!box) {
    box = el('div');
    box.id = 'show-count';
    box.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;'
      + 'align-items:center;justify-content:center;background:rgba(6,5,9,.92);'
      + 'font:700 128px/1 var(--font-ui);color:#fff;letter-spacing:-.04em';
    document.body.appendChild(box);
  }
  if (n <= 0) { box.remove(); return; }
  box.textContent = String(n);
}

function showStop(quiet) {
  if (!SHOW.on) return;
  SHOW.on = false;
  clearInterval(SHOW.timer);
  SHOW.timer = null;
  shCount(0);

  // возвращаем всё как было - иначе показ молча перекроит человеку настройки.
  // тему кладём целиком, а не поверх: при слиянии всё, что показ добавил нового,
  // так и осталось бы висеть - перекрас после показа застревал на "полном"
  const b = SHOW.back;
  if (b) {
    S.cfg.theme = b.theme;
    S.cfg.lyricsTheme = b.lyricsTheme;
    S.queue = b.queue;
    S.order = b.order;
    S.pos = b.pos;
    applyTheme();
    applyLyStyle();
    if (typeof repaintTheme === 'function') repaintTheme();
    go(b.view);
    SHOW.back = null;
  }
  pauseAll();
  if (!quiet) toast('Показ окончен');
}

// шагаем по таймеру, а не по кадрам: кадровый таймер засыпает вместе с окном,
// и тогда пропущенные шаги слипаются в один. догоняющий цикл ниже их всё равно
// отыграет, но лучше, чтобы догонять было нечего
function showTick() {
  if (!SHOW.on) return;

  const t = audio.currentTime - SHOW.from;     // ведём по треку, а не по часам:
  if (t >= SHOW.len) { showStop(); return; }   // так показ не уползёт от музыки

  for (let i = SHOW.at + 1; i < STEPS.length; i++) {
    if (STEPS[i].at > t) break;
    SHOW.at = i;
    try { STEPS[i].go(); } catch (e) { console.error('[показ]', e); }
  }
}

async function showStart() {
  if (SHOW.on) { showStop(); return; }

  const t = S.tracks.find(x => (x.title || '').toLowerCase().includes(SHOW.find));
  if (!t) { toast('Трек для показа не нашёлся: ' + SHOW.find); return; }

  SHOW.back = {
    theme: JSON.parse(JSON.stringify(th())),
    lyricsTheme: S.cfg.lyricsTheme,
    view: S.view || 'now',
    queue: S.queue.slice(),
    order: S.order.slice(),
    pos: S.pos
  };
  SHOW.on = true;
  SHOW.at = -1;

  // отсчёт: успеть нажать запись и получить кадр, по которому режется начало
  for (let n = 3; n > 0; n--) {
    shCount(n);
    await new Promise(r => setTimeout(r, 1000));
    if (!SHOW.on) return;
  }
  shCount(0);

  setQueue([t.id]);
  play(t);
  audio.currentTime = SHOW.from;
  STEPS[0].go();
  SHOW.at = 0;
  SHOW.timer = setInterval(showTick, 40);
}

window.addEventListener('keydown', e => {
  if (e.ctrlKey && e.altKey && e.shiftKey && (e.code === 'KeyP')) {
    e.preventDefault();
    showStart();
  }
  if (e.key === 'Escape' && SHOW.on) showStop();
}, true);
