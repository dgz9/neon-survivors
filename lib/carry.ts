// Brings saved progress over from neonbit.gg.
//
// Neon Survivors used to live at neonbit.gg, and browsers keep saved data per address, so a
// player's achievements, crystals and upgrades stayed behind when the game moved to
// survivors.neonbit.gg. The Neon Bit launcher (now at neonbit.gg) reads that data and adds it
// to its Play link as #carry=<base64url JSON>. This reads it back once, merges it in without
// ever losing progress made here, and removes it from the address bar.

const ACHIEVEMENTS_KEY = 'neon-bit-achievements';
const LEGACY_ACHIEVEMENTS_KEY = 'neon-survivors-achievements';
const META_KEY = 'neon-bit-meta-progression';
const MUTE_KEY = 'neon-survivors-muted';

type Carried = Partial<Record<string, string>>;

function decode(value: string): Carried | null {
  try {
    const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(atob(b64)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out: Carried = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v.length < 20000) out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

function stringList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function crystalsEarned(raw: string | null | undefined): number {
  if (!raw) return -1;
  try {
    const parsed = JSON.parse(raw) as { totalCrystalsEarned?: unknown };
    return typeof parsed.totalCrystalsEarned === 'number' ? parsed.totalCrystalsEarned : 0;
  } catch {
    return -1;
  }
}

export function importCarriedProgress(): void {
  if (typeof window === 'undefined') return;
  const match = window.location.hash.match(/(?:^#|&)carry=([A-Za-z0-9_-]+)/);
  if (!match) return;

  try {
    const carried = decode(match[1]);
    if (carried) {
      const store = window.localStorage;

      // Achievements: keep everything unlocked in either place.
      const unlocked = new Set([
        ...stringList(store.getItem(ACHIEVEMENTS_KEY)),
        ...stringList(carried[ACHIEVEMENTS_KEY]),
        ...stringList(carried[LEGACY_ACHIEVEMENTS_KEY]),
      ]);
      if (unlocked.size) store.setItem(ACHIEVEMENTS_KEY, JSON.stringify(Array.from(unlocked)));

      // Crystals and upgrades: keep whichever save has earned more. Adding the two together
      // could hand out crystals twice.
      const carriedMeta = carried[META_KEY];
      if (carriedMeta && crystalsEarned(carriedMeta) > crystalsEarned(store.getItem(META_KEY))) {
        store.setItem(META_KEY, carriedMeta);
      }

      // Sound: only if it hasn't been set here yet.
      const carriedMute = carried[MUTE_KEY];
      if ((carriedMute === 'true' || carriedMute === 'false') && store.getItem(MUTE_KEY) === null) {
        store.setItem(MUTE_KEY, carriedMute);
      }
    }
  } catch {
    // Storage blocked or full: play on without the old progress.
  }

  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, '', pathname + search);
}
