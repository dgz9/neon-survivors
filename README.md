# Neon Survivors

A Vampire Survivors-style arcade shooter with brutalist neon aesthetics.

## Deploy to Vercel

1. **Push to GitHub** (if not already done)

2. **Import to Vercel**
   - Go to [vercel.com/new](https://vercel.com/new)
   - Import your GitHub repo

3. **Set up Vercel KV** (for leaderboard persistence)
   - Go to your Vercel project dashboard
   - Click **Storage** tab
   - Click **Create Database** → **KV**
   - Name it (e.g., `neon-survivors-leaderboard`)
   - Click **Connect** to link it to your project
   
   The environment variables (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) are auto-configured!

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
- Vercel KV (Redis) for leaderboard
