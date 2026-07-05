import * as THREE from 'three'
import { PhysicsWorld } from './physics'
import { MapDef, MapPalette } from './maps'

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

const W = 64 // arena length (x)
const D = 38 // arena depth (z)
const WALL_H = 7

/**
 * Low-poly arena. Players always spawn at the ±x ends and the center corridor
 * near z = 0 stays passable (bot navigation depends on both), but each map id
 * lays out its own interior structure. Everything is axis-aligned boxes so the
 * AABB physics world covers all of it; `theme.palette` recolors it.
 */
export function buildMap(world: PhysicsWorld, def: MapDef): GameMap {
  const PALETTE: MapPalette = def.theme.palette
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

  // ---------- common frame (identical across maps) ----------
  // floor slab (top at y = 0)
  box(0, -1, 0, W, 1, D, PALETTE.floor)
  box(0, 0, 0, 0.6, 0.02, D, PALETTE.floorAccent, false) // center line accent

  // perimeter walls
  box(0, 0, -D / 2 - 0.5, W + 2, WALL_H, 1, PALETTE.wall)
  box(0, 0, D / 2 + 0.5, W + 2, WALL_H, 1, PALETTE.wall)
  box(-W / 2 - 0.5, 0, 0, 1, WALL_H, D + 2, PALETTE.wall)
  box(W / 2 + 0.5, 0, 0, 1, WALL_H, D + 2, PALETTE.wall)

  // staircase to a side platform, reused by several layouts
  const stairsUp = (px: number, pz: number, height: number, color: number) => {
    for (const end of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const stepH = (height / 6) * (i + 1)
        box(px + end * (0.9 * (5 - i) + 0.45), 0, pz, 0.9, stepH, 6, color)
      }
    }
  }

  // ---------- per-map interior structure ----------
  const P = PALETTE
  if (def.id === 'foundry') {
    // industrial: central doorway wall + two side platforms with stairs
    const gap = 5
    const segD = (D - gap) / 2
    box(0, 0, -(gap / 2 + segD / 2), 1.2, 3.6, segD, P.midWall)
    box(0, 0, gap / 2 + segD / 2, 1.2, 3.6, segD, P.midWall)
    mirrored(8, 0, -6, 2.2, 1.3, 2.2, P.crateA)
    mirrored(8, 0, 6, 2.2, 1.3, 2.2, P.crateB)
    mirrored(14, 0, 0, 2.2, 2.4, 2.2, P.crateA)
    mirrored(20, 0, -10, 2.2, 1.3, 2.2, P.crateB)
    mirrored(20, 0, 10, 2.2, 1.3, 2.2, P.crateA)
    mirrored(24, 0, -6, 2.2, 1.3, 2.2, P.crateB)
    mirrored(24, 0, 6, 2.2, 1.3, 2.2, P.crateA)
    for (const side of [-1, 1]) {
      const pz = side * (D / 2 - 3)
      box(0, 2.0, pz, 16, 0.4, 6, P.platform)
      mirrored(7, 0, pz, 1, 2.0, 1, P.wall)
      stairsUp(-8, pz, 2.4, P.stairs)
      stairsUp(8, pz, 2.4, P.stairs)
    }
  } else if (def.id === 'sandstorm') {
    // open desert: no center wall; a big central mesa flanked by dunes,
    // long sightlines. z ∈ [-4,4] at x=0 stays open.
    box(0, 0, -12, 10, 3.2, 10, P.midWall) // north mesa
    box(0, 0, 12, 10, 3.2, 10, P.midWall) // south mesa
    box(0, 0, -12, 14, 1.4, 14, P.platform, false) // mesa skirts (decor)
    box(0, 0, 12, 14, 1.4, 14, P.platform, false)
    mirrored(16, 0, -3, 3, 1.6, 3, P.crateA) // dune blocks
    mirrored(16, 0, 4, 2.4, 1.0, 2.4, P.crateB)
    mirrored(9, 0, -7, 2.2, 1.3, 2.2, P.crateB)
    mirrored(9, 0, 7, 2.2, 1.3, 2.2, P.crateA)
    mirrored(23, 0, 0, 2.6, 2.2, 2.6, P.crateA)
    mirrored(6, 0, 0, 1.6, 1.0, 4, P.crateB) // low sandbags near center lane
  } else if (def.id === 'neon') {
    // vertical CQC: pillar forests either side of a clear z=0 lane, plus
    // connected edge catwalks
    for (const side of [-1, 1]) {
      for (const dz of [-9, -3, 3, 9]) {
        box(side * 10, 0, dz, 1.1, 4.5, 1.1, P.crateB) // thin tall pillars
      }
      box(side * 18, 0, 0, 1.1, 4.5, 1.1, P.crateA)
      const pz = side * (D / 2 - 3)
      box(0, 2.4, pz, 20, 0.4, 5, P.platform) // catwalk
      stairsUp(-11, pz, 2.8, P.stairs)
      stairsUp(11, pz, 2.8, P.stairs)
    }
    mirrored(6, 0, -6, 2, 1.2, 2, P.crateA)
    mirrored(6, 0, 6, 2, 1.2, 2, P.crateB)
    mirrored(24, 0, -8, 2, 1.2, 2, P.crateB)
    mirrored(24, 0, 8, 2, 1.2, 2, P.crateA)
  } else if (def.id === 'frost') {
    // chicane: two offset half-walls force an S-path; z=0 at x=0 open.
    // a raised central platform sits off the corridor.
    box(-4, 0, -11, 1.2, 3.4, 15, P.midWall) // left half-wall (north)
    box(4, 0, 11, 1.2, 3.4, 15, P.midWall) // right half-wall (south)
    box(0, 0, 0, 6, 1.1, 5, P.platform) // low center island (jumpable)
    mirrored(13, 0, -8, 2.6, 1.6, 2.6, P.crateB)
    mirrored(13, 0, 8, 2.6, 1.6, 2.6, P.crateA)
    mirrored(20, 0, 0, 2.2, 2.2, 2.2, P.crateA)
    mirrored(9, 0, 13, 2.4, 1.3, 2.4, P.crateB)
    mirrored(9, 0, -13, 2.4, 1.3, 2.4, P.crateA)
    for (const side of [-1, 1]) {
      box(side * (W / 2 - 6), 2.0, (side * D) / 3, 8, 0.4, 6, P.platform) // corner decks
      stairsUp(side * (W / 2 - 10.5), (side * D) / 3, 2.4, P.stairs)
    }
  } else {
    // jungle: wide-open center (barrier only near the z edges) + dense
    // scattered low cover + two mid platforms
    box(0, 0, 16, 1.4, 3.2, 6, P.midWall)
    box(0, 0, -16, 1.4, 3.2, 6, P.midWall)
    mirrored(10, 0, 0, 6, 1.8, 6, P.platform) // mid platforms (mantle up)
    mirrored(5, 0, -8, 1.8, 1.1, 1.8, P.crateB)
    mirrored(5, 0, 8, 1.8, 1.1, 1.8, P.crateA)
    mirrored(15, 0, -6, 2, 1.4, 2, P.crateA)
    mirrored(15, 0, 6, 2, 1.4, 2, P.crateB)
    mirrored(21, 0, -11, 2.2, 1.2, 2.2, P.crateB)
    mirrored(21, 0, 11, 2.2, 1.2, 2.2, P.crateA)
    mirrored(24, 0, 0, 1.6, 2.6, 1.6, P.crateA)
    mirrored(3, 0, 12, 1.6, 1.0, 1.6, P.crateB)
    mirrored(3, 0, -12, 1.6, 1.0, 1.6, P.crateA)
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
