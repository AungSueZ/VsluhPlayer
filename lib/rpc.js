// статус в Discord: "слушает <трек>" с обложкой и полоской времени
const { Client } = require('@xhayper/discord-rpc');
// у Discord нет доступа к файлам на диске, поэтому обложку ищем в сети по названию
const { searchCoverUrl: findCoverUrl } = require('./artwork');

// Discord режет строки короче 2 и длиннее 128 символов
const fit = (s, fallback) => {
  s = String(s || '').trim();
  if (s.length > 128) s = s.slice(0, 127) + '…';
  if (s.length < 2) return fallback || null;
  return s;
};

class Presence {
  constructor() {
    this.client = null;
    this.clientId = null;
    this.ready = false;
    this.last = '';
    this.pending = null;
    this.timer = null;
    this.retry = null;
    this.onState = () => {};
  }

  status() {
    return { on: !!this.client, ready: this.ready, clientId: this.clientId };
  }

  connect(clientId) {
    if (!clientId) return;
    if (this.client && this.clientId === clientId) return;
    this.disconnect();
    this.clientId = clientId;

    const c = new Client({ clientId });
    this.client = c;

    c.on('ready', () => {
      this.ready = true;
      this.onState(this.status());
      if (this.pending) this._push(this.pending);
    });
    c.on('disconnected', () => {
      this.ready = false;
      this.onState(this.status());
      this._scheduleRetry();
    });

    c.login().catch(e => {
      this.ready = false;
      this.onState(Object.assign(this.status(), { error: String(e.message || e) }));
      this._scheduleRetry();
    });
  }

  _scheduleRetry() {
    // дискорд может быть ещё не запущен - пробуем раз в полминуты
    clearTimeout(this.retry);
    if (!this.clientId) return;
    this.retry = setTimeout(() => {
      const id = this.clientId;
      this.disconnect(true);
      this.connect(id);
    }, 30000);
  }

  disconnect(keepId = false) {
    clearTimeout(this.retry);
    clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.last = '';
    this.ready = false;
    if (this.client) { try { Promise.resolve(this.client.destroy()).catch(() => {}); } catch {} }
    this.client = null;
    if (!keepId) this.clientId = null;
    this.onState(this.status());
  }

  clear() {
    this.pending = null;
    this.last = 'cleared';
    if (!this.client || !this.ready) return;
    // дискорд могли закрыть в любой момент - обещание отвалится, это нормально
    try { Promise.resolve(this.client.user?.clearActivity()).catch(() => {}); } catch {}
  }

  // {title, artist, album, playing, position, duration, app}
  async set(t) {
    if (!this.client) return;
    if (!t || !t.title) return this.clear();

    const url = await findCoverUrl(t.artist, t.title);
    const act = {
      type: 2, // Listening
      details: fit(t.title, 'Неизвестный трек'),
      state: fit(t.artist ? 'от ' + t.artist : t.album, 'Неизвестный исполнитель'),
      largeImageKey: url || 'cover',
      largeImageText: fit(t.album || t.app || 'Вслух', 'Вслух'),
      smallImageKey: t.playing ? 'play' : 'pause',
      smallImageText: t.playing ? 'Играет' : 'Пауза',
      instance: false
    };

    if (t.playing && t.duration > 0) {
      const now = Date.now();
      act.startTimestamp = now - Math.round((t.position || 0) * 1000);
      act.endTimestamp = act.startTimestamp + Math.round(t.duration * 1000);
    }

    // не дёргаем дискорд, если ничего по сути не изменилось
    const sig = [act.details, act.state, act.smallImageKey, act.largeImageKey,
                 Math.round((act.endTimestamp || 0) / 1000)].join('|');
    if (sig === this.last) return;
    this.last = sig;
    this._push(act);
  }

  // не чаще одного обновления в 4 секунды - у Discord лимит
  _push(act) {
    this.pending = act;
    if (this.timer) return;
    const send = () => {
      const a = this.pending;
      this.pending = null;
      this.timer = null;
      if (!a || !this.client || !this.ready) return;
      try {
        Promise.resolve(this.client.user?.setActivity(a)).catch(() => {});
      } catch (e) { console.error('[rpc]', e.message); }
      if (this.pending) { this.timer = setTimeout(send, 4000); }
    };
    if (this.ready) { send(); this.timer = setTimeout(() => {
      this.timer = null;
      if (this.pending) this._push(this.pending);
    }, 4000); }
  }
}

module.exports = { Presence, findCoverUrl };
