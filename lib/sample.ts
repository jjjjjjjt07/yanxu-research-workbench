import {
  emptyState,
  now,
  uid,
  checkedValue,
  applyExtraction,
  logActivity,
  type Block,
  type ProjectState,
} from './domain';

export function createSample(): {
  state: ProjectState;
  documents: { paperId: string; blocks: Block[]; text: string }[];
} {
  const state = emptyState();
  const documents: { paperId: string; blocks: Block[]; text: string }[] = [];
  const examples = [
    {
      title: '示例 A · 轻量视觉分类方法',
      method: 'LiteVision',
      dataset: 'Demo-Images',
      size: '1200',
      score: '89.8%',
      device: '普通 CPU',
    },
    {
      title: '示例 B · 蒸馏分类方法',
      method: 'CompactKD',
      dataset: 'Demo-Images',
      size: '1200',
      score: '91.2%',
      device: '单张 GPU',
    },
    {
      title: '示例 C · 小样本迁移方法',
      method: 'FewTransfer',
      dataset: 'Demo-Small',
      size: '300',
      score: '86.4%',
      device: '未报告',
    },
  ];
  for (const e of examples) {
    const id = uid();
    const contents = [
      `演示材料，所有研究名称与数值均为虚构，不能用于学术引用。\n${e.title}`,
      `研究方法：本文评估 ${e.method}。测试数据集为 ${e.dataset}。`,
      `数据划分：训练集包含 4800 张图像，独立测试集包含 ${e.size} 张图像。`,
      `实验结果：${e.method} 在 ${e.dataset} 的准确率为 ${e.score}。`,
      `实验条件：${e.device === '未报告' ? '本文没有提供设备信息。' : `实验在${e.device}上执行。`}`,
    ];
    const blocks = contents.map((text, i) => ({
      id: `${id}:b${i}`,
      page: 1,
      text,
    }));
    state.papers.push({
      id,
      title: e.title,
      filename: e.title + '.txt',
      pages: 1,
      hash: 'sample-' + id,
      kind: 'text',
      sample: true,
      blockCount: blocks.length,
      importedAt: now(),
    });
    const vals = [
      e.method,
      e.dataset,
      e.size,
      `${e.score}（${e.dataset} / accuracy）`,
      e.device === '未报告' ? '' : e.device,
    ];
    state.fields.forEach((f, i) => {
      const b = blocks[[1, 1, 2, 3, 4][i]];
      applyExtraction(
        state,
        id,
        f.id,
        checkedValue(
          {
            value: vals[i],
            blockId: vals[i] ? b.id : '',
            quote: vals[i] ? b.text : '',
            note: '内置虚构演示数据，非模型提取。',
          },
          blocks,
          f,
          0,
          'sample',
        ),
      );
    });
    documents.push({ paperId: id, blocks, text: contents.join('\n\n') });
  }
  logActivity(state, '载入虚构演示课题，可体验核对与修改。');
  return { state, documents };
}
