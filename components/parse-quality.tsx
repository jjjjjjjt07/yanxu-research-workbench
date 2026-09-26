'use client';
import type { Block, Paper } from '@/lib/domain';
import { pageQuality, qualityIssueLabels } from '@/lib/pdf-layout';
import { Button } from './ui/button';

export function ParsingQuality({
  paper,
  blocks,
  onPage,
}: {
  paper: Paper;
  blocks: Block[];
  onPage: (page: number) => void;
}) {
  if (paper.kind !== 'pdf') return null;
  const pages = paper.parsing?.pages ?? pageQuality(blocks, paper.pages);
  const flagged = pages.filter((p) => p.issues.length),
    columns = pages.filter((p) => p.layout === 'two-column');
  return (
    <details className="parsing-quality">
      <summary>
        解析质量 ·{' '}
        {flagged.length ? `${flagged.length} 页需核对` : '未发现基础文字异常'} ·{' '}
        {columns.length} 页按双栏排序
      </summary>
      <p className="secondary">
        检查文字数量、乱码替代符和阅读顺序，不代表全文完整。表格、公式与复杂排版仍需对照原文件。
        {blocks.some((b) => b.ocr)
          ? '已接纳的OCR页面会单独标记，仍需核对。'
          : '当前解析未包含OCR转录。'}
      </p>
      {!paper.parsing && (
        <p className="secondary">
          旧文献仅检查已保存文本，尚未使用新版分栏解析。
        </p>
      )}
      <div className="parsing-page-list">
        {pages.map((p) => (
          <div key={p.page}>
            <Button variant="outline" size="sm" onClick={() => onPage(p.page)}>
              查看第 {p.page} 页
            </Button>
            <span>
              {p.characters} 字符 · {p.blocks} 个片段
              {p.layout === 'two-column' ? ' · 双栏顺序待核对' : ''}
              {p.issues.map((issue) => (
                <span className="error-text" key={issue}>
                  ；{qualityIssueLabels[issue]}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
      {paper.parsing && (
        <details>
          <summary>解析记录</summary>
          <p className="secondary">解析器：{paper.parsing.engine}</p>
          <p className="parse-hash">文本 SHA-256：{paper.parsing.hash}</p>
        </details>
      )}
    </details>
  );
}
