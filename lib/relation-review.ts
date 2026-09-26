import type { Entity, Relation, RelationType } from './graph.ts';

/**
 * 关系动作复核。
 *
 * 背景：五篇共 68 条关系的支持检查里，62 条被判为 supported——因为支持检查
 * 只核对「条件句与摘录是否一致」，**完全不看关系类型是否表达了原文的动作**。
 * 结果实测有 15 条把「在 X 数据集上评估」写成了 `uses`（某方法使用 X 数据集）。
 *
 * 这个模块是**确定性**的：只根据关系类型与条件句措辞做判断，
 * 不调用模型、不改写 `type`，只产出「需复核 + 建议类型 + 原因」，
 * 由人工在界面上确认后才迁移。
 */

const EVALUATE = /评估|评测|测评|基准测试|测试集|evaluat|benchmark|test set|experiment/i;
const TRAIN = /训练|微调|train|fine-?tun/i;
const COMPARE = /对比|比较|优于|劣于|高于|低于|outperform|better than|worse than|baseline|相比/i;

const DATASETISH = /dataset|数据集|benchmark|基准|corpus|语料/i;

export type TypeReview =
  | { status: 'ok' }
  | {
      status: 'needs-review';
      suggested?: RelationType;
      reason: string;
    };

/**
 * 复核一条关系是否可以直接采信。两类问题都会标为需复核：
 * 1. 关系类型没有表达原文动作（如把「在某数据集上评估」写成 uses）；
 * 2. 依据本身只被部分支持/无法判定——此时即便类型没错，也不能当已确认事实。
 */
export function reviewRelationType(
  relation: Pick<Relation, 'type' | 'condition'> & { support?: Relation['support'] },
  target?: Pick<Entity, 'type' | 'name'>,
): TypeReview {
  const condition = String(relation.condition ?? '');
  const isDatasetLike = target ? DATASETISH.test(target.name) || target.type === 'data' : false;

  if (relation.type === 'uses' || relation.type === 'depends') {
    if (TRAIN.test(condition))
      return {
        status: 'needs-review',
        suggested: 'trainedOn',
        reason: `关系类型是「${relation.type}」，但条件句描述的是「训练」（${summarize(condition)}）。${
          isDatasetLike ? '对象又像数据集/数据实体，' : ''
        }按要求应区分为「在…上训练」。`,
      };
    if (EVALUATE.test(condition))
      return {
        status: 'needs-review',
        suggested: 'evaluatedOn',
        reason: `关系类型是「${relation.type}」，但条件句描述的是「评估」（${summarize(condition)}）。${
          isDatasetLike ? '对象又像数据集/基准，' : ''
        }把「在某数据集上评测」写成「使用该数据集」会误导跨文献推理。`,
      };
    if (COMPARE.test(condition))
      return {
        status: 'needs-review',
        suggested: 'compares',
        reason: `关系类型是「${relation.type}」，但条件句描述的是「对比/优劣」（${summarize(condition)}）。`,
      };
  }
  if (relation.support && relation.support !== 'supported')
    return {
      status: 'needs-review',
      reason: `依据判定为「${relation.support}」，不能当作已确认事实，需人工核对原文是否真的支持该关系。`,
    };
  return { status: 'ok' };
}

function summarize(text: string) {
  const trimmed = String(text).replace(/\s+/g, ' ').trim();
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
}

/**
 * 对一批关系做复核。**只读**——返回建议，不改动传入的 relation。
 * 迁移时把结果写入 `relation.typeReview`，`type` 原样保留。
 */
export function reviewRelations(
  relations: Relation[],
  entities: Entity[],
  _at: string,
): { relationId: string; review: TypeReview }[] {
  const byId = new Map(entities.map((e) => [e.id, e]));
  return relations.map((r) => ({
    relationId: r.id,
    review: reviewRelationType(r, byId.get(r.target)),
  }));
}
