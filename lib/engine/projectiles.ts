import { Projectile, Vector2 } from '@/types/game';

export function updateProjectileInPlace(projectile: Projectile, deltaTime: number, playerPos: Vector2): void {
  if (projectile.orbit) {
    projectile.orbit.angle += projectile.orbit.speed * deltaTime;
    projectile.position.x = playerPos.x + Math.cos(projectile.orbit.angle) * projectile.orbit.radius;
    projectile.position.y = playerPos.y + Math.sin(projectile.orbit.angle) * projectile.orbit.radius;
    projectile.orbit.owner = playerPos;
    projectile.lifetime = (projectile.lifetime || 3000) - deltaTime * 16;
    return;
  }

  projectile.position.x += projectile.velocity.x * deltaTime;
  projectile.position.y += projectile.velocity.y * deltaTime;
}

export function isProjectileAlive(projectile: Projectile, width: number, height: number): boolean {
  if (projectile.orbit) {
    return (projectile.lifetime || 0) > 0;
  }

  const { x, y } = projectile.position;
  const margin = 50;
  return x > -margin && x < width + margin && y > -margin && y < height + margin;
}
