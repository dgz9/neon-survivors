import { Particle, Projectile, ExperienceOrb } from '@/types/game';

export class ObjectPool<T extends { _active: boolean; _poolIndex: number }> {
  items: T[];
  activeCount: number;
  private factory: () => T;
  private resetFn: (item: T) => void;

  constructor(capacity: number, factory: () => T, resetFn: (item: T) => void) {
    this.items = [];
    this.activeCount = 0;
    this.factory = factory;
    this.resetFn = resetFn;

    for (let i = 0; i < capacity; i++) {
      const item = factory();
      item._active = false;
      item._poolIndex = i;
      this.items.push(item);
    }
  }

  acquire(): T {
    if (this.activeCount >= this.items.length) {
      const growBy = Math.max(1, Math.floor(this.items.length * 0.5));
      for (let i = 0; i < growBy; i++) {
        const item = this.factory();
        item._active = false;
        item._poolIndex = this.items.length;
        this.items.push(item);
      }
    }

    const item = this.items[this.activeCount];
    this.resetFn(item);
    item._active = true;
    item._poolIndex = this.activeCount;
    this.activeCount++;
    return item;
  }

  release(item: T): void {
    if (!item._active) return;

    const index = item._poolIndex;
    const lastIndex = this.activeCount - 1;

    if (index !== lastIndex) {
      const lastItem = this.items[lastIndex];
      this.items[index] = lastItem;
      this.items[lastIndex] = item;
      lastItem._poolIndex = index;
      item._poolIndex = lastIndex;
    }

    item._active = false;
    this.activeCount--;
  }

  /** Iterate active items in reverse. Return false from cb to release the item. */
  forEach(cb: (item: T) => boolean | void): void {
    for (let i = this.activeCount - 1; i >= 0; i--) {
      const result = cb(this.items[i]);
      if (result === false) {
        this.release(this.items[i]);
      }
    }
  }

  clear(): void {
    for (let i = 0; i < this.activeCount; i++) {
      this.items[i]._active = false;
    }
    this.activeCount = 0;
  }
}

export function createParticlePool(capacity = 800) {
  return new ObjectPool<Particle>(
    capacity,
    () => ({
      _active: false,
      _poolIndex: 0,
      id: '',
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      color: '',
      size: 0,
      life: 0,
      maxLife: 0,
      type: 'explosion' as const,
      text: undefined,
    }),
    (p) => {
      p.id = '';
      p.position.x = 0;
      p.position.y = 0;
      p.velocity.x = 0;
      p.velocity.y = 0;
      p.color = '';
      p.size = 0;
      p.life = 0;
      p.maxLife = 0;
      p.type = 'explosion';
      p.text = undefined;
    }
  );
}

export function createProjectilePool(capacity = 200) {
  return new ObjectPool<Projectile>(
    capacity,
    () => ({
      _active: false,
      _poolIndex: 0,
      id: '',
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      radius: 0,
      color: '',
      damage: 0,
      isEnemy: false,
      piercing: 0,
      hitEnemies: new Set<string>(),
      orbit: undefined,
      lifetime: undefined,
      weaponType: undefined,
      explosionRadius: undefined,
    }),
    (p) => {
      p.id = '';
      p.position.x = 0;
      p.position.y = 0;
      p.velocity.x = 0;
      p.velocity.y = 0;
      p.radius = 0;
      p.color = '';
      p.damage = 0;
      p.isEnemy = false;
      p.piercing = 0;
      p.hitEnemies.clear();
      p.orbit = undefined;
      p.lifetime = undefined;
      p.weaponType = undefined;
      p.explosionRadius = undefined;
    }
  );
}

export function createXPOrbPool(capacity = 150) {
  return new ObjectPool<ExperienceOrb>(
    capacity,
    () => ({
      _active: false,
      _poolIndex: 0,
      id: '',
      position: { x: 0, y: 0 },
      value: 0,
      createdAt: 0,
    }),
    (o) => {
      o.id = '';
      o.position.x = 0;
      o.position.y = 0;
      o.value = 0;
      o.createdAt = 0;
    }
  );
}
