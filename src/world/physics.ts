import * as THREE from 'three'

/** Something bullets/explosions can damage. */
export interface Damageable {
  /** World-space center used for explosion distance checks. */
  readonly center: THREE.Vector3
  readonly alive: boolean
  /** Returns true if this damage killed the target. */
  takeDamage(amount: number, isHead: boolean): boolean
}

/** A dynamic, damageable AABB (entity hitbox). */
export interface Hitbox {
  box: THREE.Box3
  entity: Damageable
  part: 'head' | 'body'
}

export interface RayHit {
  distance: number
  point: THREE.Vector3
  hitbox: Hitbox | null // null = static world geometry
}

const EPS = 1e-8

/** Ray vs AABB slab test. Returns entry distance in [0, maxDist], or null. */
function rayBoxDistance(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  box: THREE.Box3,
  maxDist: number,
): number | null {
  let tmin = 0
  let tmax = maxDist
  for (const axis of ['x', 'y', 'z'] as const) {
    const o = origin[axis]
    const d = dir[axis]
    if (Math.abs(d) < EPS) {
      if (o < box.min[axis] || o > box.max[axis]) return null
      continue
    }
    let t1 = (box.min[axis] - o) / d
    let t2 = (box.max[axis] - o) / d
    if (t1 > t2) [t1, t2] = [t2, t1]
    if (t1 > tmin) tmin = t1
    if (t2 < tmax) tmax = t2
    if (tmin > tmax) return null
  }
  return tmin
}

/**
 * Static world collision (axis-aligned boxes) plus dynamic entity hitboxes.
 * Movement queries only see the static world; raycasts see both.
 */
export class PhysicsWorld {
  readonly colliders: THREE.Box3[] = []
  readonly hitboxes: Hitbox[] = []

  addBox(box: THREE.Box3) {
    this.colliders.push(box)
  }

  addHitbox(hitbox: Hitbox) {
    this.hitboxes.push(hitbox)
  }

  /** Static colliders overlapping the given box. */
  overlaps(box: THREE.Box3, out: THREE.Box3[] = []): THREE.Box3[] {
    out.length = 0
    for (const c of this.colliders) {
      if (c.intersectsBox(box)) out.push(c)
    }
    return out
  }

  /** True if the given box intersects no static collider. */
  isFree(box: THREE.Box3): boolean {
    for (const c of this.colliders) {
      if (c.intersectsBox(box)) return false
    }
    return true
  }

  /**
   * Nearest hit along a ray against static geometry and live hitboxes.
   * `ignore` skips one entity (the shooter).
   */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, ignore?: Damageable): RayHit | null {
    let best = maxDist
    let bestHitbox: Hitbox | null = null
    let found = false

    for (const c of this.colliders) {
      const t = rayBoxDistance(origin, dir, c, best)
      if (t !== null && t < best) {
        best = t
        bestHitbox = null
        found = true
      }
    }
    for (const h of this.hitboxes) {
      if (!h.entity.alive || h.entity === ignore) continue
      // a camera standing inside a hitbox must not "hit" it at distance 0
      // regardless of aim direction
      if (h.box.containsPoint(origin)) continue
      const t = rayBoxDistance(origin, dir, h.box, best)
      if (t !== null && t < best) {
        best = t
        bestHitbox = h
        found = true
      }
    }
    if (!found) return null
    return {
      distance: best,
      point: origin.clone().addScaledVector(dir, best),
      hitbox: bestHitbox,
    }
  }
}
