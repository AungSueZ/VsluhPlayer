/* Крупные визуализации.
   Каждая получает всё нужное одним объектом V, а не лезет в глобальные
   переменные - так их можно нарисовать и вне плеера, на выдуманном спектре.
   Этим я их и проверял, потому что на слух тут ничего не проверишь.

   V = {
     x        контекст рисования
     w, h     размеры области
     geo      {cx, cy, r} - где сейчас центр обложки и её радиус
     freq     спектр, Uint8Array, или null если тишина
     time     осциллограмма, Uint8Array, или null
     live     играет ли прямо сейчас
     beat     сглаженный бас, 0..1
     hit      случилась ли доля в этом кадре
     t        часы анимации в мс (уже с поправкой на скорость)
     dt       сколько прошло с прошлого кадра, тоже с поправкой
     p        сила, 0.3..1.7
     ac       цвет как "r,g,b"
   }
*/
(function () {
  'use strict';

  /* ---------- общее ---------- */

  // громкость k-й полосы из n. усредняем окно, иначе одиночный бин дёргается
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

  // общая громкость - по ней решаем, насколько бурно себя вести.
  // считаем по низу спектра: верхние полосы почти всегда пустые и занижали бы её
  function loud(V) {
    const f = V.freq;
    if (!f || !V.live) return 0;
    let s = 0;
    const n = Math.max(1, Math.floor(f.length * 0.35));
    for (let i = 0; i < n; i++) s += f[i];
    return s / n / 255;
  }

  // сглаживатель: вверх быстро, вниз лениво - так столбики не дрожат
  function ease(arr, i, raw, up, down) {
    arr[i] += (raw - arr[i]) * (raw > arr[i] ? (up || 0.45) : (down || 0.1));
    return arr[i];
  }

  function arr(store, key, n) {
    if (!store[key] || store[key].length !== n) store[key] = new Float32Array(n);
    return store[key];
  }

  /* ---------- аврора ---------- */
  // занавесы северного сияния: волнистый верхний край, свет стекает вниз полосами

  const AUR = { layers: null, sm: null };

  function aurora(V) {
    const { x, w, h, p, ac } = V;
    const N = 4;

    if (!AUR.layers) {
      AUR.layers = [];
      for (let i = 0; i < N; i++) {
        AUR.layers.push({
          k1: 1.05 + i * 0.55,          // сколько волн укладывается по ширине
          k2: 2.6 + i * 1.1,
          sp: 0.000052 + i * 0.000019,  // своя скорость, иначе слои едут слипшись
          ph: i * 2.1,
          base: 0.30 + i * 0.085,       // где висит край занавеса
          amp: 0.085 + i * 0.03
        });
      }
    }
    const sm = arr(AUR, 'sm', N);

    x.save();
    x.globalCompositeOperation = 'lighter';

    for (let i = 0; i < N; i++) {
      const L = AUR.layers[i];
      const lv = ease(sm, i, band(V, i, N, 1.7, 0.55), 0.3, 0.045);
      const amp = h * L.amp * (0.55 + lv * 1.5) * p;
      const len = h * 0.46;

      // край занавеса: две синусоиды с разным периодом дают живую, непериодичную кромку
      const top = u => h * L.base
        + Math.sin(u * L.k1 * 6.283 + V.t * L.sp + L.ph) * amp
        + Math.sin(u * L.k2 * 6.283 - V.t * L.sp * 1.7) * amp * 0.45;

      // тело занавеса одной заливкой - это дешёвый мягкий свет
      const yTop = h * L.base - amp * 1.5;
      const g = x.createLinearGradient(0, yTop, 0, yTop + len);
      // занавес светится и в тишине: звук его разжигает, а не зажигает с нуля
      const a = (0.075 + lv * 0.17) * p;
      g.addColorStop(0, `rgba(${ac},0)`);
      g.addColorStop(0.22, `rgba(${ac},${a.toFixed(3)})`);
      g.addColorStop(0.5, `rgba(255,255,255,${(a * 0.22).toFixed(3)})`);
      g.addColorStop(1, `rgba(${ac},0)`);

      x.beginPath();
      x.moveTo(0, top(0));
      for (let s = 1; s <= 64; s++) x.lineTo(s / 64 * w, top(s / 64));
      x.lineTo(w, yTop + len);
      x.lineTo(0, yTop + len);
      x.closePath();
      x.fillStyle = g;
      x.fill();

      // вертикальные прожилки - без них занавес выглядит размазанным пятном
      x.lineWidth = 1.6;
      const step = 7;
      for (let px = 0; px < w; px += step) {
        const u = px / w;
        const y = top(u);
        // прожилки то ярче, то бледнее, и рисунок медленно ползёт вдоль занавеса
        const flick = 0.5 + 0.5 * Math.sin(u * 47 + V.t * 0.0004 + i * 3);
        const aa = (0.05 + lv * 0.2) * flick * p;
        if (aa < 0.008) continue;
        x.strokeStyle = `rgba(${ac},${aa.toFixed(3)})`;
        x.beginPath();
        x.moveTo(px, y);
        x.lineTo(px, y + len * (0.45 + flick * 0.5));
        x.stroke();
      }
    }
    x.restore();

    // концы прожилок обрывались ровной линейкой - растворяем низ картинки
    x.save();
    x.globalCompositeOperation = 'destination-out';
    const fade = x.createLinearGradient(0, h * 0.62, 0, h);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    x.fillStyle = fade;
    x.fillRect(0, h * 0.62, w, h * 0.38);
    x.restore();
  }

  /* ---------- сфера ---------- */
  // точки, разложенные по шару, шар крутится, каждая точка дышит своей полосой

  const SPH = { pts: null, sm: null };
  const SPH_N = 440, SPH_B = 22;

  function sphere(V) {
    const { x, geo, p, ac, t, beat } = V;

    if (!SPH.pts) {
      SPH.pts = [];
      // спираль Фибоначчи - точки ложатся по шару равномерно, без сгущения у полюсов
      const off = 2 / SPH_N, inc = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < SPH_N; i++) {
        const y = i * off - 1 + off / 2;
        const rr = Math.sqrt(Math.max(0, 1 - y * y));
        const ph = i * inc;
        SPH.pts.push({
          x: Math.cos(ph) * rr, y: y, z: Math.sin(ph) * rr,
          // полосы раскидываем по всему шару, а не кольцами по широте:
          // иначе громкий бас зажигает один экватор и шар читается как бублик
          b: i % SPH_B
        });
      }
    }
    const sm = arr(SPH, 'sm', SPH_B);
    for (let i = 0; i < SPH_B; i++) ease(sm, i, band(V, i, SPH_B, 1.6, 0.6), 0.4, 0.08);

    const R = (geo.r * 1.52 + 24) * (1 + beat * 0.09);
    const ry = t * 0.00023, rx = Math.sin(t * 0.000085) * 0.5;
    const cosY = Math.cos(ry), sinY = Math.sin(ry);
    const cosX = Math.cos(rx), sinX = Math.sin(rx);
    const f = R * 1.9;                       // камера поближе - у шара появляется объём

    for (const pt of SPH.pts) {
      // поворот вокруг вертикали, затем небольшой наклон к зрителю
      const x1 = pt.x * cosY + pt.z * sinY;
      const z1 = pt.z * cosY - pt.x * sinY;
      const y2 = pt.y * cosX - z1 * sinX;
      const z2 = z1 * cosX + pt.y * sinX;

      const k = f / (f + z2 * R);            // перспектива: дальние точки мельче
      const sx = geo.cx + x1 * R * k;
      const sy = geo.cy + y2 * R * k;

      const lv = sm[pt.b];
      const depth = 0.5 + z2 * 0.5;          // 0 сзади, 1 спереди
      const rad = (1 + lv * 3.4 * p) * (0.5 + depth * 0.85);
      // шар виден всегда, даже в тишине - звук только добавляет ему жара
      const a = (0.13 + lv * 0.55) * (0.3 + depth * 0.8);

      x.fillStyle = `rgba(${ac},${a.toFixed(3)})`;
      x.beginPath();
      x.arc(sx, sy, rad, 0, 6.283);
      x.fill();
    }
  }

  /* ---------- калейдоскоп ---------- */
  // один сектор со спектром, отражённый и размноженный по кругу

  const KAL = { sm: null };
  const KAL_SEC = 8, KAL_B = 15;

  function kaleid(V) {
    const { x, geo, w, h, p, ac, t } = V;
    const sm = arr(KAL, 'sm', KAL_B);

    const r0 = geo.r * 0.55 + 12;
    const R = Math.min(w, h) * 0.47;
    const span = Math.PI / KAL_SEC;          // половина сектора: вторую даст отражение

    x.save();
    x.translate(geo.cx, geo.cy);
    x.rotate(t * 0.00007);
    x.globalCompositeOperation = 'lighter';
    x.lineCap = 'round';

    // рисуем один сектор, а потом просто поворачиваем холст - отсюда и симметрия
    const wedge = () => {
      for (let j = 0; j < KAL_B; j++) {
        const lv = sm[j];
        // узор виден и в тишине - тогда это тонкий скелет, который звук раздувает
        const rr = r0 + (j + 0.5) / KAL_B * (R - r0)
          + Math.sin(V.t * 0.0006 + j * 0.9) * 4;   // лёгкое дыхание колец

        // дуга: чем громче полоса, тем толще и длиннее осколок
        x.strokeStyle = `rgba(${ac},${(0.05 + lv * 0.4).toFixed(3)})`;
        x.lineWidth = 0.8 + lv * 10 * p;
        x.beginPath();
        x.arc(0, 0, rr, span * 0.08, span * (0.18 + lv * 0.76));
        x.stroke();

        // точка на конце - она собирает взгляд и делает узор колючим
        const a2 = span * (0.18 + lv * 0.76);
        x.fillStyle = `rgba(255,255,255,${(lv * 0.3).toFixed(3)})`;
        x.beginPath();
        x.arc(Math.cos(a2) * rr, Math.sin(a2) * rr, 0.7 + lv * 2.4 * p, 0, 6.283);
        x.fill();
      }

      // спица вдоль сектора: длина по общей громкости, держит фигуру собранной
      const big = sm[1] * 0.5 + sm[2] * 0.3 + sm[0] * 0.2;
      x.strokeStyle = `rgba(${ac},${(0.05 + big * 0.3).toFixed(3)})`;
      x.lineWidth = 1 + big * 3;
      x.beginPath();
      x.moveTo(Math.cos(span * 0.06) * r0, Math.sin(span * 0.06) * r0);
      x.lineTo(Math.cos(span * 0.06) * (r0 + big * (R - r0) * 1.2 * p),
               Math.sin(span * 0.06) * (r0 + big * (R - r0) * 1.2 * p));
      x.stroke();
    };

    for (let j = 0; j < KAL_B; j++) ease(sm, j, band(V, j, KAL_B, 1.55, 0.62), 0.45, 0.075);

    for (let s = 0; s < KAL_SEC; s++) {
      x.save();
      x.rotate(s * span * 2);
      wedge();
      x.scale(1, -1);                        // зеркало относительно оси сектора
      wedge();
      x.restore();
    }
    x.restore();
  }

  /* ---------- ливень ---------- */
  // капли падают чаще там, где громче полоса; внизу мокрый пол с отражением

  const RAIN = { drops: [], rings: [], acc: 0, sm: null };
  const RAIN_B = 28;

  function rain(V) {
    const { x, w, h, p, ac, dt, live } = V;
    const sm = arr(RAIN, 'sm', RAIN_B);
    for (let i = 0; i < RAIN_B; i++) ease(sm, i, band(V, i, RAIN_B, 1.5, 0.7), 0.5, 0.09);

    const floor = h * 0.84;
    const lv = loud(V);

    // сколько капель родить в этом кадре - дробный остаток копим, иначе на
    // слабом звуке не родится ни одной и дождя просто не будет
    RAIN.acc += (live ? 0.7 + lv * 9 * p : 0.12) * (dt / 16.7);
    while (RAIN.acc >= 1 && RAIN.drops.length < 260) {
      RAIN.acc--;
      // полосу выбираем не поровну: где громче, оттуда чаще и капает
      let k = (Math.random() * RAIN_B) | 0;
      if (Math.random() > sm[k] * 1.4 + 0.08) k = (Math.random() * RAIN_B) | 0;
      const jitter = (Math.random() - 0.5) * (w / RAIN_B);
      RAIN.drops.push({
        x: (k + 0.5) / RAIN_B * w + jitter,
        y: -20 - Math.random() * h * 0.3,
        v: 5 + Math.random() * 6 + sm[k] * 9,
        len: 22 + Math.random() * 34 + sm[k] * 55,
        a: 0.3 + sm[k] * 0.6
      });
    }

    const step = dt / 16.7;
    x.lineCap = 'round';

    for (let i = RAIN.drops.length - 1; i >= 0; i--) {
      const d = RAIN.drops[i];
      d.y += d.v * step * p;

      if (d.y >= floor) {
        RAIN.drops.splice(i, 1);
        if (RAIN.rings.length < 40) RAIN.rings.push({ x: d.x, r: 1, a: d.a * 0.8 });
        continue;
      }

      const y1 = d.y, y0 = Math.max(-30, d.y - d.len);
      x.strokeStyle = `rgba(${ac},${d.a.toFixed(3)})`;
      x.lineWidth = 1.1 + d.a * 1.6;
      x.beginPath();
      x.moveTo(d.x, y0);
      x.lineTo(d.x, y1);
      x.stroke();

      // светлая головка: без неё капля читается штрихом, а не каплей
      x.fillStyle = `rgba(255,255,255,${(d.a * 0.5).toFixed(3)})`;
      x.beginPath();
      x.arc(d.x, y1, 0.7 + d.a * 1.5, 0, 6.283);
      x.fill();

      // отражение в полу: то же самое, вверх ногами и почти прозрачное
      if (y1 > floor - h * 0.3) {
        x.strokeStyle = `rgba(${ac},${(d.a * 0.16).toFixed(3)})`;
        x.beginPath();
        x.moveTo(d.x, floor + (floor - y1));
        x.lineTo(d.x, floor + (floor - y0));
        x.stroke();
      }
    }

    // круги по воде
    for (let i = RAIN.rings.length - 1; i >= 0; i--) {
      const g = RAIN.rings[i];
      g.r += 1.6 * step;
      g.a *= Math.pow(0.93, step);
      if (g.a < 0.01 || g.r > 70) { RAIN.rings.splice(i, 1); continue; }
      x.strokeStyle = `rgba(${ac},${g.a.toFixed(3)})`;
      x.lineWidth = 1;
      x.beginPath();
      x.ellipse(g.x, floor, g.r, g.r * 0.22, 0, 0, 6.283);
      x.stroke();
    }

    // сама линия пола, ярче к середине
    const fg = x.createLinearGradient(0, 0, w, 0);
    fg.addColorStop(0, `rgba(${ac},0)`);
    fg.addColorStop(0.5, `rgba(${ac},${(0.14 + lv * 0.3).toFixed(3)})`);
    fg.addColorStop(1, `rgba(${ac},0)`);
    x.strokeStyle = fg;
    x.lineWidth = 1.2;
    x.beginPath();
    x.moveTo(0, floor);
    x.lineTo(w, floor);
    x.stroke();
  }

  /* ---------- пульсар ---------- */
  // длинные лучи из-под обложки, на долю - вспышка и быстрая ударная волна

  const PUL = { sm: null, waves: [] };
  const PUL_N = 56;

  function pulsar(V) {
    const { x, geo, w, h, p, ac, t, beat, hit, dt } = V;
    const sm = arr(PUL, 'sm', PUL_N);

    const reach = Math.max(w, h) * 0.6;
    const r0 = geo.r + 6;
    const rot = t * 0.00005;

    x.save();
    x.globalCompositeOperation = 'lighter';

    // ядро: мягкое свечение под обложкой, разгорается на басу
    const core = x.createRadialGradient(geo.cx, geo.cy, r0 * 0.2, geo.cx, geo.cy, r0 * 2.1);
    core.addColorStop(0, `rgba(${ac},${(0.1 + beat * 0.3).toFixed(3)})`);
    core.addColorStop(0.5, `rgba(${ac},${(0.04 + beat * 0.12).toFixed(3)})`);
    core.addColorStop(1, `rgba(${ac},0)`);
    x.fillStyle = core;
    x.beginPath();
    x.arc(geo.cx, geo.cy, r0 * 2.1, 0, 6.283);
    x.fill();

    x.lineCap = 'round';
    for (let i = 0; i < PUL_N; i++) {
      // спектр зеркалим: одинаковые полосы напротив друг друга, фигура симметрична
      const half = PUL_N / 2;
      const k = i < half ? i : PUL_N - 1 - i;
      const lv = ease(sm, i, band(V, k, half, 1.45, 0.65), 0.5, 0.07);
      // короткий луч есть всегда - звезда не должна исчезать между долями
      const len = (0.1 + lv * 1.0) * reach * p;
      const a = rot + (i / PUL_N) * 6.283;
      const cos = Math.cos(a), sin = Math.sin(a);
      const x0 = geo.cx + cos * r0, y0 = geo.cy + sin * r0;
      const x1 = geo.cx + cos * (r0 + len), y1 = geo.cy + sin * (r0 + len);

      const g = x.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, `rgba(255,255,255,${(0.03 + lv * 0.2).toFixed(3)})`);
      g.addColorStop(0.12, `rgba(${ac},${(0.12 + lv * 0.48).toFixed(3)})`);
      g.addColorStop(1, `rgba(${ac},0)`);
      x.strokeStyle = g;
      x.lineWidth = 1 + lv * 4.5 * p;
      x.beginPath();
      x.moveTo(x0, y0);
      x.lineTo(x1, y1);
      x.stroke();
    }

    // ударная волна: одна быстрая и тонкая, не поезд колец как в туннеле
    if (hit && PUL.waves.length < 6) PUL.waves.push({ r: r0, a: 0.5 });
    const step = dt / 16.7;
    for (let i = PUL.waves.length - 1; i >= 0; i--) {
      const wv = PUL.waves[i];
      wv.r += (14 + wv.r * 0.08) * step * p;
      wv.a *= Math.pow(0.9, step);
      if (wv.a < 0.012 || wv.r > reach * 1.4) { PUL.waves.splice(i, 1); continue; }
      x.strokeStyle = `rgba(255,255,255,${wv.a.toFixed(3)})`;
      x.lineWidth = 1.4;
      x.beginPath();
      x.arc(geo.cx, geo.cy, wv.r, 0, 6.283);
      x.stroke();
    }
    x.restore();
  }

  /* ---------- лента ---------- */
  // полоса вьётся через экран и перекручивается; ширина берётся с осциллограммы

  const RIB = { amp: 0 };

  function ribbon(V) {
    const { x, w, h, time, p, ac, t, live, beat } = V;
    const N = 120;
    const y0 = h * 0.66;
    const maxW = Math.min(h * 0.17, 120) * p;

    // ширину ведём от общей громкости, а не от каждого отсчёта осциллограммы:
    // по отсчётам получалась рваная волна, а нужна гладкая лента
    RIB.amp += (loud(V) - RIB.amp) * 0.06;

    const pts = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const py = y0
        + Math.sin(u * 2.6 + t * 0.00038) * h * 0.1
        + Math.sin(u * 6.2 - t * 0.00025) * h * 0.035;

      // перекрут вдоль ленты: где косинус у нуля, полоса повёрнута к нам ребром
      const tw = Math.cos(u * 11 - t * 0.00085);
      // осциллограмма добавляет мелкую дрожь по краю, но не рисует форму
      const v = live && time ? (time[Math.floor(u * (time.length - 1))] - 128) / 128 : 0;
      const hw = maxW * (0.3 + RIB.amp * 0.95) * Math.abs(tw)
               + Math.abs(v) * maxW * 0.16 + 0.8;

      pts.push({ x: u * w, y: py, hw: hw, front: tw >= 0 });
    }

    x.save();
    x.lineJoin = 'round';
    for (let i = 0; i < N; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L, ny = dx / L;      // нормаль: вдоль неё откладываем ширину

      // разница лицевой и изнаночной стороны и есть весь объём.
      // сделаешь их похожими - лента тут же схлопнется в плоское пятно
      x.fillStyle = a.front
        ? `rgba(${ac},${(0.34 + beat * 0.16).toFixed(3)})`
        : `rgba(${ac},${(0.07 + beat * 0.04).toFixed(3)})`;

      x.beginPath();
      x.moveTo(a.x + nx * a.hw, a.y + ny * a.hw);
      x.lineTo(b.x + nx * b.hw, b.y + ny * b.hw);
      x.lineTo(b.x - nx * b.hw, b.y - ny * b.hw);
      x.lineTo(a.x - nx * a.hw, a.y - ny * a.hw);
      x.closePath();
      x.fill();

      // блик только на лицевой стороне - он и показывает, где лента повернулась
      if (a.front) {
        x.strokeStyle = `rgba(255,255,255,${(0.1 + beat * 0.12).toFixed(3)})`;
        x.lineWidth = 1.2;
        x.beginPath();
        x.moveTo(a.x + nx * a.hw, a.y + ny * a.hw);
        x.lineTo(b.x + nx * b.hw, b.y + ny * b.hw);
        x.stroke();
      }
    }
    x.restore();
  }

  const VIZ2 = { aurora, sphere, kaleid, rain, pulsar, ribbon };

  if (typeof module !== 'undefined' && module.exports) module.exports = VIZ2;
  else window.VIZ2 = VIZ2;
})();
