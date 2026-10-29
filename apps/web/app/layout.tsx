import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

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

export const viewport: Viewport = { themeColor: '#4f46e5' };

/** Applies the saved theme before the first paint, so a dark-theme visitor never sees a white flash. */
const THEME_SCRIPT = `try{var t=localStorage.getItem('jp-theme');if(t==='dark'||(t===null&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
