import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NYC Solar Roof 3D',
  description: '在纽约真实三维屋顶上探索光伏板布局和太阳能潜力。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
