import './globals.css';
import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/react';

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
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Orbitron:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-brutal-black text-white antialiased overflow-x-hidden">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
