import * as THREE from 'three'

/**
 * Static world collision: a flat list of AABBs. All map geometry is
 * axis-aligned boxes, so AABB-vs-AABB with per-axis resolution is enough.
 */
export class PhysicsWorld {
  readonly colliders: THREE.Box3[] = []

  addBox(box: THREE.Box3) {
    this.colliders.push(box)
  }

  /** Colliders overlapping the given box. */
  overlaps(box: THREE.Box3, out: THREE.Box3[] = []): THREE.Box3[] {
    out.length = 0
    for (const c of this.colliders) {
      if (c.intersectsBox(box)) out.push(c)
    }
    return out
  }

  /** True if the given box intersects nothing. */
  isFree(box: THREE.Box3): boolean {
    for (const c of this.colliders) {
      if (c.intersectsBox(box)) return false
    }
    return true
  }
}
