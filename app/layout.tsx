import './globals.css';
import type { Metadata } from 'next';
import { JetBrains_Mono, Orbitron, Chakra_Petch } from 'next/font/google';
import { Analytics } from '@vercel/analytics/react';

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500', '600', '700'],
});

const orbitron = Orbitron({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '500', '600', '700', '800', '900'],
});

const chakraPetch = Chakra_Petch({
  subsets: ['latin'],
  variable: '--font-menu',
  weight: ['400', '500', '600', '700'],
});

const DESCRIPTION =
  'Survive waves of enemies in this neon-soaked arcade shooter, solo or in co-op, and climb the leaderboard. A Neon Bit game.';

export const metadata: Metadata = {
  metadataBase: new URL('https://survivors.neonbit.gg'),
  title: 'Neon Survivors - Arcade Survival Game',
  description: DESCRIPTION,
  keywords: ['Neon Survivors', 'Neon Bit', 'arcade survival', 'bullet heaven', 'co-op', 'indie game'],
  alternates: { canonical: '/' },
  icons: {
    icon: '/icon.png',
    apple: '/apple-icon.png',
  },
  openGraph: {
    title: 'Neon Survivors',
    description: DESCRIPTION,
    siteName: 'Neon Bit',
    url: '/',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Neon Survivors',
    description: DESCRIPTION,
  },
  other: {
    'mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'black-translucent',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover' as const,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${jetbrainsMono.variable} ${orbitron.variable} ${chakraPetch.variable}`}>
      <body className="bg-brutal-black text-white antialiased overflow-x-hidden">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
