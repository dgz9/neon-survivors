import { NextRequest, NextResponse } from 'next/server';
import { neon, NeonQueryFunction } from '@neondatabase/serverless';

// Lazy initialization - only connect when needed
let sql: NeonQueryFunction<false, false> | null = null;

function getDb() {
  if (!sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL not configured');
    }
    sql = neon(process.env.DATABASE_URL);
  }
  return sql;
}

// Initialize table on first request
let tableInitialized = false;

async function initTable() {
  if (tableInitialized) return;
  
  const db = getDb();
  
  await db`
    CREATE TABLE IF NOT EXISTS leaderboard (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      score INTEGER NOT NULL,
      wave INTEGER DEFAULT 1,
      kills INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  
  // Create index for faster sorting
  await db`
    CREATE INDEX IF NOT EXISTS idx_leaderboard_score ON leaderboard(score DESC)
  `;
  
  tableInitialized = true;
}

// Generate unique ID
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export async function GET() {
  try {
    await initTable();
    
    const db = getDb();
    const entries = await db`
      SELECT id, name, score, wave, kills, created_at as timestamp
      FROM leaderboard
      ORDER BY score DESC
      LIMIT 100
    `;

    return NextResponse.json({
      entries: entries.map(e => ({
        ...e,
        timestamp: new Date(e.timestamp).getTime()
      })),
    });
  } catch (error) {
    console.error('Failed to fetch leaderboard:', error);
    return NextResponse.json({ entries: [] });
  }
}

export async function POST(request: NextRequest) {
  try {
    await initTable();
    
    const body = await request.json();
    const { name, score, wave, kills } = body;

    // Validate input
    if (!name || typeof name !== 'string' || name.length > 20) {
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
    }
    if (typeof score !== 'number' || score < 0) {
      return NextResponse.json({ error: 'Invalid score' }, { status: 400 });
    }

    const id = generateId();
    const cleanName = name.trim();
    const finalScore = Math.floor(score);
    const finalWave = wave || 1;
    const finalKills = kills || 0;

    const db = getDb();
    
    // Insert entry
    await db`
      INSERT INTO leaderboard (id, name, score, wave, kills)
      VALUES (${id}, ${cleanName}, ${finalScore}, ${finalWave}, ${finalKills})
    `;

    // Get rank
    const rankResult = await db`
      SELECT COUNT(*) + 1 as rank
      FROM leaderboard
      WHERE score > ${finalScore}
    `;
    
    const rank = rankResult[0]?.rank || 1;

    return NextResponse.json({
      success: true,
      entry: {
        id,
        name: cleanName,
        score: finalScore,
        wave: finalWave,
        kills: finalKills,
        timestamp: Date.now(),
      },
      rank,
    });
  } catch (error) {
    console.error('Failed to submit score:', error);
    return NextResponse.json({ error: 'Failed to submit score' }, { status: 500 });
  }
}
