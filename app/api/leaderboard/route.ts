import { NextRequest, NextResponse } from 'next/server';

// In-memory leaderboard (in production, use a database)
// This will reset on server restart
let leaderboard: {
  id: string;
  name: string;
  score: number;
  wave: number;
  kills: number;
  timestamp: number;
}[] = [];

// Generate unique ID
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export async function GET() {
  // Sort by score descending
  const sortedLeaderboard = [...leaderboard].sort((a, b) => b.score - a.score);
  
  return NextResponse.json({
    entries: sortedLeaderboard.slice(0, 100), // Top 100
  });
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
    const entry = {
      id: generateId(),
      name: name.trim(),
      score: Math.floor(score),
      wave: wave || 1,
      kills: kills || 0,
      timestamp: Date.now(),
    };

    // Add to leaderboard
    leaderboard.push(entry);

    // Keep only top 1000 entries to prevent memory bloat
    if (leaderboard.length > 1000) {
      leaderboard.sort((a, b) => b.score - a.score);
      leaderboard = leaderboard.slice(0, 1000);
    }

    // Calculate rank
    const sortedLeaderboard = [...leaderboard].sort((a, b) => b.score - a.score);
    const rank = sortedLeaderboard.findIndex(e => e.id === entry.id) + 1;

    return NextResponse.json({
      success: true,
      entry,
      rank,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to submit score' }, { status: 500 });
  }
}
