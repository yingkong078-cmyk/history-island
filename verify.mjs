import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');
const files = [
  'data/units.js', 'data/volumes.js', 'data/lessons-1.js', 'data/lessons-2.js', 'data/lessons-3.js', 'data/lessons-4.js',
  'data/topics.js', 'data/topics-extra.js', 'data/timeline.js',
  'data/questions-1.js', 'data/questions-2.js', 'data/questions-3.js', 'data/questions-4.js'
];
const genDir = join(src, 'data/generated');
const genFiles = existsSync(genDir) ? readdirSync(genDir).filter(f => f.endsWith('.json')).sort() : [];
const generated = genFiles.map(f => JSON.parse(readFileSync(join(genDir, f), 'utf8')));

let code = files.map(f => readFileSync(join(src, f), 'utf8')).join('\n');
code += `\nconst __GEN = ${JSON.stringify(generated)};
__GEN.forEach(g => { if (g.unit) { g.unit.volume = g.unit.volume || g.volume; UNITS.push(g.unit); } if (g.lessons) LESSONS.push(...g.lessons); if (g.questions) QUESTIONS.push(...g.questions); if (g.timeline) TIMELINE.push(...g.timeline); if (g.topics) TOPICS.push(...g.topics); });
globalThis.__data = { VOLUMES, UNITS, LESSONS, TOPICS, TIMELINE, QUESTIONS };`;
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(code, ctx, { filename: 'data-bundle.js' });
const { VOLUMES, UNITS, LESSONS, TOPICS, TIMELINE, QUESTIONS } = ctx.__data;

const errors = [];
const warnings = [];
const ids = arr => arr.map(x => x.id);

if (new Set(ids(UNITS)).size !== UNITS.length) errors.push('unit id 重复');
if (new Set(ids(LESSONS)).size !== LESSONS.length) errors.push('lesson id 重复');
if (new Set(ids(QUESTIONS)).size !== QUESTIONS.length) errors.push('question id 重复');
if (new Set(ids(VOLUMES)).size !== VOLUMES.length) errors.push('volume id 重复');

const toc = JSON.parse(readFileSync(join(src, 'data/toc.json'), 'utf8'));
const tocUnits = toc.units;
const tocLessons = tocUnits.flatMap(u => (u.lessons || []).map(l => ({ ...l, unit: u.id, volume: u.volume })));
const unitIds = new Set(ids(UNITS));
const lessonIds = new Set(ids(LESSONS));
const missingUnits = tocUnits.filter(u => !unitIds.has(u.id));
const missingLessons = tocLessons.filter(l => !lessonIds.has(l.id));
if (missingUnits.length) warnings.push(`尚未生成单元 ${missingUnits.length}: ${missingUnits.map(u => u.id).join(', ')}`);
if (missingLessons.length) warnings.push(`尚未生成课时 ${missingLessons.length}/${tocLessons.length}: ${missingLessons.slice(0, 12).map(l => l.id).join(', ')}${missingLessons.length > 12 ? '…' : ''}`);
const expectedUnits = tocUnits.length + 8;
const expectedLessons = tocLessons.length + 26;
if (missingUnits.length === 0 && missingLessons.length === 0) {
  if (UNITS.length !== expectedUnits) warnings.push(`单元总数 ${UNITS.length}，应为 ${expectedUnits}`);
  if (LESSONS.length !== expectedLessons) warnings.push(`课时总数 ${LESSONS.length}，应为 ${expectedLessons}`);
}

for (const tu of tocUnits) {
  const u = UNITS.find(x => x.id === tu.id);
  if (u) {
    if (u.title !== tu.title) warnings.push(`unit ${u.id} 标题与目录不一致：${u.title} ≠ ${tu.title}`);
    if (u.num !== tu.num) warnings.push(`unit ${u.id} 序号与目录不一致`);
  }
}
for (const tl of tocLessons) {
  const l = LESSONS.find(x => x.id === tl.id);
  if (l) {
    if (l.title !== tl.title) warnings.push(`lesson ${l.id} 标题与目录不一致：${l.title} ≠ ${tl.title}`);
    if (l.num !== tl.num) warnings.push(`lesson ${l.id} 序号与目录不一致`);
  }
}

for (const v of VOLUMES) {
  if (!UNITS.some(u => u.volume === v.id)) warnings.push(`分册 ${v.id} 还没有单元`);
}

for (const u of UNITS) {
  if (!VOLUMES.some(v => v.id === u.volume)) errors.push(`unit ${u.id} 的 volume 无效: ${u.volume}`);
  if (!u.title || !u.short) errors.push(`unit ${u.id} 缺标题`);
  const dup = UNITS.filter(x => x.volume === u.volume && x.num === u.num);
  if (dup.length > 1) errors.push(`volume ${u.volume} 内 unit num=${u.num} 重复`);
}

for (const l of LESSONS) {
  const u = UNITS.find(x => x.id === l.unit);
  if (!u) { errors.push(`lesson ${l.id} 的 unit 无效: ${l.unit}`); continue; }
  for (const key of ['title', 'core', 'significance', 'memory', 'pitfall', 'link']) {
    if (!l[key] || String(l[key]).trim().length < 2) errors.push(`lesson ${l.id} 缺字段 ${key}`);
  }
  if (!Array.isArray(l.points) || l.points.length < 2) errors.push(`lesson ${l.id} points 过少`);
  if (!Array.isArray(l.terms) || l.terms.length < 1) errors.push(`lesson ${l.id} terms 过少`);
  if (!Array.isArray(l.figures) || !l.figures.length) warnings.push(`lesson ${l.id} figures 为空`);
  if (!Array.isArray(l.events) || l.events.length < 1) errors.push(`lesson ${l.id} events 过少`);
  if (!Array.isArray(l.exam) || !l.exam.length) warnings.push(`lesson ${l.id} exam 为空`);
  if (!l.source || !l.source.quote) errors.push(`lesson ${l.id} 缺史料`);
  const qn = QUESTIONS.filter(q => q.lesson === l.id).length;
  if (qn < 3) warnings.push(`lesson ${l.id} 只有 ${qn} 道题`);
}

for (const q of QUESTIONS) {
  const l = LESSONS.find(x => x.id === q.lesson);
  if (!l) { errors.push(`question ${q.id} 的 lesson 无效: ${q.lesson}`); continue; }
  if (q.unit !== l.unit) errors.push(`question ${q.id} 的 unit(${q.unit}) 与 lesson(${l.unit}) 不一致`);
  if (!q.stem || !q.explain || !q.point) errors.push(`question ${q.id} 缺题干/解析/知识点`);
  if (![1, 2, 3].includes(q.level)) warnings.push(`question ${q.id} level 异常`);
  if (q.type === 'choice') {
    if (!Array.isArray(q.options) || q.options.length < 3) errors.push(`question ${q.id} 选项不足`);
    if (!(q.answer >= 0 && q.answer < q.options.length)) errors.push(`question ${q.id} answer 越界`);
    if (new Set(q.options).size !== q.options.length) warnings.push(`question ${q.id} 选项重复`);
  } else if (q.type === 'fill') {
    if (!Array.isArray(q.answer) || !q.answer.length) errors.push(`question ${q.id} fill 答案为空`);
  } else if (q.type === 'order') {
    if (!Array.isArray(q.items) || q.items.length < 3) errors.push(`question ${q.id} order 项不足`);
    if (new Set(q.items).size !== q.items.length) errors.push(`question ${q.id} order 项重复`);
  } else if (q.type === 'match') {
    if (!Array.isArray(q.pairs) || q.pairs.length < 3) errors.push(`question ${q.id} match 对不足`);
    const lefts = q.pairs.map(p => p[0]), rights = q.pairs.map(p => p[1]);
    if (new Set(lefts).size !== lefts.length) errors.push(`question ${q.id} match 左栏重复`);
    if (new Set(rights).size !== rights.length) errors.push(`question ${q.id} match 右栏重复（会导致配对歧义）`);
  } else {
    errors.push(`question ${q.id} 类型未知: ${q.type}`);
  }
}

for (const t of TIMELINE) {
  if (t.unit && !UNITS.some(u => u.id === t.unit)) errors.push(`timeline「${t.t}」unit 无效`);
  if (typeof t.y !== 'number' || Number.isNaN(t.y)) errors.push(`timeline「${t.t}」y 无效`);
}
for (const t of TOPICS) {
  if (!t.id || !t.title || !t.intro) errors.push(`topic ${t.id || '?'} 字段缺失`);
  if (!Array.isArray(t.sections) || !t.sections.length) errors.push(`topic ${t.id} sections 为空`);
}

const typeCount = QUESTIONS.reduce((m, q) => (m[q.type] = (m[q.type] || 0) + 1, m), {});

/* ---------- 道德与法治 4 册 ---------- */
const daoDir = join(src, 'data/dao-generated');
const daoFiles = existsSync(daoDir) ? readdirSync(daoDir).filter(f => f.endsWith('.json')).sort() : [];
const daoData = daoFiles.map(f => JSON.parse(readFileSync(join(daoDir, f), 'utf8')));
const daoUnits = daoData.flatMap(g => g.units || []);
const daoLessons = daoData.flatMap(g => g.lessons || []);
const daoQuestions = daoData.flatMap(g => g.questions || []);
const daoIds = [...daoUnits, ...daoLessons, ...daoQuestions].map(x => x.id);
if (daoData.length !== 4) errors.push(`道法分册文件 ${daoData.length} 个，应为 4`);
if (new Set(daoIds).size !== daoIds.length) errors.push('道法 ID 有重复');
const daoUnitMap = new Map(daoUnits.map(u => [u.id, u]));
const daoLessonMap = new Map(daoLessons.map(l => [l.id, l]));
const expectedDaoToc = {
  m6: [['m6u1', '成长的节拍', ['m6l1', '中学时代'], ['m6l2', '学习新天地'], ['m6l3', '发现自己']], ['m6u2', '友谊的天空', ['m6l4', '友谊与成长同行'], ['m6l5', '交友的智慧']], ['m6u3', '师长情谊', ['m6l6', '师生之间'], ['m6l7', '亲情之爱']], ['m6u4', '生命的思考', ['m6l8', '探问生命'], ['m6l9', '珍视生命'], ['m6l10', '绽放生命之花']]],
  m7: [['m7u1', '青春时光', ['m7l1', '青春的邀约'], ['m7l2', '青春的心弦'], ['m7l3', '青春的证明']], ['m7u2', '做情绪情感的主人', ['m7l4', '揭开情绪的面纱'], ['m7l5', '品出情感的韵味']], ['m7u3', '在集体中成长', ['m7l6', '“我”和“我们”'], ['m7l7', '共奏和谐乐章'], ['m7l8', '美好集体有我在']], ['m7u4', '走进法治天地', ['m7l9', '法律在我们身边'], ['m7l10', '法律伴我们成长']]],
  m8: [['m8u1', '走进社会生活', ['m8l1', '丰富的社会生活'], ['m8l2', '网络生活新空间']], ['m8u2', '遵守社会规则', ['m8l3', '社会生活离不开规则'], ['m8l4', '社会生活讲道德'], ['m8l5', '做守法的公民']], ['m8u3', '承担社会责任', ['m8l6', '责任与角色同在'], ['m8l7', '积极奉献社会']], ['m8u4', '维护国家利益', ['m8l8', '国家利益至上'], ['m8l9', '树立总体国家安全观'], ['m8l10', '建设美好祖国']]],
  m9: [['m9u1', '富强与创新', ['m9l1', '踏上强国之路'], ['m9l2', '创新驱动发展']], ['m9u2', '民主与法治', ['m9l3', '追求民主价值'], ['m9l4', '建设法治中国']], ['m9u3', '文明与家园', ['m9l5', '守望精神家园'], ['m9l6', '建设美丽中国']], ['m9u4', '和谐与梦想', ['m9l7', '中华一家亲'], ['m9l8', '中国人 中国梦']]]
};
for (const [f, rows] of Object.entries(expectedDaoToc)) {
  const g = daoData.find(x => x.volume?.id === f);
  if (!g) { errors.push(`道法缺少 ${f}.json`); continue; }
  const totalL = rows.reduce((n, r) => n + 2 + r[2].length - 2, 0);
  if (g.units.length !== rows.length) errors.push(`${f} 单元数 ${g.units.length}，应为 ${rows.length}`);
  for (const [uid, utitle, ...lessons] of rows) {
    const u = daoUnitMap.get(uid);
    if (!u || u.title !== utitle) errors.push(`道法单元 ${uid} 标题/存在性错误`);
    for (const [lid, ltitle] of lessons) {
      const l = daoLessonMap.get(lid);
      if (!l || l.title !== ltitle) errors.push(`道法课时 ${lid} 标题/存在性错误`);
    }
  }
}
for (const l of daoLessons) {
  if (!daoUnitMap.has(l.unit)) errors.push(`道法课时 ${l.id} unit 无效`);
  for (const k of ['title', 'hook', 'core', 'significance', 'memory', 'pitfall', 'link']) {
    if (!l[k] || String(l[k]).trim().length < 2) errors.push(`道法课时 ${l.id} 缺 ${k}`);
  }
  for (const k of ['points', 'terms', 'cases', 'actions', 'values', 'exam']) {
    if (!Array.isArray(l[k]) || !l[k].length) errors.push(`道法课时 ${l.id} 的 ${k} 为空`);
  }
  if (!l.source || !l.source.quote || !l.source.from) errors.push(`道法课时 ${l.id} source 不完整`);
}
for (const q of daoQuestions) {
  const l = daoLessonMap.get(q.lesson);
  if (!l) { errors.push(`道法题 ${q.id} lesson 无效`); continue; }
  if (q.unit !== l.unit) errors.push(`道法题 ${q.id} unit 与 lesson 不一致`);
  if (!q.stem || !q.explain || !q.point) errors.push(`道法题 ${q.id} 缺字段`);
  if (q.type === 'choice') {
    if (!Array.isArray(q.options) || q.options.length !== 4) errors.push(`道法题 ${q.id} 选项不是 4 个`);
    if (!(q.answer >= 0 && q.answer < 4)) errors.push(`道法题 ${q.id} answer 越界`);
  } else if (q.type === 'fill') {
    if (!Array.isArray(q.answer) || !q.answer.length || !String(q.stem).includes('______')) errors.push(`道法题 ${q.id} fill 结构错误`);
  } else if (q.type === 'match') {
    const pairs = q.pairs || [];
    if (pairs.length !== 4) errors.push(`道法题 ${q.id} match 对数不是 4`);
    if (new Set(pairs.map(p => p[0])).size !== pairs.length) errors.push(`道法题 ${q.id} match 左栏重复`);
    if (new Set(pairs.map(p => p[1])).size !== pairs.length) errors.push(`道法题 ${q.id} match 右栏重复`);
  } else if (q.type === 'order') {
    if (!Array.isArray(q.items) || q.items.length < 4) errors.push(`道法题 ${q.id} order 项不足`);
  } else errors.push(`道法题 ${q.id} 类型未知`);
}
if (daoUnits.length !== 16) errors.push(`道法单元 ${daoUnits.length}，应为 16`);
if (daoLessons.length !== 38) errors.push(`道法课时 ${daoLessons.length}，应为 38`);
if (daoQuestions.length !== 152) errors.push(`道法题目 ${daoQuestions.length}，应为 152`);
const daoTypeCount = daoQuestions.reduce((m, q) => (m[q.type] = (m[q.type] || 0) + 1, m), {});

console.log(`分册 ${VOLUMES.length} · 单元 ${UNITS.length}/${expectedUnits} · 课时 ${LESSONS.length}/${expectedLessons} · 题目 ${QUESTIONS.length}`);
console.log('题型分布:', typeCount);
console.log(`道法 4 册 · 单元 ${daoUnits.length} · 课时 ${daoLessons.length} · 题目 ${daoQuestions.length}`, daoTypeCount);
console.log(`年表 ${TIMELINE.length} 条 · 专题 ${TOPICS.length} 个 · 每课平均题目 ${(QUESTIONS.length / LESSONS.length).toFixed(2)}`);
if (warnings.length) console.log(`\n⚠ 警告 ${warnings.length}:\n` + warnings.slice(0, 20).map(w => ' - ' + w).join('\n') + (warnings.length > 20 ? '\n …' : ''));
if (errors.length) {
  console.error(`\n✖ 错误 ${errors.length}:\n` + errors.slice(0, 40).map(e => ' - ' + e).join('\n') + (errors.length > 40 ? '\n …' : ''));
  process.exit(1);
}
console.log('\n✓ 数据结构校验通过');



