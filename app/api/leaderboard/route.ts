import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

const LEADERBOARD_KEY = 'neon-survivors:leaderboard';
const MAX_ENTRIES = 100;

interface LeaderboardEntry {
  id: string;
  name: string;
  score: number;
  wave: number;
  kills: number;
  timestamp: number;
}

// Generate unique ID
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export async function GET() {
  try {
    // Get leaderboard from KV store
    const entries = await kv.zrange<LeaderboardEntry[]>(
      LEADERBOARD_KEY, 
      0, 
      MAX_ENTRIES - 1, 
      { rev: true }
    );

    return NextResponse.json({
      entries: entries || [],
    });
  } catch (error) {
    console.error('Failed to fetch leaderboard:', error);
    // Return empty array on error (e.g., KV not configured)
    return NextResponse.json({ entries: [] });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, score, wave, kills } = body;

    // Validate input
    if (!name || typeof name !== 'string' || name.length > 20) {
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
    }
    if (typeof score !== 'number' || score < 0) {
      return NextResponse.json({ error: 'Invalid score' }, { status: 400 });
    }

    // Create entry
    const entry: LeaderboardEntry = {
      id: generateId(),
      name: name.trim(),
      score: Math.floor(score),
      wave: wave || 1,
      kills: kills || 0,
      timestamp: Date.now(),
    };

    // Add to sorted set (score is used for sorting)
    await kv.zadd(LEADERBOARD_KEY, {
      score: entry.score,
      member: JSON.stringify(entry),
    });

    // Trim to keep only top entries
    const count = await kv.zcard(LEADERBOARD_KEY);
    if (count > MAX_ENTRIES * 2) {
      // Remove lowest scores
      await kv.zremrangebyrank(LEADERBOARD_KEY, 0, count - MAX_ENTRIES - 1);
    }

    // Calculate rank
    const rank = await kv.zrevrank(LEADERBOARD_KEY, JSON.stringify(entry));

    return NextResponse.json({
      success: true,
      entry,
      rank: rank !== null ? rank + 1 : null,
    });
  } catch (error) {
    console.error('Failed to submit score:', error);
    return NextResponse.json({ error: 'Failed to submit score' }, { status: 500 });
  }
}
