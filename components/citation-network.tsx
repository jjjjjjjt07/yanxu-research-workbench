'use client';
import type { Project } from '@/lib/domain';
import { Button } from '@/components/ui/button';
import { Badge } from './common';
export function CitationNetwork({
  project,
  onSource,
}: {
  project: Project;
  onSource: (id: string) => void;
}) {
  const papers = project.state.papers;
  const edges = papers.flatMap((source) =>
    (source.metadata?.references ?? []).flatMap((doi) => {
      const target = papers.find(
        (p) => p.id !== source.id && p.metadata?.doi === doi,
      );
      return target ? [{ source, target }] : [];
    }),
  );
  return (
    <div className="citation-network">
      <h3>文献引用网络</h3>
      <p>
        仅根据已获取的 Crossref DOI
        参考文献记录连接本课题文献。引用关系不代表结论支持。
      </p>
      <p>
        {papers.filter((p) => p.metadata).length}/{papers.length} 篇有书目元数据
        · {edges.length} 条课题内引用
      </p>
      {edges.length ? (
        edges.map(({ source, target }) => (
          <article key={source.id + target.id}>
            <Button variant="ghost" onClick={() => onSource(source.id)}>
              {source.title}
            </Button>
            <span>引用 →</span>
            <Button variant="ghost" onClick={() => onSource(target.id)}>
              {target.title}
            </Button>
            <small>来源：Crossref · {source.metadata?.retrievedAt}</small>
          </article>
        ))
      ) : (
        <p className="secondary">
          尚未检索到课题内的 DOI 引用连接；这不代表这些文献之间没有引用。
        </p>
      )}
      <div>
        {papers.map((p) => (
          <details key={p.id}>
            <summary>{p.title}</summary>
            <Badge>{p.metadata ? 'Crossref 元数据' : '缺少 DOI 元数据'}</Badge>
            <p>
              已获取 {(p.metadata?.references ?? []).length} 条含 DOI
              的参考文献。提供方未返回的引用无法显示。
            </p>
            {p.metadata?.references.map((doi) => (
              <a
                key={doi}
                href={'https://doi.org/' + encodeURIComponent(doi)}
                target="_blank"
                rel="noreferrer"
              >
                {doi}
              </a>
            ))}
          </details>
        ))}
      </div>
    </div>
  );
}
