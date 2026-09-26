'use client';
import { useEffect, useRef, useState } from 'react';
import { pdfLibrary, pdfAssets } from '@/lib/pdf-client';
import type { Block } from '@/lib/domain';
export default function PdfViewer({
  url,
  page,
  block,
}: {
  url: string;
  page: number;
  block?: Block;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(''),
    [size, setSize] = useState({ width: 600, height: 800, scale: 1 });
  useEffect(() => {
    let cancelled = false;
    let destroy: (() => Promise<void>) | undefined;
    let renderTask: { cancel: () => void; promise: Promise<void> } | undefined;
    void (async () => {
      try {
        setError('');
        const pdf = await pdfLibrary();
        if (cancelled) return;
        const task = pdf.getDocument({
          url,
          useSystemFonts: true,
          ...pdfAssets,
        });
        destroy = () => task.destroy();
        const doc = await task.promise;
        if (cancelled) return;
        const p = await doc.getPage(page);
        const base = p.getViewport({ scale: 1 });
        const width = Math.min(
          1000,
          Math.max(240, (container.current?.clientWidth ?? 650) - 24),
        );
        const scale = width / base.width,
          view = p.getViewport({ scale });
        if (!canvas.current || cancelled) return;
        const ratio = window.devicePixelRatio || 1;
        canvas.current.width = Math.floor(view.width * ratio);
        canvas.current.height = Math.floor(view.height * ratio);
        setSize({ width: view.width, height: view.height, scale });
        renderTask = p.render({
          canvas: canvas.current,
          viewport: view,
          transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
        });
        await renderTask.promise;
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'PDF 预览失败。');
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      void destroy?.();
    };
  }, [url, page]);
  return (
    <div className="pdf-stage" ref={container}>
      {error ? (
        <p className="error-text">{error}。可以使用下方原文文本继续核对。</p>
      ) : (
        <div
          className="pdf-paper"
          style={{ width: size.width, height: size.height }}
        >
          <canvas
            ref={canvas}
            style={{ width: size.width, height: size.height }}
          />
          {block?.rect && block.page === page && (
            <div
              className="pdf-highlight"
              style={{
                left: block.rect[0] * size.scale,
                top: block.rect[1] * size.scale,
                width: (block.rect[2] - block.rect[0]) * size.scale,
                height: (block.rect[3] - block.rect[1]) * size.scale,
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
