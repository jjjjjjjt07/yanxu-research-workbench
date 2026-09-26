'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Modal, Label, Picker, Badge, request, downloadFile } from './common';
import type { Project } from '@/lib/domain';
import type { BibliographyEntry, BibliographyFormat } from '@/lib/bibliography';
type Preview = { hash: string; revision: number; entries: BibliographyEntry[] };
export function BibliographyImport({
  project,
  onProject,
  onClose,
}: {
  project: Project;
  onProject: (p: Project) => void;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<BibliographyFormat>('bibtex'),
    [filename, setFilename] = useState('references.bib'),
    [text, setText] = useState(''),
    [preview, setPreview] = useState<Preview | null>(null),
    [selected, setSelected] = useState<number[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const stale = !!preview && preview.revision !== project.revision;
  const reset = () => {
    setPreview(null);
    setSelected([]);
    setError('');
    setNotice('');
  };
  async function run(action: 'preview' | 'import') {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await request<Preview & { project?: Project }>(
        `/api/projects/${project.id}/bibliography`,
        {
          method: 'POST',
          body: JSON.stringify({
            action,
            format,
            filename,
            text,
            revision:
              action === 'import' ? preview?.revision : project.revision,
            hash: preview?.hash,
            selected,
          }),
        },
      );
      if (result.project) {
        onProject(result.project);
        setPreview(null);
        setSelected([]);
        setNotice(
          `已导入 ${selected.length} 条；可在文献阅读中查看材料，或为有摘要的条目构图。`,
        );
      } else {
        setPreview(result);
        setSelected([]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="导入书目文件"
      description="支持 UTF-8 的 BibTeX、RIS 和 EndNote XML。条目内容未在线核验；先预览再选择入库，附件链接不会自动下载。"
      wide
    >
      <Label title="选择文件">
        <Input
          type="file"
          accept=".bib,.ris,.xml,.txt"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            reset();
            if (file.size > 500000) {
              setError('书目文件最大500KB，请分批导入。');
              return;
            }
            setBusy(true);
            try {
              const content = new TextDecoder('utf-8', {
                fatal: true,
                ignoreBOM: true,
              }).decode(await file.arrayBuffer());
              setText(content);
              setFilename(file.name);
              setFormat(
                file.name.toLowerCase().endsWith('.ris')
                  ? 'ris'
                  : file.name.toLowerCase().endsWith('.xml')
                    ? 'endnote'
                    : 'bibtex',
              );
            } catch {
              setError('无法按 UTF-8 读取，请使用 UTF-8 编码重新导出。');
            } finally {
              setBusy(false);
            }
          }}
        />
      </Label>
      <Label title="书目格式">
        <Picker
          disabled={busy}
          label="选择书目格式"
          value={format}
          onChange={(value) => {
            reset();
            setFormat(value as BibliographyFormat);
          }}
          options={[
            { value: 'bibtex', label: 'BibTeX' },
            { value: 'ris', label: 'RIS' },
            { value: 'endnote', label: 'EndNote XML' },
          ]}
        />
      </Label>
      <Label title="文件名">
        <Input
          value={filename}
          disabled={busy}
          maxLength={200}
          onChange={(e) => {
            reset();
            setFilename(e.target.value);
          }}
        />
      </Label>
      <Label
        title="书目文本"
        hint="也可直接粘贴导出内容；最多200条预览，每课题最多20篇文献。"
      >
        <Textarea
          value={text}
          disabled={busy}
          rows={5}
          onChange={(e) => {
            reset();
            setText(e.target.value);
          }}
        />
      </Label>
      <Button
        disabled={busy || !text.trim() || !filename.trim()}
        onClick={() => run('preview')}
      >
        {busy ? '处理中…' : '预览并检查重复'}
      </Button>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {notice && <output>{notice}</output>}
      {preview && (
        <>
          <p>
            识别 {preview.entries.length} 条 · 已选 {selected.length} 条 ·
            课题剩余 {Math.max(0, 20 - project.state.papers.length)} 个位置
          </p>
          {stale && (
            <p className="error-text">
              课题已更新，请重新预览。旧预览不能提交。
            </p>
          )}
          <div className="bibliography-entries">
            {preview.entries.map((entry) => (
              <article className="bibliography-entry" key={entry.index}>
                <label className="row">
                  <Checkbox
                    checked={selected.includes(entry.index)}
                    disabled={
                      busy || stale || !!entry.error || !!entry.duplicate
                    }
                    onCheckedChange={(checked) =>
                      setSelected((ids) =>
                        checked
                          ? [...ids, entry.index]
                          : ids.filter((i) => i !== entry.index),
                      )
                    }
                  />
                  <strong>
                    第{entry.index + 1}条 · {entry.work.title || '缺少标题'}
                  </strong>
                </label>
                <p>
                  {entry.work.authors.join('、') || '作者未知'} ·{' '}
                  {entry.work.year || '年份未知'} ·{' '}
                  {entry.work.source || '出版来源未知'}
                </p>
                <p>DOI：{entry.work.doi || '未知'}</p>
                <Badge>
                  {entry.work.abstract ? '含摘要，未获取全文' : '仅书目元数据'}
                </Badge>
                {entry.work.abstract && (
                  <details>
                    <summary>核对摘要</summary>
                    <p>{entry.work.abstract}</p>
                  </details>
                )}
                {entry.error && <p className="error-text">{entry.error}</p>}
                {entry.duplicate && (
                  <p className="error-text">{entry.duplicate}</p>
                )}
                {!!entry.warnings.length && (
                  <p className="secondary">{entry.warnings.join('；')}</p>
                )}
              </article>
            ))}
          </div>
          <Button
            disabled={
              busy ||
              stale ||
              !selected.length ||
              selected.length > 20 - project.state.papers.length
            }
            onClick={() => run('import')}
          >
            导入所选 {selected.length} 条
          </Button>
        </>
      )}
    </Modal>
  );
}

export function BibliographyHistory({ project }: { project: Project }) {
  const [error, setError] = useState('');
  return (
    <details>
      <summary>
        书目文件导入记录（{project.state.bibliographyImports?.length ?? 0}）
      </summary>
      {error && <p className="error-text">{error}</p>}
      {project.state.bibliographyImports?.toReversed().map((r) => (
        <article className="bibliography-entry" key={r.id}>
          <strong>{r.filename}</strong>
          <p>
            {new Date(r.at).toLocaleString('zh-CN')} · 导入第{' '}
            {r.entries.join('、')} 条
          </p>
          <p className="secondary bibliography-hash">SHA-256：{r.hash}</p>
          <Button
            variant="outline"
            onClick={async () => {
              setError('');
              try {
                const response = await fetch(
                  `/api/projects/${project.id}/bibliography?id=${encodeURIComponent(r.id)}`,
                );
                if (!response.ok) throw new Error('无法取得原始书目文件。');
                downloadFile(r.filename, await response.text());
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            下载原始书目文本
          </Button>
        </article>
      ))}
    </details>
  );
}
