import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedExtraction, graphExtractionSchema } from '../lib/graph.ts';
import type { Block, Paper } from '../lib/domain.ts';

const paper: Paper = {
  id: 'p1',
  title: '示例论文',
  filename: 'demo.pdf',
  pages: 2,
  hash: 'h'.repeat(64),
  kind: 'pdf',
  sample: false,
  blockCount: 3,
  importedAt: '2026-09-25T00:00:00.000Z',
};

const blocks: Block[] = [
  { id: 'p1:b1', page: 1, text: 'We propose a dual-stream architecture for scene graphs.' },
  { id: 'p1:b2', page: 1, text: 'The system is evaluated on the SceneFun3D dataset.' },
  { id: 'p1:b3', page: 2, text: 'Unrelated paragraph about future work.' },
  { id: 'p1:b4', page: 2, text: 'FoundPose retrieves templates using DINOv2 features.' },
];

/** surface 必须在 quote 中逐字出现，否则实体提及本身就通不过校验。 */
const entity = (
  key: string,
  name: string,
  surface: string,
  quote: string,
  blockId: string,
) => ({
  key,
  name,
  type: 'method' as const,
  aliases: [],
  domain: '视觉',
  definition: '定义',
  mentions: [{ blockId, quote, surface }],
});

/** 两个实体都正常，便于把注意力集中在关系侧。 */
const base = {
  entities: [
    entity('e1', 'DualStream', 'dual-stream architecture', 'dual-stream architecture', 'p1:b1'),
    entity('e2', 'SceneFun3D', 'SceneFun3D', 'SceneFun3D', 'p1:b2'),
  ],
};

const run = (relations: unknown[]) =>
  checkedExtraction(
    graphExtractionSchema.parse({ ...base, relations }),
    paper,
    blocks,
    paper.hash,
    'run-1',
  );

void test('模型引错 blockId 时：关系被救回、证据块被校正、摘录换成原文子串', () => {
  const out = run([
    {
      source: 'e1',
      target: 'e2',
      type: 'uses',
      condition: '在 SceneFun3D 上评估',
      // 引用了错误的块 b1，但引文实际在 b2
      evidence: [{ blockId: 'p1:b1', quote: 'The system is evaluated on the SceneFun3D dataset.' }],
    },
  ]);
  assert.equal(out.isolated.length, 0, '不应再被隔离');
  assert.equal(out.relations.length, 1);
  const evidence = out.evidence.find((e) => e.id === out.relations[0].evidenceIds[0])!;
  assert.equal(evidence.blockId, 'p1:b2', 'blockId 被校正到真正含该摘录的块');
  assert.equal(evidence.page, 1, '页码随之校正');
  assert.ok(blocks[1].text.includes(evidence.quote), '存的是原文连续子串，可直接回跳');
});

void test('摘录完全不在原文时隔离，并给出论文、页码、规则与可读原因', () => {
  const out = run([
    {
      source: 'e1',
      target: 'e2',
      type: 'uses',
      condition: '无中生有的关系',
      evidence: [{ blockId: 'p1:b2', quote: 'This sentence never appears in the paper at all.' }],
    },
  ]);
  assert.equal(out.relations.length, 0);
  assert.equal(out.isolated.length, 1);
  const item = out.isolated[0];
  assert.equal(item.rule, 'evidence-not-found');
  assert.equal(item.paperId, 'p1');
  assert.equal(item.page, 1, '能定位到模型所引页');
  assert.match(item.reason, /找不到连续原文/);
  assert.ok(item.label.includes('→'), '关系描述可读');
});

void test('端点实体未通过原文提及检查时，隔离原因指向端点', () => {
  const out = run([
    {
      source: 'e1',
      target: 'e_missing',
      type: 'uses',
      condition: '端点不存在',
      evidence: [{ blockId: 'p1:b2', quote: 'SceneFun3D' }],
    },
  ]);
  assert.equal(out.isolated.length, 1);
  assert.equal(out.isolated[0].rule, 'endpoint-missing');
  assert.match(out.isolated[0].reason, /端点/);
});

void test('自环关系被隔离并说明原因', () => {
  const out = run([
    {
      source: 'e1',
      target: 'e1',
      type: 'uses',
      condition: '自己使用自己',
      evidence: [{ blockId: 'p1:b1', quote: 'dual-stream architecture' }],
    },
  ]);
  assert.equal(out.isolated.length, 1);
  assert.equal(out.isolated[0].rule, 'self-loop');
});

void test('新关系会带上关系动作复核结果（评估写成 uses 被标为需复核）', () => {
  const out = run([
    {
      source: 'e1',
      target: 'e2',
      type: 'uses',
      condition: 'DualStream 在 SceneFun3D 数据集上进行评估。',
      evidence: [{ blockId: 'p1:b2', quote: 'The system is evaluated on the SceneFun3D dataset.' }],
    },
  ]);
  const relation = out.relations[0];
  assert.equal(relation.type, 'uses', '不改写原始类型');
  assert.equal(relation.typeReview?.status, 'needs-review');
  assert.equal(relation.typeReview?.suggested, 'evaluatedOn');
});

void test('真正表达“方法使用组件”的 uses 不会被误标', () => {
  const out = checkedExtraction(
    graphExtractionSchema.parse({
      entities: [
        entity('e1', 'FoundPose', 'FoundPose', 'FoundPose', 'p1:b4'),
        entity('e2', 'DINOv2', 'DINOv2', 'DINOv2', 'p1:b4'),
      ],
      relations: [
        {
          source: 'e1',
          target: 'e2',
          type: 'uses',
          condition: 'FoundPose使用DINOv2特征进行模板检索。',
          evidence: [{ blockId: 'p1:b4', quote: 'FoundPose retrieves templates using DINOv2 features.' }],
        },
      ],
    }),
    paper,
    blocks,
    paper.hash,
    'run-2',
  );
  assert.equal(out.relations[0].typeReview, undefined);
});

void test('勾选的证据摘录即使位于分栏交错块内也必须是原文子串', () => {
  const interleaved: Block[] = [
    {
      id: 'p1:b9',
      page: 1,
      text: 'Non-black\nOffice\ntrash can\nINHerit-SG, an asynchronous dual-stream architecture that sys-\nnear it\ntematically structures the environment',
    },
  ];
  const out = checkedExtraction(
    graphExtractionSchema.parse({
      entities: [
        {
          ...entity(
            'e1',
            'INHerit-SG',
            'INHerit-SG',
            'INHerit-SG, an asynchronous dual-stream architecture',
            'p1:b9',
          ),
        },
      ],
      relations: [
        {
          source: 'e1',
          target: 'e1',
          type: 'association',
          condition: '自环不应产生证据',
          evidence: [{ blockId: 'p1:b9', quote: 'INHerit-SG, an asynchronous dual-stream architecture' }],
        },
      ],
    }),
    paper,
    interleaved,
    paper.hash,
    'run-3',
  );
  // 自环被隔离，因此不产生关系，也就不会把交错文本写成证据
  assert.equal(out.relations.length, 0);
  assert.equal(out.isolated[0].rule, 'self-loop');
});
