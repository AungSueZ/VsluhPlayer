// Отдельный процесс для слежки за чужими плеерами.
// В главном процессе Electron инициализация WinRT намертво вешает цикл событий,
// поэтому native-модуль живёт здесь, а наружу уходят уже готовые снимки.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATUS = { 0: 'closed', 1: 'opened', 2: 'changing', 3: 'stopped', 4: 'playing', 5: 'paused' };

const NAMES = [
  [/spotify/i,              'Spotify'],
  [/yandex|music\.yandex/i, 'Яндекс Музыка'],
  [/vk|boom/i,              'VK Музыка'],
  [/chrome/i,               'Chrome'],
  [/msedge|edge/i,          'Edge'],
  [/firefox/i,              'Firefox'],
  [/opera/i,                'Opera'],
  [/zen\.browser/i,         'Zen'],
  [/ayugram|telegram|64gram/i, 'Telegram'],
  [/aimp/i,                 'AIMP'],
  [/foobar/i,               'foobar2000'],
  [/vlc/i,                  'VLC'],
  [/musicbee/i,             'MusicBee'],
  [/itunes|apple/i,         'Apple Music'],
  [/deezer/i,               'Deezer'],
  [/soundcloud/i,           'SoundCloud'],
  [/discord/i,              'Discord'],
  [/steam/i,                'Steam']
];

function prettyName(id) {
  for (const [re, name] of NAMES) if (re.test(id)) return name;
  const short = String(id).split('!')[0].split('_')[0].replace(/\.exe$/i, '');
  const tail = short.split('.').filter(Boolean).pop() || short;
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

const cacheDir = process.argv[2] || path.join(require('os').tmpdir(), 'aung-smtc');
const selfMatch = new RegExp(process.argv[3] || 'aung.?player|^electron', 'i');
fs.mkdirSync(cacheDir, { recursive: true });

const port = process.parentPort;
const say = (type, data) => { try { port.postMessage({ type, data }); } catch {} };

function thumb(buf) {
  if (!buf || !buf.length) return null;
  try {
    const h = crypto.createHash('md5').update(buf).digest('hex').slice(0, 16);
    const f = path.join(cacheDir, h + '.jpg');
    if (!fs.existsSync(f)) fs.writeFileSync(f, buf);
    return f;
  } catch { return null; }
}

function map(m) {
  const st = STATUS[m.playback?.playbackStatus] || 'stopped';
  return {
    id: m.sourceAppId,
    app: prettyName(m.sourceAppId),
    title: (m.media?.title || '').trim(),
    artist: (m.media?.artist || m.media?.albumArtist || '').trim(),
    album: (m.media?.albumTitle || '').trim(),
    status: st,
    playing: st === 'playing',
    position: Math.max(0, Math.round(m.timeline?.position || 0)),
    duration: Math.max(0, Math.round(m.timeline?.duration || 0)),
    cover: thumb(m.media?.thumbnail),
    updated: m.lastUpdatedTime || Date.now()
  };
}

let Mon = null, mon = null, currentId = null;

function snapshot() {
  let list = [];
  try { list = Mon.getMediaSessions() || []; } catch { return { sessions: [], current: null }; }

  const sessions = list
    .filter(m => m.sourceAppId && !selfMatch.test(m.sourceAppId))
    .filter(m => (m.media?.title || '').trim())
    .map(map);

  const current = sessions.find(s => s.id === currentId && s.playing)
               || sessions.find(s => s.playing)
               || sessions.slice().sort((a, b) => b.updated - a.updated)[0]
               || null;

  return { sessions, current };
}

let timer = null;
function push() {
  // события прилетают пачками - склеиваем
  clearTimeout(timer);
  timer = setTimeout(() => say('update', snapshot()), 150);
}

try {
  ({ SMTCMonitor: Mon } = require('@coooookies/windows-smtc-monitor'));
  mon = new Mon();
  for (const ev of ['session-media-changed', 'session-timeline-changed',
                    'session-playback-changed', 'session-added', 'session-removed']) {
    mon.on(ev, push);
  }
  mon.on('current-session-changed', id => { currentId = id; push(); });
  try { currentId = Mon.getCurrentMediaSession()?.sourceAppId || null; } catch {}

  say('ready', null);
  say('update', snapshot());

  // подстраховка: позиция трека сама по себе событий не шлёт
  setInterval(() => say('update', snapshot()), 4000);
} catch (e) {
  say('error', String(e && e.message || e));
}

port.on('message', e => {
  const msg = e.data || {};
  if (msg.cmd === 'snapshot') say('update', snapshot());
  else if (msg.cmd === 'stop') { try { mon && mon.destroy(); } catch {} process.exit(0); }
});
