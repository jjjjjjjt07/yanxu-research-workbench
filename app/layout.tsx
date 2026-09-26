import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '研序 · 科研工作台',
  description: '整理文献证据，核对研究数据，追踪每一次论文修改。',
  icons: { icon: '/favicon.svg' },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
