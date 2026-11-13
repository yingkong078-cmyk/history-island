import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');

const readText = p => readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const css = readText(join(src, 'style.css'));
const template = readText(join(src, 'template.html'));

const jsFiles = [
  'data/units.js',
  'data/volumes.js',
  'data/dao-volumes.js',
  'data/lessons-1.js',
  'data/lessons-2.js',
  'data/lessons-3.js',
  'data/lessons-4.js',
  'data/topics.js',
  'data/topics-extra.js',
  'data/timeline.js',
  'data/questions-1.js',
  'data/questions-2.js',
  'data/questions-3.js',
  'data/questions-4.js'
];

const genDir = join(src, 'data/generated');
const genFiles = existsSync(genDir) ? readdirSync(genDir).filter(f => f.endsWith('.json')).sort() : [];
const generated = genFiles.map(f => JSON.parse(readFileSync(join(genDir, f), 'utf8')));

const portraitDir = join(src, 'data/portraits');
const portraitMeta = JSON.parse(readText(join(src, 'data/portraits.json')));
const portraitData = {};
for (const [name, p] of Object.entries(portraitMeta)) {
  const file = join(portraitDir, p.file);
  if (!existsSync(file)) continue;
  portraitData[name] = { ...p, src: 'data:image/webp;base64,' + readFileSync(file).toString('base64') };
}
const portraitChunk = `const FIGURE_PORTRAITS = ${JSON.stringify(portraitData)};`;

const genChunk = `/* ---------- generated content (${genFiles.length} units) ---------- */
(function () {
  const GEN = ${JSON.stringify(generated)};
  GEN.forEach(g => {
    if (g.unit) {
      g.unit.volume = g.unit.volume || g.volume;
      UNITS.push(g.unit);
    }
    if (Array.isArray(g.lessons)) LESSONS.push(...g.lessons);
    if (Array.isArray(g.questions)) QUESTIONS.push(...g.questions);
    if (Array.isArray(g.timeline)) TIMELINE.push(...g.timeline);
    if (Array.isArray(g.topics)) TOPICS.push(...g.topics);
  });
  const seen = new Set();
  for (let i = TIMELINE.length - 1; i >= 0; i--) {
    const k = TIMELINE[i].t + '|' + TIMELINE[i].text;
    if (seen.has(k)) TIMELINE.splice(i, 1);
    else seen.add(k);
  }
})();
`;

const daoDir = join(src, 'data/dao-generated');
const daoFiles = existsSync(daoDir) ? readdirSync(daoDir).filter(f => f.endsWith('.json')).sort() : [];
const daoGenerated = daoFiles.map(f => JSON.parse(readFileSync(join(daoDir, f), 'utf8')));
const daoChunk = `/* ---------- 道德与法治内容 (${daoFiles.length} 册) ---------- */
(function () {
  const DAO = ${JSON.stringify(daoGenerated)};
  DAO.forEach(g => {
    if (g.volume) {
      const v = VOLUMES.find(x => x.id === g.volume.id);
      if (v) Object.assign(v, g.volume, { subject: 'dao' });
      else VOLUMES.push({ ...g.volume, subject: 'dao' });
    }
    if (Array.isArray(g.units)) UNITS.push(...g.units.map(u => ({ ...u, subject: 'dao' })));
    if (Array.isArray(g.lessons)) LESSONS.push(...g.lessons);
    if (Array.isArray(g.questions)) QUESTIONS.push(...g.questions);
  });
})();
`;

const js = jsFiles
  .map(f => `/* ---------- ${f} ---------- */\n` + readText(join(src, f)))
  .join('\n\n') + '\n\n' + genChunk + '\n\n' + daoChunk + '\n\n' + portraitChunk + '\n\n' +
  [
    'app/core.js', 'app/views-home.js', 'app/views-courses.js', 'app/views-campaign.js',
    'app/views-unit.js', 'app/views-practice.js', 'app/views-wrong.js', 'app/views-growth.js',
    'app/views-guide.js', 'app/views-dao.js', 'app/portraits.js', 'app/labs.js', 'app/sync.js', 'app/assistant.js', 'app/boot.js'
  ].map(f => `/* ---------- ${f} ---------- */\n` + readText(join(src, f))).join('\n\n');

const html = template
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => js);

const outName = '时光探险岛-中国历史.html';
writeFileSync(join(root, outName), html, 'utf8');
writeFileSync(join(root, 'index.html'), html, 'utf8');
console.log(`built ${outName}: ${(html.length / 1024).toFixed(1)} KB · ${genFiles.length} generated units`);








