import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'brutal-black': '#0a0a0a',
        'brutal-dark': '#141414',
        'brutal-charcoal': '#1a1a1a',
        'electric-yellow': '#e4ff1a',
        'electric-pink': '#ff2d6a',
        'electric-cyan': '#00f0ff',
        'electric-green': '#39ff14',
        'electric-purple': '#bf5fff',
        'electric-orange': '#ff6b1a',
      },
      fontFamily: {
        display: ['Orbitron', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'float': 'float 2s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
