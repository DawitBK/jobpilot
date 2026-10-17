import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

const SITE_URL = process.env.SITE_URL ?? 'http://localhost:3031';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'JobPilot: a job search that never applies without you',
    template: '%s · JobPilot',
  },
  description:
    'Find jobs from the sources you trust, see an explained match score for each, and move every application through a clear pipeline. Nothing is sent until you approve it.',
  openGraph: { type: 'website', siteName: 'JobPilot' },
};

export const viewport: Viewport = { themeColor: '#2f56c9' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
