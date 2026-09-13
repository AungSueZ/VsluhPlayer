// Хождение по чужим ссылкам.
//
// Ссылку вставляет человек, но вставить он может и чужую, подсунутую ему. Без
// этой проверки плеер сходил бы по ней внутрь домашней сети - на роутер, на
// соседнюю машину - и вернул бы ответ. Поэтому ходим только на внешние адреса и
// проверяем каждый переход по редиректу отдельно: внешний адрес может увести на
// внутренний одним прыжком, а fetch прошёл бы его молча.
const dns = require('dns').promises;
const net = require('net');

function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 169 && p[1] === 254) return true;   // link-local, там же метаданные облаков
    if (p[0] >= 224) return true;                    // multicast и выше
    return false;
  }
  const s = String(ip).toLowerCase();
  if (s === '::' || s === '::1') return true;
  if (s.startsWith('::ffff:')) return isPrivate(s.slice(7));
  if (/^fe[89ab]/.test(s)) return true;              // fe80::/10
  if (/^f[cd]/.test(s)) return true;                 // fc00::/7
  return false;
}

async function assertPublic(host) {
  const bare = String(host || '').replace(/^\[|\]$/g, '');
  if (!bare) throw new Error('адреса нет');
  if (net.isIP(bare)) {
    if (isPrivate(bare)) throw new Error('локальный адрес');
    return;
  }
  const addrs = await dns.lookup(bare, { all: true });
  if (!addrs.length) throw new Error('адрес не нашёлся');
  for (const a of addrs) if (isPrivate(a.address)) throw new Error('локальный адрес');
}

/* Как fetch, только с проверкой на каждом переходе.
   У ответа .url - адрес последнего перехода, то есть настоящий.

   Про срок ожидания: он считается до заголовков и там же снимается. Повесить
   его на весь запрос нельзя - под ним идёт музыка, и часовая запись оборвалась
   бы на середине. Молчащий сервер при этом всё равно не подвесит плеер. */
async function guardedFetch(url, opts = {}, hops = 4, wait = 20000) {
  let u = String(url || '');
  for (let i = 0; i < hops; i++) {
    let parsed;
    try { parsed = new URL(u); } catch { throw new Error('это не ссылка'); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('нужен http или https');
    await assertPublic(parsed.hostname);

    const ctrl = opts.signal ? null : new AbortController();
    const timer = ctrl ? setTimeout(() => ctrl.abort(), wait) : null;
    let r;
    try {
      r = await fetch(u, Object.assign({}, opts, {
        redirect: 'manual',
        signal: ctrl ? ctrl.signal : opts.signal
      }));
    } finally {
      if (timer) clearTimeout(timer);
    }

    const to = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
    if (!to) return r;
    try { await r.body?.cancel(); } catch {}
    u = new URL(to, u).toString();
  }
  throw new Error('слишком много переходов');
}

// быстрая проверка без похода в dns: голый локальный адрес или localhost.
// нужна там, где не хочется ни ждать, ни ходить в сеть - например, чтобы не
// показывать карточку трека, который всё равно не проиграется
function looksLocal(host) {
  const bare = String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (bare === 'localhost' || bare.endsWith('.localhost')) return true;
  return net.isIP(bare) ? isPrivate(bare) : false;
}

module.exports = { isPrivate, looksLocal, assertPublic, guardedFetch };
