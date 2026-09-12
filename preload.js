// мост между окном и системой. renderer не имеет прямого доступа к node
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// адрес локального сервера и секрет сессии приходят из главного процесса
const arg = name => (process.argv.find(a => a.startsWith('--aung-' + name + '=')) || '').split('=')[1] || '';
const BASE = arg('base');
const TOKEN = arg('token');

const on = (ch, fn) => {
  const h = (e, payload) => fn(payload);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.off(ch, h);
};

contextBridge.exposeInMainWorld('api', {
  info:        ()        => ipcRenderer.invoke('app:info'),

  settings: {
    get:       ()        => ipcRenderer.invoke('settings:get'),
    set:       patch     => ipcRenderer.invoke('settings:set', patch)
  },

  lib: {
    list:      ()        => ipcRenderer.invoke('lib:list'),
    scan:      ()        => ipcRenderer.invoke('lib:scan'),
    pick:      ()        => ipcRenderer.invoke('lib:pickFolder'),
    remove:    folder    => ipcRenderer.invoke('lib:removeFolder', folder),
    reveal:    p         => ipcRenderer.invoke('lib:reveal', p),
    drop:      paths     => ipcRenderer.invoke('lib:drop', paths),
    onProgress: fn       => on('lib:progress', fn),
    onArtwork: fn        => on('lib:artwork', fn),
    onArtworkDone: fn    => on('lib:artwork-done', fn)
  },

  lyrics: {
    get:       t         => ipcRenderer.invoke('lyrics:get', t)
  },

  dl: {
    status:    ()        => ipcRenderer.invoke('dl:status'),
    install:   ()        => ipcRenderer.invoke('dl:install'),
    onInstall: fn        => on('dl:install', fn),
    pickFolder:()        => ipcRenderer.invoke('dl:pickFolder'),
    add:       items     => ipcRenderer.invoke('dl:add', items),
    queue:     ()        => ipcRenderer.invoke('dl:queue'),
    cancel:    key       => ipcRenderer.invoke('dl:cancel', key),
    clear:     what      => ipcRenderer.invoke('dl:clear', what),
    pause:     on        => ipcRenderer.invoke('dl:pause', on),
    playlist:  url       => ipcRenderer.invoke('dl:playlist', url),
    onQueue:   fn        => on('dl:queue', fn),
    onAdded:   fn        => on('dl:added', fn)
  },

  studio: {
    save:      p         => ipcRenderer.invoke('studio:save', p)
  },

  upd: {
    state:     ()        => ipcRenderer.invoke('upd:state'),
    check:     ()        => ipcRenderer.invoke('upd:check'),
    download:  ()        => ipcRenderer.invoke('upd:download'),
    install:   ()        => ipcRenderer.invoke('upd:install'),
    onState:   fn        => on('upd:state', fn)
  },

  backup: {
    save:      ()        => ipcRenderer.invoke('backup:export'),
    load:      ()        => ipcRenderer.invoke('backup:import'),
    onProgress: fn       => on('backup:progress', fn)
  },

  stream: {
    youtube:   q         => ipcRenderer.invoke('yt:search', q),
    resolve:   url       => ipcRenderer.invoke('stream:resolve', url)
  },

  search: {
    query:     q         => ipcRenderer.invoke('search:query', q),
    fixTags:   ()        => ipcRenderer.invoke('search:fixTags'),
    applyMeta: (id, meta) => ipcRenderer.invoke('lib:applyMeta', { id, meta }),
    onProgress: fn       => on('search:progress', fn)
  },

  video: {
    pick:      ()        => ipcRenderer.invoke('video:pick'),
    clear:     ()        => ipcRenderer.invoke('video:clear'),
    list:      ()        => ipcRenderer.invoke('video:list')
  },

  profile: {
    pick:      (kind, key) => ipcRenderer.invoke('profile:pick', kind, key)
  },

  smtc: {
    get:       ()        => ipcRenderer.invoke('smtc:get'),
    control:   what      => ipcRenderer.invoke('smtc:control', what),
    onUpdate:  fn        => on('smtc:update', fn)
  },

  discord: {
    state:     ()        => ipcRenderer.invoke('discord:state'),
    reconnect: ()        => ipcRenderer.invoke('discord:reconnect'),
    onState:   fn        => on('discord:state', fn)
  },

  player: {
    report:    s         => ipcRenderer.send('player:state', s)
  },

  win: {
    full:      on        => ipcRenderer.send('win:full', on),
    min:       ()        => ipcRenderer.send('win:min'),
    max:       ()        => ipcRenderer.send('win:max'),
    close:     ()        => ipcRenderer.send('win:close'),
    onMax:     fn        => on('win:max-changed', fn)
  },

  onHotkey:    fn        => on('hotkey', fn),
  openExternal: url      => ipcRenderer.send('open:external', url),
  openUserData: ()       => ipcRenderer.send('open:userdata'),

  // из брошенного в окно File достаём путь на диске
  pathForFile: f => { try { return webUtils.getPathForFile(f); } catch { return ''; } },

  // путь к файлу -> ссылка, которую понимает <audio> и <img>.
  // тот же origin, что и у страницы, иначе canvas не пустит к пикселям обложки
  file: p => p ? `${BASE}/media?t=${TOKEN}&p=${encodeURIComponent(p)}` : ''
});
