/**
 * Mapping between world units and the pixels on this client's canvas.
 *
 * Solo, the world is simply sized to the arena box, so the mapping is a plain
 * zoom. Co-op cannot do that: the host owns the world's dimensions and the
 * guest may be holding a phone while the host is at a desktop. The guest
 * therefore fits the *host's* world into its own canvas and centres it, which
 * is what keeps both players looking at the same arena.
 */
export interface ViewTransform {
  /** CSS pixels per world unit. */
  scale: number;
  /** CSS-pixel offset of the world's top-left corner within the canvas. */
  offsetX: number;
  offsetY: number;
  /** World size, in world units. */
  worldWidth: number;
  worldHeight: number;
}

export function createViewTransform(): ViewTransform {
  return { scale: 1, offsetX: 0, offsetY: 0, worldWidth: 1, worldHeight: 1 };
}

/**
 * Fits `worldWidth` x `worldHeight` world units inside a canvas measured in CSS
 * pixels, letterboxing whichever axis has room to spare. Mutates `out` rather
 * than allocating — this runs every frame.
 */
export function fitViewTransform(
  out: ViewTransform,
  canvasWidth: number,
  canvasHeight: number,
  worldWidth: number,
  worldHeight: number,
): ViewTransform {
  const w = Math.max(1, worldWidth);
  const h = Math.max(1, worldHeight);
  const scale = Math.min(canvasWidth / w, canvasHeight / h);
  out.scale = scale > 0 && Number.isFinite(scale) ? scale : 1;
  out.offsetX = (canvasWidth - w * out.scale) / 2;
  out.offsetY = (canvasHeight - h * out.scale) / 2;
  out.worldWidth = w;
  out.worldHeight = h;
  return out;
}

/** CSS applied to a DOM overlay so its world-coordinate children line up with the canvas. */
export function overlayStyle(view: ViewTransform): {
  transform: string;
  transformOrigin: string;
  width: string;
  height: string;
} {
  return {
    transform: `translate(${view.offsetX}px, ${view.offsetY}px) scale(${view.scale})`,
    transformOrigin: '0 0',
    width: `${view.worldWidth}px`,
    height: `${view.worldHeight}px`,
  };
}
