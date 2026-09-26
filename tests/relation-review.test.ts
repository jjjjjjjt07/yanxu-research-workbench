import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewRelationType } from '../lib/relation-review.ts';
import type { Entity, Relation } from '../lib/graph.ts';

const entity = (id: string, name: string, type: Entity['type'] = 'method'): Entity => ({
  id,
  name,
  type,
  aliases: [],
  domain: '',
  definition: '',
  paperIds: ['p'],
});

const relation = (
  type: Relation['type'],
  condition: string,
  support: Relation['support'] = 'supported',
) => ({ type, condition, support });

void test('把「在某数据集上评估」写成 uses 会被要求复核并建议 evaluatedOn', () => {
  const review = reviewRelationType(
    relation('uses', 'HOT3D数据集使用Project Aria设备采集数据。FoundPose在HOT3D数据集上进行评估。'),
    entity('d1', 'HOT3D', 'data'),
  );
  // 该条件句同时含“使用”与“评估”，应以评估优先触发
  assert.equal(review.status, 'needs-review');
  if (review.status !== 'needs-review') return;
  assert.ok(review.suggested === 'evaluatedOn' || review.suggested === 'trainedOn');
});

void test('纯评估措辞的关系被建议为 evaluatedOn', () => {
  const review = reviewRelationType(
    relation('uses', 'RAG-3DSG is evaluated on SceneFun3D dataset.'),
    entity('d', 'SceneFun3D dataset', 'data'),
  );
  assert.equal(review.status, 'needs-review');
  if (review.status !== 'needs-review') return;
  assert.equal(review.suggested, 'evaluatedOn');
  assert.match(review.reason, /评估/);
});

void test('训练措辞的关系被建议为 trainedOn', () => {
  const review = reviewRelationType(
    relation('uses', 'To train the motion infiller network, we use HOT3D.'),
    entity('d', 'HOT3D', 'data'),
  );
  assert.equal(review.status, 'needs-review');
  if (review.status !== 'needs-review') return;
  assert.equal(review.suggested, 'trainedOn');
});

void test('确实表达“方法实际使用某组件”的 uses 关系保持通过', () => {
  const review = reviewRelationType(
    relation('uses', 'FoundPose使用DINOv2特征进行模板检索和匹配。'),
    entity('m', 'DINOv2'),
  );
  assert.equal(review.status, 'ok');
  assert.equal(reviewRelationType(relation('uses', 'StereoMatch使用DINOv2特征进行立体匹配。'), entity('m', 'DINOv2')).status, 'ok');
});

void test('对比措辞的关系被建议为 compares', () => {
  const review = reviewRelationType(
    relation('uses', 'StereoMatch在3D提升任务上优于MonoDepth。'),
    entity('m', 'MonoDepth'),
  );
  assert.equal(review.status, 'needs-review');
  if (review.status !== 'needs-review') return;
  assert.equal(review.suggested, 'compares');
});

void test('依据只被部分支持时，即便类型没错也必须标为需复核（UmeTrack → MANO 回归）', () => {
  const review = reviewRelationType(
    relation('uses', 'UmeTrack手部跟踪使用MANO格式表示手部姿态。', 'partial'),
    entity('m', 'MANO'),
  );
  assert.equal(review.status, 'needs-review');
  if (review.status !== 'needs-review') return;
  assert.equal(review.suggested, undefined, '这种情况没有确定的替代类型，只要求人工核对');
  assert.match(review.reason, /partial|部分/);
});

void test('conflict / unknown 同样必须复核', () => {
  for (const support of ['conflict', 'unknown'] as const)
    assert.equal(
      reviewRelationType(relation('supports', '某方法支持某结论。', support), entity('c', 'X')).status,
      'needs-review',
    );
  assert.equal(
    reviewRelationType(relation('supports', '某方法支持某结论。', 'supported'), entity('c', 'X')).status,
    'ok',
  );
});

void test('离线回放必须同时满足「测试构建 + 非公开实例 + 显式开启」', async () => {
  const { replayAllowed } = await import('../lib/replay.ts');
  const base = { buildDev: true, privateInstance: true, controlValue: '1' };
  assert.equal(replayAllowed(base), true, '三条件齐备才允许');
  // 生产构建：无论数据库怎么写都不允许
  assert.equal(replayAllowed({ ...base, buildDev: false }), false);
  // 公开实例：不允许
  assert.equal(replayAllowed({ ...base, privateInstance: false }), false);
  // 误建回放表并写入开启行、但仍不是测试环境 → 不允许
  assert.equal(replayAllowed({ buildDev: false, privateInstance: true, controlValue: '1' }), false);
  assert.equal(replayAllowed({ buildDev: true, privateInstance: false, controlValue: '1' }), false);
  // 控制行的严格判定
  assert.equal(replayAllowed({ ...base, controlValue: '0' }), false);
  assert.equal(replayAllowed({ ...base, controlValue: '' }), false);
  assert.equal(replayAllowed({ ...base, controlValue: undefined }), false, '控制行缺失必须视为关闭');
  assert.equal(replayAllowed({ ...base, controlValue: 'true' }), false, '不做宽松解析');
  assert.equal(replayAllowed({ ...base, controlValue: ' 1 ' }), false, '不做宽松解析');
});
