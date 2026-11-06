# Neon Survivors

A Vampire Survivors-style arcade shooter with brutalist neon aesthetics. Now with **co-op multiplayer**!

Play it at [survivors.neonbit.gg](https://survivors.neonbit.gg). It's one of the [Neon Bit](https://neonbit.gg) games.

It used to live at neonbit.gg itself. Browsers keep saved data per address, so the Neon Bit
launcher carries a player's achievements, crystals and upgrades over in its Play link the first
time, and `lib/carry.ts` merges them in here.

## Features

- 🎮 **Solo Mode** - Classic survival gameplay
- 👥 **Co-op Mode** - Team up with a friend using room codes
- 🏆 **Leaderboard** - Compete for high scores (solo & team)
- ⚡ **Multiple Weapons** - Unlock and upgrade weapons as you level up
- 🎨 **4 Arena Styles** - Void, Grid, Cyber, Neon

## Deploy to Vercel

1. **Push to GitHub** (if not already done)

2. **Import to Vercel**
   - Go to [vercel.com/new](https://vercel.com/new)
   - Import your GitHub repo

3. **Add Environment Variables** in Vercel → Settings → Environment Variables:
   - `DATABASE_URL` - Your Neon PostgreSQL connection string

4. **Deploy** - Vercel will build and deploy automatically

## Co-op server

Co-op rooms run on Cloudflare, using [PartyServer](https://github.com/cloudflare/partykit) on
Durable Objects (`party/server.ts`, `wrangler.jsonc`). They moved here when PartyKit's hosted
platform shut down in October 2026.

Cloudflare builds the server from this repo, so pushing to `master` deploys it along with the game.
The project there has to stay named `neon-survivors-party`, the `name` in `wrangler.jsonc`. To deploy
it by hand instead:

```bash
npx wrangler@4 login
npm run party:deploy
```

The game finds the server through `NEXT_PUBLIC_PARTY_HOST` in `.env.production`, which is
committed because the address isn't secret. If the Worker's address ever changes, update it there.
`ORIGINS` at the top of `party/server.ts` lists the sites allowed to connect from a browser.

## Local Development

```bash
# Install dependencies
npm install

# Run the game and the co-op server together
npm run dev:all

# Or run them separately:
npm run dev          # Next.js on :3000
npm run dev:party    # Co-op server on :1999
```

For local testing, `.env.local` should have:
```
DATABASE_URL=your_neon_connection_string
NEXT_PUBLIC_PARTY_HOST=localhost:1999
```

## Tech Stack

- Next.js 14
- TypeScript
- Tailwind CSS
- Canvas API for rendering
- Neon PostgreSQL for leaderboard
- PartyServer on Cloudflare Durable Objects for real-time multiplayer
