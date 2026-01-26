# Neon Survivors

A Vampire Survivors-style arcade shooter with brutalist neon aesthetics.

## Deploy to Vercel

1. **Push to GitHub** (if not already done)

2. **Import to Vercel**
   - Go to [vercel.com/new](https://vercel.com/new)
   - Import your GitHub repo

3. **Add DATABASE_URL** (for leaderboard persistence)
   - Go to your Vercel project → **Settings** → **Environment Variables**
   - Add `DATABASE_URL` with your Neon PostgreSQL connection string
   - The table is auto-created on first request

4. **Deploy** - Vercel will build and deploy automatically

## Local Development

```bash
npm install
npm run dev
```

For local leaderboard testing, the API will return empty results if KV isn't configured.

## Tech Stack

- Next.js 14
- TypeScript
- Tailwind CSS
- Canvas API for rendering
- Neon PostgreSQL for leaderboard
