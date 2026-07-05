import * as THREE from 'three'
import { PhysicsWorld } from './physics'
import { MapPalette, MapTheme } from './maps'

export interface SpawnPoint {
  position: THREE.Vector3
  yaw: number
}

export interface GameMap {
  group: THREE.Group
  /** One spawn per side — kept for 1v1/online flows. */
  spawns: SpawnPoint[]
  /** Up to 4 spawns per team for team battles (index 0 = team side -x). */
  teamSpawns: [SpawnPoint[], SpawnPoint[]]
}

/**
 * Symmetric low-poly arena, mirrored across x = 0. Players spawn at ±x ends.
 * Everything is axis-aligned boxes so the AABB physics world covers all of it.
 * The collision layout is fixed; `theme.palette` recolors it per map.
 */
export function buildMap(world: PhysicsWorld, theme: MapTheme): GameMap {
  const PALETTE: MapPalette = theme.palette
  const group = new THREE.Group()

  const materials = new Map<number, THREE.MeshLambertMaterial>()
  const material = (color: number) => {
    let m = materials.get(color)
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color })
      materials.set(color, m)
    }
    return m
  }

  // one unit cube shared by every box; per-mesh size comes from scale
  // (safe for untextured Lambert: normals are renormalized by normalMatrix)
  const unitBox = new THREE.BoxGeometry(1, 1, 1)

  /** Box with bottom-center at (x, y, z); registers a collider unless decorative. */
  const box = (
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: number,
    solid = true,
  ) => {
    const mesh = new THREE.Mesh(unitBox, material(color))
    mesh.scale.set(w, h, d)
    mesh.position.set(x, y + h / 2, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    if (solid) {
      world.addBox(
        new THREE.Box3(
          new THREE.Vector3(x - w / 2, y, z - d / 2),
          new THREE.Vector3(x + w / 2, y + h, z + d / 2),
        ),
      )
    }
    return mesh
  }

  /** Mirror a box across x = 0 (two boxes, one per side). */
  const mirrored = (x: number, y: number, z: number, w: number, h: number, d: number, color: number) => {
    box(x, y, z, w, h, d, color)
    box(-x, y, z, w, h, d, color)
  }

  const W = 64 // arena length (x)
  const D = 38 // arena depth (z)
  const WALL_H = 7

  // floor slab (top at y = 0)
  box(0, -1, 0, W, 1, D, PALETTE.floor)
  // center line accent (decorative, thin)
  box(0, 0, 0, 0.6, 0.02, D, PALETTE.floorAccent, false)

  // perimeter walls
  box(0, 0, -D / 2 - 0.5, W + 2, WALL_H, 1, PALETTE.wall)
  box(0, 0, D / 2 + 0.5, W + 2, WALL_H, 1, PALETTE.wall)
  box(-W / 2 - 0.5, 0, 0, 1, WALL_H, D + 2, PALETTE.wall)
  box(W / 2 + 0.5, 0, 0, 1, WALL_H, D + 2, PALETTE.wall)

  // center wall with a doorway gap in the middle (blocks cross-map sightline)
  const gap = 5
  const segD = (D - gap) / 2
  box(0, 0, -(gap / 2 + segD / 2), 1.2, 3.6, segD, PALETTE.midWall)
  box(0, 0, gap / 2 + segD / 2, 1.2, 3.6, segD, PALETTE.midWall)

  // crates: jumpable singles and stacked doubles, mirrored for symmetry
  mirrored(8, 0, -6, 2.2, 1.3, 2.2, PALETTE.crateA)
  mirrored(8, 0, 6, 2.2, 1.3, 2.2, PALETTE.crateB)
  mirrored(14, 0, 0, 2.2, 2.4, 2.2, PALETTE.crateA)
  mirrored(20, 0, -10, 2.2, 1.3, 2.2, PALETTE.crateB)
  mirrored(20, 0, 10, 2.2, 1.3, 2.2, PALETTE.crateA)
  mirrored(5, 0, -13, 3.2, 2.4, 2.2, PALETTE.crateB)
  mirrored(5, 0, 13, 3.2, 2.4, 2.2, PALETTE.crateA)

  // extra cover in the open lanes so 8-player team fights have footholds
  mirrored(24, 0, -6, 2.2, 1.3, 2.2, PALETTE.crateB)
  mirrored(24, 0, 6, 2.2, 1.3, 2.2, PALETTE.crateA)
  mirrored(11, 0, 11, 2.2, 1.3, 2.2, PALETTE.crateA)
  mirrored(11, 0, -11, 2.2, 1.3, 2.2, PALETTE.crateB)

  // side platforms along both z-edges with stairs (step-up handles 0.4m steps)
  const PLAT_H = 2.4
  for (const side of [-1, 1]) {
    const pz = side * (D / 2 - 3)
    // platform deck
    box(0, PLAT_H - 0.4, pz, 16, 0.4, 6, PALETTE.platform)
    // support pillars (visual + cover)
    mirrored(7, 0, pz, 1, PLAT_H - 0.4, 1, PALETTE.wall)
    // stairs at both platform ends
    for (const end of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const stepH = (PLAT_H / 6) * (i + 1)
        box(end * (8 + 0.9 * (5 - i) + 0.45), 0, pz, 0.9, stepH, 6, PALETTE.stairs)
      }
    }
  }

  // spawn pads (decorative markers)
  box(-W / 2 + 3, 0, 0, 3, 0.05, 3, PALETTE.spawnPad, false)
  box(W / 2 - 3, 0, 0, 3, 0.05, 3, PALETTE.spawnPad, false)

  // decorative skyline pillars beyond the walls (non-solid) — theme flavor
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const h = 6 + ((i * 7) % 11)
      box(side * (W / 2 + 6 + i * 3), 0, -14 + i * 7, 3, h, 3, PALETTE.decor, false)
    }
  }

  const spawns: SpawnPoint[] = [
    { position: new THREE.Vector3(-W / 2 + 3, 0.1, 0), yaw: -Math.PI / 2 },
    { position: new THREE.Vector3(W / 2 - 3, 0.1, 0), yaw: Math.PI / 2 },
  ]

  // team rows near each end wall, clear of crates/stairs
  const spawnZs = [0, 5, -5, 10]
  const teamSpawns: [SpawnPoint[], SpawnPoint[]] = [
    spawnZs.map((z) => ({ position: new THREE.Vector3(-W / 2 + 3, 0.1, z), yaw: -Math.PI / 2 })),
    spawnZs.map((z) => ({ position: new THREE.Vector3(W / 2 - 3, 0.1, z), yaw: Math.PI / 2 })),
  ]

  return { group, spawns, teamSpawns }
}
