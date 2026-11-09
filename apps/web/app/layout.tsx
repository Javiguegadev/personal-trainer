import type { Metadata } from 'next';
import { defaultLocale, messages } from '@pt/i18n';
import './globals.css';

const t = messages[defaultLocale];

export const metadata: Metadata = {
  title: t.app.name,
  description: t.app.tagline,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={defaultLocale}>
      <body className="min-h-dvh bg-neutral-50 text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
