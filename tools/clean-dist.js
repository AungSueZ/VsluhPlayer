// Убирает из dist установщики прошлых версий - запускается сам перед сборкой.
//
// Каждый установщик весит около сотни мегабайт, и за несколько релизов папка
// разрастается до гигабайтов, хотя нужен из неё всегда только свежий:
// старые версии и так лежат в релизах на GitHub.
//
// Трогаем только файлы, которые сами же и собрали: имя начинается с того
// префикса, что задан в artifactName, и заканчивается на .exe, .AppImage
// или .blockmap. Всё остальное в папке не наше дело.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const build = pkg.build || {};

const out = path.join(root, (build.directories && build.directories.output) || 'dist');
if (!fs.existsSync(out)) process.exit(0);

// Что мы вообще собираем: по шаблону имени на систему и по набору расширений.
// Виндовый и линуксовый префиксы пересекаются ("Vsluh-Setup-..." и "Vsluh-..."),
// поэтому сперва собираем все имена свежей версии и только потом чистим -
// иначе линуксовый проход удалил бы свежий виндовый .blockmap.
const fill = (tpl, version) => tpl
  .replace('${version}', version)
  .replace('${productName}', build.productName || pkg.name)
  .replace('${name}', pkg.name);

const MINE = [
  [(build.win && build.win.artifactName) || '${productName}-Setup-${version}.${ext}', /\.(exe|blockmap)$/i],
  [(build.linux && build.linux.artifactName) || '${productName}-${version}.${ext}', /\.(AppImage|blockmap)$/i]
].map(([tpl, ext]) => ({
  prefix: fill(tpl.split('${version}')[0], ''),
  // "Vsluh-2.0.0-x86_64." - точка обязательна: 1.2.0 не должна ловить 1.2.0-beta
  keep: fill(tpl, pkg.version).split('${ext}')[0],
  ext
}));

let freed = 0, gone = 0;

for (const name of fs.readdirSync(out)) {
  if (!MINE.some(t => name.startsWith(t.prefix) && t.ext.test(name))) continue;   // не наше
  if (MINE.some(t => name.startsWith(t.keep))) continue;                          // свежее

  const f = path.join(out, name);
  try {
    const st = fs.statSync(f);
    if (!st.isFile()) continue;
    fs.rmSync(f);
    freed += st.size;
    gone++;
  } catch { /* занят или уже удалён - не повод останавливать сборку */ }
}

if (gone) {
  console.log(`убрано сборок прошлых версий: ${gone}, освобождено ${Math.round(freed / 1048576)} МБ`);
}
