// настройки: лежат в %APPDATA%/vsluh/settings.json
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  folders: [],            // папки с музыкой
  volume: 0.45,
  shuffle: false,
  repeat: 'off',          // off | all | one
  lastTrack: null,
  view: 'now',

  favorites: [],          // id любимых треков
  playlists: [],          // {id, name, tracks:[id]}
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
    layout: 'stack',      // как расставлены обложка и текст: stack | apple | side | text | cover
    accentColor: '',      // свой цвет; пусто - берём из обложки или стандартный
    fontUi: 'system',     // шрифт интерфейса
    fontLy: 'system',     // шрифт названия и текста песни
    viz: 'ring',          // ring | radial | wave | bars | dust | off
    vizPower: 100,        // насколько бурная визуализация, %
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
