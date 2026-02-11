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

export const metadata: Metadata = {
  title: 'Neon Survivors - Arcade Survival Game',
  description: 'Survive waves of enemies in this neon-soaked arcade shooter. Climb the leaderboard!',
  openGraph: {
    title: 'Neon Survivors',
    description: 'Survive waves of enemies in this neon-soaked arcade shooter.',
    type: 'website',
  },
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
