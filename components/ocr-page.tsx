'use client';
import { useState } from 'react';
import type { Paper, Project } from '@/lib/domain';
import type { OcrPreview } from '@/lib/ocr';
import { renderOcrPage } from '@/lib/pdf-client';
import { Modal, Label, request } from './common';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
export function OcrPage({
  project,
  paper,
  page,
  onProject,
  onClose,
}: {
  project: Project;
  paper: Paper;
  page: number;
  onProject: (p: Project) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<OcrPreview | null>(null),
    [error, setError] = useState(''),
    [reason, setReason] = useState(''),
    [stage, setStage] = useState('');
  const root = `/api/projects/${project.id}/papers/${paper.id}`;
  async function recognize() {
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      const snapshot = await request<{ hash: string; revision: number }>(
        root + '/parsing',
      );
      if (snapshot.revision !== project.revision)
        throw new Error('课题已更新，请关闭窗口后刷新。');
      setStage('正在准备本页图片…');
      const image = await renderOcrPage(root + '?raw=1', page);
      setStage('模型正在识别本页，通常需要数十秒…');
      setPreview(
        await request<OcrPreview>(root + '/ocr', {
          method: 'POST',
          body: JSON.stringify({
            page,
            image,
            hash: snapshot.hash,
            revision: snapshot.revision,
          }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setStage('');
    }
  }
  async function accept() {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      const result = await request<{ project: Project }>(root + '/parsing', {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'acceptOcr',
          previewId: preview.id,
          revision: preview.revision,
          hash: preview.parseHash,
          reason,
        }),
      });
      onProject(result.project);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={`识别第 ${page} 页（OCR）`}
      description={paper.title}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="secondary">
        将这一页图片发送至已配置的 DeepSeek V4.1
        Flash。识别可能遗漏或误认文字、表格和公式，位置框为近似结果；请对照阅读页原图核对。保存后只替换本页解析，保留旧版本，相关来源待复查。
      </p>
      <a href={root + '?raw=1#page=' + page} target="_blank" rel="noreferrer">
        打开原始 PDF 对照本页（保留当前候选）
      </a>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {busy && <output>{stage || '正在保存解析版本…'}</output>}
      <Button disabled={busy} onClick={recognize}>
        {preview ? '重新识别这一页' : '生成本页识别候选'}
      </Button>
      {preview && (
        <>
          <p>
            {preview.blocks.length} 个候选片段 · {preview.model}
          </p>
          {preview.warnings.map((w, i) => (
            <p className="error-text" key={i}>
              {w}
            </p>
          ))}
          {!preview.blocks.length && (
            <p>没有可保存的文字，请核对图片清晰度；原解析未改变。</p>
          )}
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {preview.blocks.map((b, i) => (
              <p
                key={b.id}
                style={{ whiteSpace: 'pre-wrap', margin: '12px 0' }}
              >
                §{i + 1} · {b.text}
              </p>
            ))}
          </div>
          <Label title="核对说明">
            <Textarea
              aria-label="OCR核对说明"
              disabled={busy}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1200}
            />
          </Label>
          <Button
            disabled={
              busy ||
              !preview.blocks.length ||
              !reason.trim() ||
              preview.revision !== project.revision
            }
            onClick={accept}
          >
            核对后替换本页解析
          </Button>
          <p className="secondary">
            如有错误，可关闭保留原解析；接纳后也可在「解析纠错 /
            版本」中继续修正或恢复。
          </p>
        </>
      )}
    </Modal>
  );
}
