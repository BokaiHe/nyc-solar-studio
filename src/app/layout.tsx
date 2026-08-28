import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NYC Solar Studio',
  description: '在纽约卫星屋顶上设计光伏方案并分析太阳能潜力。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
