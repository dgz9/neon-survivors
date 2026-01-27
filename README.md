# Neon Survivors

A Vampire Survivors-style arcade shooter with brutalist neon aesthetics. Now with **co-op multiplayer**!

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
   - `NEXT_PUBLIC_PARTYKIT_HOST` - Your PartyKit deployment URL (see below)

4. **Deploy** - Vercel will build and deploy automatically

## PartyKit Setup (for Co-op)

Co-op multiplayer requires a PartyKit server:

1. **Deploy PartyKit**
   ```bash
   npx partykit login
   npm run party:deploy
   ```

2. **Update Environment**
   - Set `NEXT_PUBLIC_PARTYKIT_HOST` to your PartyKit URL (e.g., `neon-survivors.username.partykit.dev`)

## Local Development

```bash
# Install dependencies
npm install

# Run both Next.js and PartyKit dev servers
npm run dev:all

# Or run them separately:
npm run dev          # Next.js on :3000
npm run dev:party    # PartyKit on :1999
```

For local testing, `.env.local` should have:
```
DATABASE_URL=your_neon_connection_string
NEXT_PUBLIC_PARTYKIT_HOST=localhost:1999
```

## Tech Stack

- Next.js 14
- TypeScript
- Tailwind CSS
- Canvas API for rendering
- Neon PostgreSQL for leaderboard
- PartyKit for real-time multiplayer
