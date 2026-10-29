import type { Metadata } from 'next';
import './globals.css';
import { I18nProvider } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'NYC Solar Studio',
  description: 'Design rooftop solar on NYC satellite imagery and estimate its potential.',
  // The app has its own English / Chinese switch; keep browser translation out of the way.
  other: { google: 'notranslate' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" translate="no">
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
