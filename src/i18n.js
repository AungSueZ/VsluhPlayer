/* ===================== языки =====================
   ключом служит сам русский текст. так ничего не теряется: если перевода нет,
   на экране останется русская строка, а не пустое место и не 'settings.title'.
   словарь лежит в lang.js и грузится раньше этого файла */

const LANGS = [
  { id: 'ru', name: 'Русский' },
  { id: 'uk', name: 'Українська' },
  { id: 'en', name: 'English' }
];

let LANG = 'ru';

/* перевод одной строки */
function T(s) {
  if (LANG === 'ru' || !s) return s;
  const d = (window.DICT || {})[LANG];
  if (!d) return s;
  const v = d[s];
  if (v) return v;
  // строка могла прийти уже с обрезанными краями
  const t = String(s).trim();
  return (t !== s && d[t]) ? String(s).replace(t, d[t]) : s;
}

/* теговый шаблон для строк с подстановкой:
   TF`Выключусь через ${min} мин` ищет ключ "Выключусь через {0} мин" */
function TF(strs, ...vals) {
  const key = strs.raw.map((x, i) => x + (i < vals.length ? '{' + i + '}' : '')).join('');
  return T(key).replace(/\{(\d+)\}/g, (_, i) => (vals[i] ?? ''));
}

/* ---- статическая разметка ----
   снимок делается один раз, пока плеер ещё ничего не нарисовал: в него попадает
   только то, что написано в index.html. названия треков и прочее, что рисует
   сам плеер, сюда не попадёт и случайно переведено не будет */
const SNAP = { text: [], attr: [], done: false };
const TR_ATTRS = ['placeholder', 'title', 'aria-label', 'data-ph'];
const CYR = /[А-Яа-яЁё]/;

function snapshot() {
  if (SNAP.done) return;
  SNAP.done = true;

  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const p = n.parentNode;
    if (!p || p.tagName === 'SCRIPT' || p.tagName === 'STYLE') continue;
    if (CYR.test(n.nodeValue)) SNAP.text.push({ node: n, ru: n.nodeValue });
  }
  for (const el of document.querySelectorAll('*')) {
    for (const a of TR_ATTRS) {
      const v = el.getAttribute(a);
      if (v && CYR.test(v)) SNAP.attr.push({ el, a, ru: v });
    }
  }
}

/* перерисовать разметку на выбранном языке.
   всегда переводим из сохранённого русского, поэтому переключать можно туда-сюда */
function paintLang() {
  document.documentElement.lang = LANG;
  for (const it of SNAP.text) {
    // пробелы и переносы вокруг текста сохраняем, иначе разъедется вёрстка
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(it.ru);
    it.node.nodeValue = m[1] + T(m[2].replace(/\s+/g, ' ')) + m[3];
  }
  for (const it of SNAP.attr) it.el.setAttribute(it.a, T(it.ru));
}

function setLang(id) {
  LANG = LANGS.some(l => l.id === id) ? id : 'ru';
  paintLang();
}

snapshot();
