'use client';
import { useState } from 'react';
import { Search, Sparkles, Download, Plus, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label, Badge, request, downloadFile } from './common';
import type { Project } from '@/lib/domain';
import { exportReferences } from '@/lib/scholar';
import { BibliographyImport, BibliographyHistory } from './bibliography-import';
export function ScholarSearch({
  project,
  onProject,
  aiConfigured,
}: {
  project: Project;
  onProject: (p: Project) => void;
  aiConfigured: boolean;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [query, setQuery] = useState(project.question),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [explanation, setExplanation] = useState(''),
    [searchId, setSearchId] = useState(
      project.state.searches?.at(-1)?.id || '',
    );
  const records = project.state.searches || [],
    record = records.find((s) => s.id === searchId),
    works = project.state.papers.flatMap((p) =>
      p.metadata ? [p.metadata] : [],
    );
  async function run(
    label: string,
    action: string,
    body: Record<string, unknown>,
  ) {
    if (busy) return;
    setBusy(label);
    setError('');
    try {
      const result = await request<{
        project?: Project;
        query?: string;
        explanation?: string;
        record?: { id: string };
      }>(`/api/projects/${project.id}/search`, {
        method: 'POST',
        body: JSON.stringify({ action, ...body }),
      });
      if (result.project) onProject(result.project);
      if (result.record) setSearchId(result.record.id);
      if (result.query) {
        setQuery(result.query);
        setExplanation(result.explanation || '');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="panel scholar-search">
      <h2>学术导航</h2>
      <p>
        按 DOI 精确查找，或用可编辑的关键词搜索
        Crossref。检索结果与日期会保存到课题。
      </p>
      <Label title="关键词或 DOI">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={500}
          placeholder="例如：graph neural networks molecular simulation"
        />
      </Label>
      <div className="row">
        <Button
          variant="outline"
          disabled={!!busy}
          onClick={() => setImportOpen(true)}
        >
          导入书目文件
        </Button>
        <Button
          disabled={!!busy || query.trim().length < 2}
          onClick={() => run('检索中', 'search', { query })}
        >
          <Search />
          检索文献
        </Button>
        <Button
          variant="outline"
          disabled={!!busy || !aiConfigured || !query.trim()}
          onClick={() => run('生成英文检索词', 'expand', { query })}
        >
          <Sparkles />
          生成英文检索词
        </Button>
        {(['bibtex', 'ris', 'endnote'] as const).map((format) => (
          <Button
            key={format}
            variant="outline"
            disabled={!works.length}
            onClick={() =>
              downloadFile(
                `课题参考文献.${format === 'bibtex' ? 'bib' : format === 'ris' ? 'ris' : 'xml'}`,
                exportReferences(works, format),
              )
            }
          >
            <Download />
            {format === 'endnote' ? 'EndNote XML' : format.toUpperCase()}
          </Button>
        ))}
      </div>
      {explanation && <p>{explanation}</p>}
      {busy && <output>{busy}…</output>}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {record && (
        <p className="secondary">
          {record.query} · {new Date(record.at).toLocaleString('zh-CN')} · 返回{' '}
          {record.results.length} 条 · 排序来自 Crossref，不代表证据质量
        </p>
      )}
      <div className="scholar-results">
        {record?.results.map((w) => (
          <article key={w.doi}>
            <div className="row">
              <Badge>{w.type}</Badge>
              <Badge>
                {w.abstract ? '摘要可用 · 未获取全文' : '仅书目元数据'}
              </Badge>
            </div>
            <h3>{w.title}</h3>
            <p>
              {w.authors.join('、') || '作者未知'} · {w.year || '年份未知'}
            </p>
            <p>
              {w.source} · DOI {w.doi}
            </p>
            {w.abstract && (
              <details>
                <summary>摘要</summary>
                <p>{w.abstract}</p>
              </details>
            )}
            <div className="row">
              <Button
                variant="outline"
                disabled={!!busy || works.some((x) => x.doi === w.doi)}
                onClick={() =>
                  run('导入文献', 'import', { searchId: record.id, doi: w.doi })
                }
              >
                <Plus />
                {works.some((x) => x.doi === w.doi)
                  ? '已入库'
                  : w.abstract
                    ? '导入摘要并阅读'
                    : '导入书目'}
              </Button>
              <a
                href={`https://doi.org/${encodeURIComponent(w.doi)}`}
                target="_blank"
                rel="noreferrer"
              >
                出版来源 <ExternalLink size={14} />
              </a>
            </div>
          </article>
        ))}
      </div>
      <details>
        <summary>检索历史（{records.length}）</summary>
        {records.toReversed().map((r) => (
          <Button key={r.id} variant="ghost" onClick={() => setSearchId(r.id)}>
            {r.query} · {new Date(r.at).toLocaleDateString('zh-CN')}
          </Button>
        ))}
      </details>
      <BibliographyHistory project={project} />
      {importOpen && (
        <BibliographyImport
          project={project}
          onProject={onProject}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}
