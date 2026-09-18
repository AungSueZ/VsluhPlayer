/* ===================== облако: ЗАГЛУШКА =====================
   Это не работающая синхронизация, а макет, чтобы посмотреть на неё глазами.
   Наружу отсюда не уходит ни один байт: ни fetch, ни XHR, ни сокета - ничего
   такого в этом файле нет и быть не должно, пока решение не принято.

   Удаляется целиком и без следов:
     1. этот файл
     2. блоки #cloud-block и #cloud-win в index.html
     3. строка <script src="cloud.js"></script> внизу index.html
     4. раздел "облако - заглушка" в style.css
     5. строка go('облако', ...) в relabel() в app.js
   В настройках и в сохранённых данных заглушка ничего не заводит. */

const CLOUD = {
  on: false, peek: false, busy: false,
  // вход - тоже понарошку. Почта живёт в памяти до закрытия окна и никуда
  // не записывается: ни в settings.json, ни в хранилище браузера, ни наружу.
  // Пароля нет нарочно: нечего придумывать, нечего хранить и нечего терять
  auth: { step: 'out', mail: '' }        // out | sent | in
};

const MAILISH = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;

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

/* ---------- вход ----------
   Живёт в отдельном окне, как Студия: регистрация - это не строчка в
   настройках, а отдельный разговор, и выглядеть должна соответственно.
   Всё по-прежнему понарошку. */

const cloudFoot = () => {
  const f = el('div', 'cloud-win-foot');
  f.textContent = T('Это заглушка. Ни одна буква отсюда никуда не уходит и нигде не сохраняется — ни на сервер, ни в настройки.');
  return f;
};

function cloudWin(on) {
  const w = $('cloud-win');
  if (!w) return;
  if (on) renderWin();
  show(w, on);
  if (on) { const i = $('cloud-win-mail'); if (i) i.focus(); }
}

function renderWin() {
  const box = $('cloud-win-body');
  if (!box) return;
  box.textContent = '';

  const a = CLOUD.auth;
  const mark = el('div', 'cloud-win-mark');
  const tt = el('div', 'cloud-win-t');
  const ss = el('div', 'cloud-win-s');

  // письмо ушло - ждём, пока человек по нему перейдёт
  if (a.step === 'sent') {
    mark.textContent = '✉';
    tt.textContent = T('Проверь почту');
    ss.textContent = TF`Письмо ушло бы на ${a.mail}. Открыть ссылку — и всё.`;

    const go = el('button', 'btn');
    go.textContent = T('Понарошку: я перешёл по ссылке');
    go.onclick = () => { CLOUD.auth.step = 'in'; cloudWin(false); renderCloud(); };

    const back = el('button', 'btn btn-ghost');
    back.textContent = T('Другая почта');
    back.onclick = () => { CLOUD.auth = { step: 'out', mail: '' }; renderWin(); };

    box.append(mark, tt, ss, go, back, cloudFoot());
    return;
  }

  mark.textContent = '◈';
  tt.textContent = T('Вслух в облаке');
  ss.textContent = T('Плейлисты, любимое и оформление — на всех твоих компьютерах. Сама музыка остаётся там, где лежит.');

  const inp = el('input');
  inp.type = 'email';
  inp.id = 'cloud-win-mail';
  inp.placeholder = T('почта');
  inp.autocomplete = 'off';
  inp.spellcheck = false;
  inp.value = a.mail;

  const err = el('p', 'cloud-win-err');
  const send = el('button', 'btn');
  send.textContent = T('Прислать ссылку');

  const go = () => {
    const v = inp.value.trim();
    if (!MAILISH.test(v)) {
      inp.classList.add('bad');
      err.textContent = T('Это не похоже на почту.');
      inp.focus();
      return;
    }
    CLOUD.auth = { step: 'sent', mail: v };
    renderWin();
  };

  send.onclick = go;
  inp.oninput = () => { inp.classList.remove('bad'); err.textContent = ''; CLOUD.auth.mail = inp.value; };
  inp.onkeydown = e => { if (e.key === 'Enter') go(); };

  const note = el('p', 'cloud-win-s');
  note.style.margin = '14px 0 0';
  note.textContent = T('Пароля нет: приходит письмо со ссылкой, по ней и вход. Нечего придумывать, нечего хранить и нечего у нас красть.');

  box.append(mark, tt, ss, inp, err, send, note, cloudFoot());
}

/* ---- то, что видно в настройках ---- */

function renderAuth() {
  const box = $('cloud-auth');
  if (!box) return;
  box.textContent = '';

  const a = CLOUD.auth;

  if (a.step === 'in') {
    const card = el('div', 'cloud-me');
    const ava = el('div', 'cloud-ava');
    ava.textContent = (a.mail[0] || '?');
    const m = el('div', 'cloud-me-m');
    const b = el('b'); b.textContent = a.mail;
    const sp = el('span'); sp.textContent = T('вошёл понарошку · ни сеанса, ни ключа');
    m.append(b, sp);
    const out = el('button', 'btn btn-ghost');
    out.textContent = T('Выйти');
    out.onclick = () => { CLOUD.auth = { step: 'out', mail: '' }; CLOUD.on = false; renderCloud(); };
    card.append(ava, m, out);
    box.appendChild(card);
    return;
  }

  const row = el('div', 'row-btns');
  const b = el('button', 'btn');
  b.textContent = T('Войти или завести');
  b.onclick = () => cloudWin(true);
  row.appendChild(b);
  box.appendChild(row);
}

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

  const inside = CLOUD.auth.step === 'in';

  // без входа синхронизировать нечего и не с чем - переключатель это показывает
  const sw = $('s-cloud');
  if (sw) { sw.checked = CLOUD.on && inside; sw.disabled = !inside; }
  const lbl = sw && sw.closest('.sw');
  if (lbl) lbl.style.opacity = inside ? '' : '.45';

  const note = $('cloud-note');
  if (note) {
    note.textContent = !inside
      ? T('Сначала вход — потом уже синхронизация. Хотя и после входа синхронизировать не с чем: сервера нет.')
      : CLOUD.on
        ? T('Переключатель стоит, но он ни к чему не подключён — это макет.')
        : T('Выключено. Впрочем, включать нечего: сервера нет.');
  }

  renderAuth();
}

/* ---------- кнопки ---------- */

function cloudWire() {
  if (!$('cloud-block')) return;

  $('cloud-win-x').onclick = () => cloudWin(false);
  $('cloud-win').addEventListener('click', e => { if (e.target.id === 'cloud-win') cloudWin(false); });
  // перехватываем раньше общего обработчика: пока окно открыто, Escape - его
  addEventListener('keydown', e => {
    if (e.key !== 'Escape' || $('cloud-win').hasAttribute('hidden')) return;
    e.stopPropagation();
    cloudWin(false);
  }, true);

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
