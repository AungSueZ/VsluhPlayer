/* ===================== живой пример текста =====================
   Маленький блок в настройках, который крутит несколько строк по кругу и
   слушается тех же настроек, что и настоящий текст песни. Нужен затем, чтобы
   выбирать подачу на месте, а не бегать на "Сейчас играет" после каждого клика.

   Разметка у него та же самая (.ly > .ly-track > .ly-item > .ly-txt > .ly-w),
   поэтому все подачи работают в нём сами собой, без единой особой строчки CSS. */

const LP = {
  lines: [], items: [], words: [],
  cur: -2, nowWord: null,
  raf: 0, t0: 0, on: false
};

// четыре строки по кругу. короткие: в примере важно видеть заливку по словам,
// а длинная строка переносится и читается хуже
const LP_TEXT = [
  'Строка догорает ровно в такт',
  'Слова подсвечиваются по одному',
  'Так это будет выглядеть',
  'Подачу видно сразу'
];
const LP_STEP = 2.6;                       // сколько держится одна строка
const LP_LOOP = LP_TEXT.length * LP_STEP + 1.2;

function lpBuild() {
  const track = $('lyp-track');
  if (!track) return;
  track.textContent = '';
  LP.items = [];
  LP.words = [];
  LP.cur = -2;
  LP.nowWord = null;
  LP.lines = LP_TEXT.map((txt, n) => ({ t: n * LP_STEP, text: T(txt) }));

  for (const l of LP.lines) {
    const d = el('div', 'ly-item');
    const s = el('span', 'ly-txt');
    const words = [];
    let at = 0;

    for (const part of String(l.text).split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { s.appendChild(document.createTextNode(part)); at += part.length; continue; }
      const w = el('i', 'ly-w');
      w.textContent = part;
      const n = words.length;
      w.style.setProperty('--i', n);
      w.style.setProperty('--dx', (spread(n, 1) * 70 - 35).toFixed(1));
      w.style.setProperty('--dy', (spread(n, 2) * 44 - 22).toFixed(1));
      w.style.setProperty('--rr', (spread(n, 3) * 24 - 12).toFixed(1));
      s.appendChild(w);
      words.push({ node: w, at, len: part.length });
      at += part.length;
    }

    LP.words.push(words);
    d.appendChild(s);
    track.appendChild(d);
    LP.items.push(d);
  }
}

/* те же классы, что и у настоящего блока - иначе пример врал бы */
function lpClasses() {
  const box = $('lyp');
  if (!box) return;
  box.className = 'ly'
    + ' t-' + (S.cfg.lyricsTheme || 'soft')
    + ' sz-' + (S.cfg.lyricsSize || 'md')
    + (S.cfg.lyricsGlow === false ? ' no-glow' : '')
    + (S.cfg.lyricsBlur !== false ? ' blur' : '');
}

/* подводим текущую строку к середине - как centerLyrics у настоящего */
function lpCenter(i) {
  const box = $('lyp'), track = $('lyp-track');
  if (!box || !track) return;
  const h = box.clientHeight;
  if (!h) return;
  const it = LP.items[i];
  const y = it ? h / 2 - it.offsetTop - it.offsetHeight / 2 : h / 2 - 20;
  track.style.transform = 'translateY(' + Math.round(y) + 'px)';
}

function lpFill(t, i) {
  const th = S.cfg.lyricsTheme;
  if (!FILL_THEMES[th]) return;
  const line = LP.lines[i], words = LP.words[i];
  if (!line || !words || !words.length) return;

  // у примера нет таймингов слов - заливаем ровно, с запасом в конце,
  // чтобы строка успевала догореть до прихода следующей
  const p = Math.max(0, Math.min(1, (t - line.t) / (LP_STEP * 0.82)));
  const target = p * (line.text.length || 1);
  let now = -1;

  for (let n = 0; n < words.length; n++) {
    const w = words[n];
    let k = Math.max(0, Math.min(1, (target - w.at) / w.len));
    if (th === 'type') k = Math.ceil(k * w.len) / w.len;
    w.node.style.setProperty('--wp', (k * 100).toFixed(1) + '%');
    if (k > 0) now = n;

    if (th === 'wave') {
      const c = w.at + w.len / 2;
      const dd = (target - c) / 7;
      const lift = p >= 0.999 || Math.abs(dd) >= 1 ? 0 : Math.cos(dd * Math.PI / 2);
      w.node.style.setProperty('--lift', lift.toFixed(3));
    }
  }

  if (th === 'word') {
    const node = now >= 0 ? words[now].node : null;
    if (node !== LP.nowWord) {
      if (LP.nowWord) LP.nowWord.classList.remove('now');
      if (node) node.classList.add('now');
      LP.nowWord = node;
    }
  } else if (LP.nowWord) {
    LP.nowWord.classList.remove('now');
    LP.nowWord = null;
  }
}

function lpTick() {
  if (!LP.on) return;
  LP.raf = requestAnimationFrame(lpTick);

  const t = ((performance.now() - LP.t0) / 1000) % LP_LOOP;

  let i = -1;
  for (let k = 0; k < LP.lines.length; k++) {
    if (LP.lines[k].t <= t) i = k; else break;
  }

  if (i !== LP.cur) {
    if (LP.items[LP.cur]) LP.items[LP.cur].classList.remove('on');
    LP.cur = i;
    for (let k = 0; k < LP.items.length; k++) {
      const d = Math.min(7, Math.abs(k - i));
      const st = LP.items[k].style;
      st.setProperty('--d', d);
      st.setProperty('--past', k < i ? d : 0);
      st.setProperty('--soon', k > i ? d : 0);
    }
    if (LP.items[i]) LP.items[i].classList.add('on');
    lpCenter(i);
  }
  lpFill(t, i);
}

function lpStart() {
  if (LP.on || !$('lyp')) return;
  LP.on = true;
  if (!LP.items.length) lpBuild();
  lpClasses();
  LP.t0 = performance.now();
  LP.cur = -2;
  // высоты у скрытой вкладки нулевые - ждём кадр, иначе строка не встанет в середину
  requestAnimationFrame(() => { lpCenter(LP.cur < 0 ? 0 : LP.cur); });
  LP.raf = requestAnimationFrame(lpTick);
}

function lpStop() {
  LP.on = false;
  cancelAnimationFrame(LP.raf);
  LP.raf = 0;
}

// язык сменился - пересобрать строки примера
function lpRelang() {
  if (!$('lyp')) return;
  lpBuild();
  lpClasses();
  LP.cur = -2;
  if (LP.on) LP.t0 = performance.now();
}
