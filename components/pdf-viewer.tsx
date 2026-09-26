'use client';
import type { Block } from '@/lib/domain';

export default function PdfViewer({ url, page }: { url: string; page: number; block?: Block }) {
  const source = `${url}#page=${page}`;
  return (
    <div className="pdf-stage">
      <div className="pdf-native">
        <iframe key={source} title={`论文原文第 ${page} 页`} src={source} />
        <a href={source} target="_blank" rel="noreferrer">
          在新窗口打开论文原文
        </a>
      </div>
    </div>
  );
}
