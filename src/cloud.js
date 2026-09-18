/* ===================== облако: ЗАГЛУШКА =====================
   Это не работающая синхронизация, а макет, чтобы посмотреть на неё глазами.
   Наружу отсюда не уходит ни один байт: ни fetch, ни XHR, ни сокета - ничего
   такого в этом файле нет и быть не должно, пока решение не принято.

   Удаляется целиком и без следов:
     1. этот файл
     2. блок <div class="set-block set-try" id="cloud-block"> в index.html
     3. строка <script src="cloud.js"></script> внизу index.html
     4. раздел "облако - заглушка" в style.css
     5. строка go('облако', ...) в relabel() в app.js
   В настройках и в сохранённых данных заглушка ничего не заводит. */

const CLOUD = { on: false, peek: false, busy: false };

/* ---------- что вообще поехало бы наружу ----------
   Список нарочно белый, а не "всё кроме": так новая настройка не уедет
   в облако сама собой, если её кто-то допишет в store.js. И ключей тут нет:
   ytKey и всё подобное остаётся на этом компьютере при любом раскладе. */

function cloudPayload() {
  const c = S.cfg || {};
  const p = c.profile || {};
  return {
    плейлисты: (c.playlists || []).map(x => ({
      name: x.name,
      author: x.author || '',
      desc: x.desc || '',
      cover: x.cover ? '(своя картинка)' : '',
      tracks: (x.tracks || []).length
    })),
    любимые: (c.favorites || []).length,
    профиль: {
      name: p.name || '',
      tag: p.tag || '',
      status: p.status || '',
      about: p.about || '',
      links: p.links || {}
    },
    оформление: c.theme || {},
    наслушал: {
      треков: (c.stats || {}).total || 0,
      секунд: Math.round((c.stats || {}).seconds || 0)
    }
  };
}

// сколько это весит - чтобы было видно, что речь про килобайты, а не про музыку
function cloudSize() {
  try { return new Blob([JSON.stringify(cloudPayload())]).size; } catch { return 0; }
}

const cloudHuman = n => (n < 1024 ? TF`${n} Б` : TF`${Math.round(n / 1024)} КБ`);

/* ---------- плитки ---------- */

function renderCloud() {
  const box = $('cloud-stat');
  if (!box) return;

  const c = S.cfg || {};
  const size = cloudSize();
  const np = (c.playlists || []).length;
  const tiles = [
    [np, plural(np, 'плейлист', 'плейлиста', 'плейлистов')],
    [(c.favorites || []).length, 'в любимых'],
    [(c.profile || {}).name ? '1' : '0', 'профиль'],
    [cloudHuman(size), 'весит всё вместе']
  ];

  box.textContent = '';
  for (const [v, lab] of tiles) {
    const d = el('div', 'pf-stat');
    const b = el('b'); b.textContent = String(v);
    const s = el('span'); s.textContent = T(lab);
    d.append(b, s);
    box.appendChild(d);
  }

  const sw = $('s-cloud');
  if (sw) sw.checked = CLOUD.on;

  const note = $('cloud-note');
  if (note) {
    note.textContent = CLOUD.on
      ? T('Переключатель стоит, но он ни к чему не подключён — это макет.')
      : T('Выключено. Впрочем, включать нечего: сервера нет.');
  }
}

/* ---------- кнопки ---------- */

function cloudWire() {
  if (!$('cloud-block')) return;

  $('s-cloud').onchange = e => { CLOUD.on = e.target.checked; renderCloud(); };

  $('cloud-what').onclick = () => {
    CLOUD.peek = !CLOUD.peek;
    const pre = $('cloud-peek');
    show(pre, CLOUD.peek);
    if (CLOUD.peek) pre.textContent = JSON.stringify(cloudPayload(), null, 2);
    $('cloud-what').textContent = CLOUD.peek ? T('Свернуть') : T('Что ушло бы наружу');
  };

  // «сверка» целиком выдуманная: считаем свои же данные и показываем,
  // сколько времени и места это заняло бы. Никуда не ходим
  $('cloud-try').onclick = async () => {
    if (CLOUD.busy) return;
    CLOUD.busy = true;
    const btn = $('cloud-try');
    const note = $('cloud-note');
    const was = btn.textContent;
    btn.disabled = true;

    const t0 = performance.now();
    const size = cloudSize();

    const human = cloudHuman(size);
    const wait = ms => new Promise(r => setTimeout(r, ms));

    note.textContent = T('собираю, что менялось…');
    await wait(420);
    note.textContent = TF`отправил бы ${human}…`;
    await wait(520);
    note.textContent = T('жду ответа…');
    await wait(460);

    const ms = Math.round(performance.now() - t0);
    note.textContent = TF`Понарошку: собрал за ${ms} мс. Наружу не отправлено ничего — этой сверки не было.`;
    btn.textContent = was;
    btn.disabled = false;
    CLOUD.busy = false;
  };

  renderCloud();
}

cloudWire();
