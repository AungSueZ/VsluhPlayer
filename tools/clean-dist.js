// Убирает из dist установщики прошлых версий - запускается сам перед сборкой.
//
// Каждый установщик весит около сотни мегабайт, и за несколько релизов папка
// разрастается до гигабайтов, хотя нужен из неё всегда только свежий:
// старые версии и так лежат в релизах на GitHub.
//
// Трогаем только файлы, которые сами же и собрали: имя начинается с того
// префикса, что задан в artifactName, и заканчивается на .exe или .blockmap.
// Всё остальное в папке не наше дело.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const build = pkg.build || {};

const out = path.join(root, (build.directories && build.directories.output) || 'dist');
if (!fs.existsSync(out)) process.exit(0);

// "Vsluh-Setup-${version}.${ext}" -> "Vsluh-Setup-"
const tpl = (build.win && build.win.artifactName) || '${productName}-Setup-${version}.${ext}';
const prefix = tpl.split('${version}')[0]
  .replace('${productName}', build.productName || pkg.name)
  .replace('${name}', pkg.name);

const keep = prefix + pkg.version + '.';      // точка обязательна: 1.2.0 не должна ловить 1.2.0-beta
let freed = 0, gone = 0;

for (const name of fs.readdirSync(out)) {
  if (!name.startsWith(prefix)) continue;
  if (name.startsWith(keep)) continue;
  if (!/\.(exe|blockmap)$/i.test(name)) continue;

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
  console.log(`убрано установщиков прошлых версий: ${gone}, освобождено ${Math.round(freed / 1048576)} МБ`);
}
