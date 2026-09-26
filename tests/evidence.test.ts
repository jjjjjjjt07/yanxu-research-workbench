import test from 'node:test';
import assert from 'node:assert/strict';
import { foldForMatch, resolveEvidence, crossColumnSuspect } from '../lib/evidence.ts';
import { checkedValue } from '../lib/domain.ts';
import type { Block } from '../lib/domain.ts';

const b = (id: string, page: number, text: string): Block => ({ id, page, text });

void test('换行不再误杀真实摘录，且存入的是原文连续子串', () => {
  const blocks = [
    b(
      'p4:b181',
      4,
      'We train the hand motion estimation network with\nAdamW [27] optimizer for 250K iterations and a learning rate of 1e-5.',
    ),
  ];
  const quote =
    'We train the hand motion estimation network with AdamW [27] optimizer for 250K iterations';
  const found = resolveEvidence(blocks, { blockId: 'p4:b181', quote });
  assert.equal(found.ok, true);
  if (!found.ok) return;
  assert.equal(found.normalized, true, '需要归一化才算命中');
  assert.equal(found.relocated, false);
  assert.ok(
    blocks[0].text.includes(found.text),
    '存入的摘录必须是原文里真实存在的连续子串',
  );
  assert.ok(found.text.includes('\n'), '保留原文换行，而不是模型重排后的排版');
});

void test('行末断词（Recom- / mendation）也能命中', () => {
  const blocks = [b('a', 1, '我们的建议是 Recom-\nmendation 可用。')];
  const found = resolveEvidence(blocks, { blockId: 'a', quote: 'Recommendation 可用。' });
  assert.equal(found.ok, true);
});

void test('模型引错 blockId 时重定位到同页正确块并标记已校正', () => {
  const blocks = [
    b('p7:b108', 7, 'as a prerequisite for 3D lifting of in-hand objects (Sec. 4.4).'),
    b(
      'p7:b112',
      7,
      'We evaluate three methods, including the off-the-shelf EgoHOS [75] and two variants of Mask R-CNN [28].',
    ),
  ];
  const found = resolveEvidence(blocks, {
    blockId: 'p7:b108',
    quote: 'We evaluate three methods, including the off-the-shelf EgoHOS [75] and two variants of Mask R-CNN [28].',
  });
  assert.equal(found.ok, true);
  if (!found.ok) return;
  assert.equal(found.relocated, true);
  assert.equal(found.blockId, 'p7:b112', 'blockId 被校正到真正含该摘录的块');
  assert.equal(found.page, 7);
});

void test('跨栏拼接出的无关片段不会被误判为可定位', () => {
  // 两栏各自的块都不含这段拼接文本，因此任何单块内都不是连续子串 → 必须失败。
  const blocks = [
    b('colA1', 1, 'Non-black Office trash can'),
    b('colA2', 1, 'INHerit-SG, an asynchronous dual-stream architecture'),
    b('colB1', 1, 'Floor 1 update scheme, and a structured retrieval mechanism'),
  ];
  const stitched =
    'trash can INHerit-SG, an asynchronous dual-stream architecture Floor 1 update scheme';
  const found = resolveEvidence(blocks, { blockId: 'colA1', quote: stitched });
  assert.equal(found.ok, false, '跨块拼接不得通过');
});

void test('分栏交错的摘录会被标记，但不因此放宽匹配', () => {
  const interleaved =
    'Non-black\nOffice\ntrash can\nINHerit-SG, an asynchronous dual-stream architecture that sys-\nnear it\ntematically structures the environment';
  const blocks = [b('x', 1, interleaved)];
  const found = resolveEvidence(blocks, { blockId: 'x', quote: interleaved });
  assert.equal(found.ok, true);
  if (!found.ok) return;
  assert.equal(found.crossColumnSuspect, true, '应标记分栏交错嫌疑');
  // 仍然要求连续命中，不做任何重排
  assert.equal(
    resolveEvidence(blocks, { blockId: 'x', quote: 'an asynchronous architecture INHerit-SG' }).ok,
    false,
  );
});

void test('crossColumnSuspect 只在非句末硬换行达到阈值时才为真', () => {
  assert.equal(crossColumnSuspect('one two three four'), false);
  assert.equal(
    crossColumnSuspect('ends here.\nStarts new sentence.\nAnd another.'),
    false,
  );
  assert.equal(
    crossColumnSuspect('trash can\nINHerit-SG is here\nnear it\nsystematically structures'),
    true,
  );
});

void test('空摘录与过短摘录被拒绝并给出规则码', () => {
  const blocks = [b('a', 1, 'some text here')];
  const empty = resolveEvidence(blocks, { blockId: 'a', quote: '  ' });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.rule, 'empty-quote');
  const missing = resolveEvidence(blocks, { blockId: 'a', quote: '完全不在原文里的一句话' });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.rule, 'not-in-cited-block');
});

void test('foldForMatch 只做排版归一化，不删除实义字符', () => {
  assert.equal(foldForMatch('Recom-\nmendation'), 'recommendation');
  assert.equal(foldForMatch('A\u00ADB'), 'ab');
  assert.equal(foldForMatch('keep, punctuation!'), 'keep, punctuation!');
  assert.equal(foldForMatch('caf\u00e9'), 'café');
});

const field = { id: 'f1', name: '实验条件', definition: '', version: 1 };

void test('已写入的字段走同一校验：摘录不在块内则不予写入（EgoPressure 无效回跳回归）', () => {
  const blocks = [b('e5:b1', 5, 'paper and placed over the Sensel Morph pad across participants.')];
  const rejected: string[] = [];
  const cell = checkedValue(
    {
      value: '所有地图构建在单张 RTX 4090 GPU 上',
      blockId: 'e5:b1',
      quote: 'All cameras and the touchpad are connected to two work-stations',
    },
    blocks,
    field,
    0,
    'ai',
    (draft) => rejected.push(draft.rule),
  );
  assert.equal(cell.sourceValid, false);
  assert.equal(cell.value, '', '未通过校验的候选不得当作已确认事实');
  assert.equal(cell.quote, '');
  assert.equal(cell.page, null);
  assert.deepEqual(rejected, ['not-in-cited-block'], '要留下可追溯的拒绝规则');
  assert.match(cell.note, /未通过证据校验/);
});

void test('跨页才找到摘录时：保留为待核对候选，不填入已确认字段', () => {
  const blocks = [
    b('pg1:b1', 1, 'Introduction paragraph.'),
    b('pg4:b7', 4, 'The dataset contains 425 recordings in total.'),
  ];
  const drafts: { rule: string; pendingReview?: boolean }[] = [];
  const cell = checkedValue(
    {
      value: '数据集包含 425 段录制',
      blockId: 'pg1:b1', // 模型说在第 1 页
      quote: 'The dataset contains 425 recordings in total.', // 实际在第 4 页
    },
    blocks,
    field,
    0,
    'ai',
    (d) => drafts.push({ rule: d.rule, pendingReview: d.pendingReview }),
  );
  assert.equal(cell.value, '', '不得填入已确认字段');
  assert.equal(cell.sourceValid, false, '下游不能把它当作已确认事实');
  assert.equal(cell.page, 4, '仍要记录实际来源页');
  assert.equal(cell.blockId, 'pg4:b7', '仍要记录实际来源块');
  assert.equal(cell.needsCitationReview, true);
  assert.deepEqual(cell.citationMoved, {
    fromBlockId: 'pg1:b1',
    fromPage: 1,
    toBlockId: 'pg4:b7',
    toPage: 4,
  });
  assert.match(cell.note, /保留为待人工核对候选/);
  assert.deepEqual(drafts, [{ rule: 'citation-moved-cross-page', pendingReview: true }]);

  // 同页内只是块编号写错：校正后按普通取值处理
  const samePage = checkedValue(
    { value: 'x', blockId: 'pg4:b1', quote: 'The dataset contains 425 recordings in total.' },
    [b('pg4:b1', 4, 'lead-in'), b('pg4:b7', 4, 'The dataset contains 425 recordings in total.')],
    field,
    0,
  );
  assert.equal(samePage.value, 'x');
  assert.equal(samePage.sourceValid, true);
  assert.equal(samePage.needsCitationReview, undefined);
  assert.equal(samePage.page, 4);
});

void test('通过校验的字段存入可回跳的原文子串，并标注需要复核的情形', () => {
  const blocks = [
    b('a1', 2, 'unrelated lead-in'),
    b('a2', 2, 'We evaluate three methods on the HOT3D test clips.'),
  ];
  const cell = checkedValue(
    { value: '在 HOT3D 测试片段上评估三种方法', blockId: 'a1', quote: 'We evaluate three methods on the HOT3D test clips.' },
    blocks,
    field,
    0,
  );
  assert.equal(cell.sourceValid, true);
  assert.equal(cell.blockId, 'a2', '引用位置被校正');
  assert.equal(cell.page, 2);
  assert.ok(blocks[1].text.includes(cell.quote), '存入的摘录可在其块内定位');
  assert.match(cell.note, /校正/);
});
