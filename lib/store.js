// настройки: лежат в %APPDATA%/vsluh/settings.json
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  lang: 'ru',             // язык интерфейса: ru | uk | en
  folders: [],            // папки с музыкой
  volume: 0.45,
  shuffle: false,
  repeat: 'off',          // off | all | one
  lastTrack: null,
  view: 'now',

  favorites: [],          // id любимых треков
  playlists: [],          // {id, name, tracks:[id], cover, color}
  profiles: [],           // своё оформление: {id, name, at, cfg} - см. PRESETS в app.js

  // кто ты в этом плеере. живёт только здесь: ни аккаунта, ни сервера,
  // наружу уходит лишь тем, что ты сам поставишь на карточку или в клип
  profile: {
    name: '',             // никнейм
    tag: '',              // короткое имя после @
    status: '',           // одна строка под именем
    about: '',            // несколько строк о себе
    avatar: '',           // файл в папке приложения или https-ссылка
    banner: '',           // широкая картинка над профилем
    bg: '',               // фон всей вкладки
    color: '',            // цвет ника; пусто - берём из обложки
    title: '',            // титул рядом с ником
    titleColor: ''
  },

  // считается на твоём компьютере и никуда не уходит.
  // нужно для "Моей волны" и для титулов, которые зарабатываются
  stats: {
    plays: {},            // id трека -> сколько раз дослушан
    last: {},             // id трека -> когда слушали в последний раз
    total: 0,             // всего дослушано треков
    seconds: 0            // всего просидели со звуком
  },

  wave: {
    mode: 'usual',        // usual | fav | rare | artist
    on: false             // включена ли сейчас
  },
  libTab: 'all',          // all | fav | id плейлиста
  libSort: 'artist',      // artist | title | album | added | duration

  // эквалайзер: 10 полос, усиление в дБ
  eq: {
    on: false,
    preset: 'flat',
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  },

  accent: true,           // подкрашивать интерфейс под обложку
  rate: 1,                // скорость воспроизведения
  ratePitch: false,       // менять тон вместе со скоростью (эффект slowed)
  videoFolder: '',        // папка с фоновыми видео
  ytKey: '',              // ключ YouTube Data API; с yt-dlp он не нужен
  downloadFolder: '',     // куда складывать скачанное (пусто - выберем сами)
  dlCookies: '',          // откуда брать куки для YouTube: '' | chrome | edge | firefox | brave | opera | vivaldi

  // всё, что относится к внешнему виду - вкладка "Темы"
  theme: {
    preset: 'vinyl',
    profile: '',          // id применённого своего профиля, если он есть
    layout: 'stack',      // как расставлены обложка и текст: stack | apple | side | text | cover
    accentColor: '',      // свой цвет; пусто - берём из обложки или стандартный
    fontUi: 'system',     // шрифт интерфейса
    fontLy: 'system',     // шрифт названия и текста песни
    uiSize: 14,           // размер шрифта интерфейса, px
    uiWeight: 0,          // 0 - как в теме, иначе 400..700
    barRound: false,      // круглая обложка в нижней панели
    barProg: 'line',      // как показывать прогресс внизу: line | fill
    tint: 'mid',          // перекрас интерфейса под цвет: off | soft | mid | full
    viz: 'ring',          // ring | radial | wave | bars | dust | off и остальные из p-viz
    vizPower: 100,        // насколько бурная визуализация, %
    vizSpeed: 100,        // скорость движения, %
    vizAlpha: 100,        // насыщенность: чем меньше, тем меньше мешает читать текст
    vizAuto: 'off',       // сама менять вид: off | track | 60 | 300 (секунды)
    disc: 'vinyl',        // vinyl | square | plain
    spin: true,           // крутить обложку
    beat: true,           // пульс от баса
    bg: 'cover',          // cover | video | url | plain
    bgUrl: '',            // ссылка на картинку или видео для фона
    bgBlur: 80,
    bgDim: 42             // затемнение фона, %
  },

  lyrics: true,
  lyricsOffset: 0,
  lyricsTheme: 'karaoke', // soft | karaoke | focus | feed | type
  lyricsSize: 'md',       // sm | md | lg
  lyricsGlow: true,
  lyricsBlur: true,
  particles: true,
  hotkeys: {
    on: true,
    mediaKeys: true,      // отдавать медиа-клавиши нам, а не чужому плееру
    playPause: 'Ctrl+Alt+Space',
    next: 'Ctrl+Alt+Right',
    prev: 'Ctrl+Alt+Left',
    volUp: 'Ctrl+Alt+Up',
    volDown: 'Ctrl+Alt+Down'
  },
  discord: {
    on: false,
    clientId: '',         // https://discord.com/developers/applications -> Application ID
    showSystem: true,     // показывать и то, что играет в других плеерах
    idleHide: true        // прятать статус на паузе
  },
  smtc: { on: true },
  // переход между треками: сколько секунд сводить и надо ли выравнивать громкость
  xfade: 0,                 // 0 - выключено, иначе секунды
  xfadeManual: true,        // сводить и при переключении руками
  level: false,             // подводить треки к общей громкости

  updates: { on: true },    // проверять новую версию при запуске
  welcomed: false,          // показывали ли экран первого запуска
  artwork: { on: true }     // искать обложки в сети, если их нет в файле
};

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);

  for (const k of Object.keys(patch || {})) {
    const v = patch[k];
    if (v === undefined) continue;
    const b = base ? base[k] : undefined;

    const bObj = !!b && typeof b === 'object' && !Array.isArray(b);
    const vObj = !!v && typeof v === 'object' && !Array.isArray(v);

    if (bObj && vObj) { out[k] = deepMerge(b, v); continue; }

    // настройка поменяла форму между версиями (было true, стало объект) -
    // сохранённое значение выбрасываем и берём стандартное
    if (b !== undefined && (bObj !== vObj || Array.isArray(b) !== Array.isArray(v))) continue;

    out[k] = v;
  }
  return out;
}

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = Object.assign({}, DEFAULTS);
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = deepMerge(DEFAULTS, raw);
    } catch { /* первый запуск */ }
    this._t = null;
  }
  get all() { return this.data; }
  set(patch) {
    this.data = deepMerge(this.data, patch);
    clearTimeout(this._t);
    this._t = setTimeout(() => this.flush(), 300);
    return this.data;
  }
  flush() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) { console.error('settings save', e); }
  }
}

module.exports = { Store, DEFAULTS };
