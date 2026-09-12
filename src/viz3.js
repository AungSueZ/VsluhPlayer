/* Ещё шесть визуализаций. Тот же уговор, что и в viz2.js: всё нужное приходит
   одним объектом V, поэтому каждую можно нарисовать вне плеера, на выдуманном
   спектре - иначе их никак не проверишь, на слух тут ничего не видно.

   Общее правило, выученное на прошлом заходе: фигура должна быть видна и в
   тишине. Звук её раздувает, а не зажигает с нуля - иначе на тихом месте
   экран пустеет и это выглядит поломкой.

   V = { x, w, h, geo{cx,cy,r}, freq, time, live, beat, hit, t, dt, p, ac } */
(function () {
  'use strict';

  function band(V, k, n, curve, top) {
    const f = V.freq;
    if (!f || !V.live) return 0;
    const c = curve || 1.5, hi = (top || 0.7) * f.length;
    const a = Math.floor(Math.pow(k / n, c) * hi);
    const b = Math.floor(Math.pow((k + 1) / n, c) * hi);
    let sum = 0, cnt = 0;
    for (let i = a; i <= b && i < f.length; i++) { sum += f[i]; cnt++; }
    return cnt ? sum / cnt / 255 : 0;
  }

  function loud(V) {
    const f = V.freq;
    if (!f || !V.live) return 0;
    let s = 0;
    const n = Math.max(1, Math.floor(f.length * 0.35));
    for (let i = 0; i < n; i++) s += f[i];
    return s / n / 255;
  }

  function ease(arr, i, raw, up, down) {
    arr[i] += (raw - arr[i]) * (raw > arr[i] ? (up || 0.45) : (down || 0.1));
    return arr[i];
  }

  function arr(store, key, n) {
    if (!store[key] || store[key].length !== n) store[key] = new Float32Array(n);
    return store[key];
  }

  /* ---------- гребни ----------
     спектр откладывается кривой, и каждый кадр она сдвигается вверх, оставляя
     позади прошлые. получается рельеф из горных гряд, уходящий вдаль.
     дальние ряды светлее не делаем: глубину держит толщина линии и заливка,
     иначе верх экрана превращается в кашу */
  const RID = { rows: null, at: 0, last: 0 };
  const RID_N = 26;          // сколько гряд помещается
  const RID_W = 48;          // точек в одной гряде

  function ridge(V) {
    const { x, w, h, p, ac } = V;

    if (!RID.rows) {
      RID.rows = [];
      for (let i = 0; i < RID_N; i++) RID.rows.push(new Float32Array(RID_W));
    }

    // новая гряда рождается не каждый кадр, иначе рельеф летит слишком быстро
    if (V.t - RID.last > 55) {
      RID.last = V.t;
      RID.at = (RID.at + 1) % RID_N;
      const row = RID.rows[RID.at];
      for (let k = 0; k < RID_W; k++) {
        // края придавливаем, чтобы гряда не упиралась в стенки экрана
        const edge = Math.sin((k / (RID_W - 1)) * Math.PI);
        // в тишине гряда всё равно живая - её качает собственной синусоидой
        const idle = 0.09 + Math.sin(k * 0.7 + V.t * 0.0016) * 0.045;
        row[k] = (idle + band(V, k, RID_W, 1.5, 0.62) * 1.25) * edge;
      }
    }

    const stepY = h * 0.055;
    const baseY = h * 0.82;
    const amp = h * 0.3 * p;

    x.save();
    x.lineJoin = 'round';

    for (let i = 1; i <= RID_N; i++) {
      const row = RID.rows[(RID.at - RID_N + i + RID_N * 2) % RID_N];
      const age = i / RID_N;                  // 0 - самая дальняя, 1 - свежая
      const y0 = baseY - (RID_N - i) * stepY;
      const sq = 0.45 + age * 0.55;           // дальние гряды ниже ростом

      x.beginPath();
      x.moveTo(-10, y0 + 4);
      for (let k = 0; k < RID_W; k++) {
        const px = (k / (RID_W - 1)) * w;
        const py = y0 - row[k] * amp * sq;
        if (k === 0) x.lineTo(px, py);
        else {
          // через середину между точками - кривая выходит гладкой без сплайнов
          const pxPrev = ((k - 1) / (RID_W - 1)) * w;
          const pyPrev = y0 - row[k - 1] * amp * sq;
          x.quadraticCurveTo(pxPrev, pyPrev, (pxPrev + px) / 2, (pyPrev + py) / 2);
        }
      }
      x.lineTo(w + 10, y0 + 4);

      // заливка прячет то, что за грядой - без неё все ряды просвечивают насквозь
      x.save();
      x.fillStyle = `rgba(8,7,11,${(0.55 + age * 0.4).toFixed(3)})`;
      x.fill();
      x.restore();

      x.strokeStyle = `rgba(${ac},${(0.18 + age * 0.55).toFixed(3)})`;
      x.lineWidth = 1 + age * 1.2;
      x.stroke();
    }
    x.restore();
  }

  /* ---------- вектор ----------
     осциллограф рисует волну слева направо; здесь она откладывается сама
     против себя же, со сдвигом. для чистого тона выходит эллипс, для музыки -
     живая петля, которая всё время перекраивается. стерео для этого не нужно:
     сдвиг по времени даёт ту же фигуру, что и второй канал */
  const VEC = { trail: [] };

  function vector(V) {
    const { x, geo, p, ac } = V;
    const cx = geo.cx, cy = geo.cy;
    const R = geo.r * 1.55;
    const td = V.time;
    const lag = 24;                       // сдвиг в отсчётах: он и разворачивает петлю

    const n = td && V.live ? Math.min(td.length - lag, 420) : 0;

    // насколько велика волна. если она почти никакая, петля схлопнулась бы в
    // точку - поэтому подмешиваем холостой круг тем сильнее, чем тише звук
    let big = 0;
    for (let i = 0; i < n; i++) big = Math.max(big, Math.abs((td[i] - 128) / 128));
    const idle = n ? Math.max(0, Math.min(1, 1 - big / 0.14)) : 1;
    const k = 0.5 + Math.sin(V.t * 0.0013) * 0.06;

    const pts = [];
    const N = n || 96;
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * 6.283;
      const ca = Math.cos(ang) * k, cb = Math.sin(ang) * k;
      const a = n ? (td[i] - 128) / 128 : ca;
      const b = n ? (td[i + lag] - 128) / 128 : cb;
      // тишина - чистый круг, громко - чистая петля, между ними плавный переход
      const ax = a + (ca - a) * idle;
      const by = b + (cb - b) * idle;
      pts.push([cx + ax * R * p, cy + by * R * p]);
    }

    // послесвечение: несколько прошлых кадров, гаснущих по очереди
    VEC.trail.push(pts);
    if (VEC.trail.length > 7) VEC.trail.shift();

    x.save();
    x.globalCompositeOperation = 'lighter';
    x.lineJoin = 'round';
    x.lineCap = 'round';

    for (let k = 0; k < VEC.trail.length; k++) {
      const set = VEC.trail[k];
      const age = (k + 1) / VEC.trail.length;
      x.beginPath();
      for (let i = 0; i < set.length; i++) {
        if (i === 0) x.moveTo(set[i][0], set[i][1]);
        else x.lineTo(set[i][0], set[i][1]);
      }
      x.strokeStyle = `rgba(${ac},${(0.04 + age * age * 0.4).toFixed(3)})`;
      x.lineWidth = 0.7 + age * 1.9;
      x.stroke();
    }
    x.restore();
  }

  /* ---------- струны ----------
     поперёк экрана натянуты струны, у каждой своя полоса спектра. струна
     гудит стоячей волной, а на долю её дёргают - амплитуда резко подскакивает
     и потом спадает. так слышно ритм, а не только громкость */
  const STR = { amp: null, ph: null };
  const STR_N = 9;

  function strings(V) {
    const { x, w, h, p, ac } = V;
    const amp = arr(STR, 'amp', STR_N);
    if (!STR.ph) {
      STR.ph = new Float32Array(STR_N);
      for (let i = 0; i < STR_N; i++) STR.ph[i] = i * 1.7;
    }

    x.save();
    x.lineCap = 'round';

    for (let i = 0; i < STR_N; i++) {
      const lv = band(V, i, STR_N, 1.6, 0.6);
      // дёрнули - подбросили амплитуду; иначе она просто следует за громкостью
      if (V.hit && lv > 0.08) amp[i] = Math.max(amp[i], 0.55 + lv * 0.8);
      amp[i] += (lv * 0.5 - amp[i]) * (lv * 0.5 > amp[i] ? 0.25 : 0.055);

      const y = h * (0.16 + i * (0.68 / (STR_N - 1)));
      const mode = 1 + (i % 3);                 // номер гармоники - у струн разный узор
      // в тишине струна всё равно чуть гудит, иначе экран пустеет
      const a = (0.05 + amp[i]) * h * 0.13 * p;
      const sp = 0.004 + i * 0.0006;

      x.beginPath();
      const N = 64;
      for (let k = 0; k <= N; k++) {
        const u = k / N;
        const env = Math.sin(u * Math.PI);      // узлы на концах - струна закреплена
        const yy = y + Math.sin(u * Math.PI * mode * 2) * env
                     * Math.sin(V.t * sp + STR.ph[i]) * a;
        if (k === 0) x.moveTo(u * w, yy); else x.lineTo(u * w, yy);
      }
      x.strokeStyle = `rgba(${ac},${(0.1 + Math.min(0.55, amp[i] * 0.6)).toFixed(3)})`;
      x.lineWidth = 1 + Math.min(2.6, amp[i] * 2.4);
      x.stroke();

      // колки по краям - без них струны висят в воздухе
      x.fillStyle = `rgba(${ac},.22)`;
      x.beginPath(); x.arc(0, y, 2.4, 0, 6.283); x.fill();
      x.beginPath(); x.arc(w, y, 2.4, 0, 6.283); x.fill();
    }
    x.restore();
  }

  /* ---------- рябь ----------
     на каждую долю в случайном месте падает капля, круги расходятся и
     накладываются друг на друга. интерференция и есть весь смысл: одиночное
     кольцо уже есть в "туннеле", а тут их много и они спорят между собой */
  const RIP = { drops: [], last: 0 };

  function ripple(V) {
    const { x, w, h, p, ac } = V;
    const lv = loud(V);

    // капля от доли, и на всякий случай самотёком - чтобы в тишине не было пусто
    if ((V.hit && lv > 0.06) || V.t - RIP.last > 1400) {
      RIP.last = V.t;
      RIP.drops.push({
        x: w * (0.12 + Math.random() * 0.76),
        y: h * (0.14 + Math.random() * 0.72),
        born: V.t,
        pw: 0.45 + lv * 1.5
      });
      if (RIP.drops.length > 14) RIP.drops.shift();
    }

    const LIFE = 2600;
    x.save();
    x.globalCompositeOperation = 'lighter';

    for (let i = RIP.drops.length - 1; i >= 0; i--) {
      const d = RIP.drops[i];
      const age = (V.t - d.born) / LIFE;
      if (age > 1) { RIP.drops.splice(i, 1); continue; }

      const maxR = Math.min(w, h) * 0.62 * p;
      // три кольца в одной капле, идущие следом друг за другом
      for (let k = 0; k < 3; k++) {
        const a2 = age - k * 0.09;
        if (a2 <= 0) continue;
        const r = a2 * maxR;
        const fade = (1 - a2) * (1 - a2) * d.pw * (1 - k * 0.26);
        if (fade <= 0.004) continue;
        x.beginPath();
        x.arc(d.x, d.y, r, 0, 6.283);
        x.strokeStyle = `rgba(${ac},${fade.toFixed(3)})`;
        x.lineWidth = (2.6 - k * 0.6) * (1 - a2 * 0.6);
        x.stroke();
      }
    }
    x.restore();
  }

  /* ---------- радар ----------
     луч обходит обложку по кругу, и там, где он проходит, вспыхивают отметки
     по громкости полос. отметка гаснет не сразу, поэтому позади луча остаётся
     след - видно, что было секунду назад */
  const RAD = { blips: null, ang: 0 };
  const RAD_N = 72;

  function radar(V) {
    const { x, geo, p, ac } = V;
    const cx = geo.cx, cy = geo.cy;
    const R = geo.r * 1.9;
    const blips = arr(RAD, 'blips', RAD_N);

    // луч идёт ровно, скорость от громкости чуть подрастает
    RAD.ang += (0.00085 + loud(V) * 0.0009) * V.dt;
    const a0 = RAD.ang % 6.283;

    // всё тихо тускнеет, а под лучом обновляется
    for (let i = 0; i < RAD_N; i++) blips[i] *= 0.991;
    const at = Math.floor((a0 / 6.283) * RAD_N) % RAD_N;
    for (let k = -1; k <= 1; k++) {
      const i = (at + k + RAD_N) % RAD_N;
      const lv = band(V, (i * 7) % RAD_N, RAD_N, 1.4, 0.68);
      blips[i] = Math.max(blips[i], 0.1 + lv * 1.1);
    }

    x.save();

    // круги-засечки: по ним видно, что это шкала, а не просто точки
    x.strokeStyle = `rgba(${ac},.07)`;
    x.lineWidth = 1;
    for (let k = 1; k <= 3; k++) {
      x.beginPath();
      x.arc(cx, cy, R * (k / 3), 0, 6.283);
      x.stroke();
    }

    x.globalCompositeOperation = 'lighter';

    // сам луч - узкий сектор с растушёвкой по углу
    const g = x.createLinearGradient(cx, cy, cx + Math.cos(a0) * R, cy + Math.sin(a0) * R);
    g.addColorStop(0, `rgba(${ac},0)`);
    g.addColorStop(1, `rgba(${ac},${(0.42 * p).toFixed(3)})`);
    x.beginPath();
    x.moveTo(cx, cy);
    x.arc(cx, cy, R, a0 - 0.34, a0 + 0.03);
    x.closePath();
    x.fillStyle = g;
    x.fill();

    // отметки
    for (let i = 0; i < RAD_N; i++) {
      const v = blips[i];
      if (v < 0.02) continue;
      const a = (i / RAD_N) * 6.283;
      const rr = R * (0.28 + v * 0.66) * p;
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      // от центра к отметке - короткий луч: так видно, на каком она радиусе
      x.beginPath();
      x.moveTo(cx + Math.cos(a) * R * 0.26, cy + Math.sin(a) * R * 0.26);
      x.lineTo(px, py);
      x.strokeStyle = `rgba(${ac},${Math.min(0.3, v * 0.28).toFixed(3)})`;
      x.lineWidth = 1;
      x.stroke();

      x.beginPath();
      x.arc(px, py, 1.6 + v * 3.4, 0, 6.283);
      x.fillStyle = `rgba(${ac},${Math.min(0.88, 0.16 + v * 0.85).toFixed(3)})`;
      x.fill();
    }
    x.restore();
  }

  /* ---------- маятник ----------
     ряд маятников с чуть разными периодами. сами по себе они расходятся и
     сходятся длинной волной - это известный фокус с маятниковой волной;
     звук добавляет к размаху, но узор держится и в тишине */
  const PEN = { sw: null };
  const PEN_N = 22;

  function pendulum(V) {
    const { x, w, h, p, ac } = V;
    const sw = arr(PEN, 'sw', PEN_N);
    const topY = h * 0.1;
    const maxL = h * 0.66;

    x.save();
    x.lineCap = 'round';

    // перекладина
    x.strokeStyle = `rgba(${ac},.12)`;
    x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(w * 0.06, topY); x.lineTo(w * 0.94, topY); x.stroke();

    for (let i = 0; i < PEN_N; i++) {
      const u = i / (PEN_N - 1);
      const px = w * (0.06 + u * 0.88);
      // длина падает по порядку - отсюда и расхождение периодов
      const L = maxL * (0.42 + 0.58 * (1 - i / PEN_N));
      const lv = ease(sw, i, band(V, i, PEN_N, 1.5, 0.65), 0.3, 0.05);

      // период маятника: чем короче, тем быстрее
      const om = 0.0021 * Math.sqrt(maxL / L);
      const sway = (0.16 + lv * 0.5) * p;          // размах есть всегда
      const a = Math.sin(V.t * om + i * 0.0) * sway;

      const bx = px + Math.sin(a) * L;
      const by = topY + Math.cos(a) * L;

      x.beginPath();
      x.moveTo(px, topY);
      x.lineTo(bx, by);
      x.strokeStyle = `rgba(${ac},${(0.08 + lv * 0.22).toFixed(3)})`;
      x.lineWidth = 1;
      x.stroke();

      x.beginPath();
      x.arc(bx, by, 3 + lv * 7 * p, 0, 6.283);
      x.fillStyle = `rgba(${ac},${(0.28 + lv * 0.5).toFixed(3)})`;
      x.fill();

      if (lv > 0.28) {
        x.beginPath();
        x.arc(bx, by, (3 + lv * 7) * 2.1 * p, 0, 6.283);
        x.fillStyle = `rgba(${ac},${(lv * 0.09).toFixed(3)})`;
        x.fill();
      }
    }
    x.restore();
  }

  const VIZ3 = { ridge, vector, strings, ripple, radar, pendulum };

  // ручка для стенда: на глаз тут ничего не проверишь, а так видно,
  // что у фигуры внутри - заполнились ли ряды, живут ли капли
  VIZ3._state = { RID, VEC, STR, RIP, RAD, PEN };

  if (typeof module !== 'undefined' && module.exports) module.exports = VIZ3;
  else window.VIZ3 = VIZ3;
})();
