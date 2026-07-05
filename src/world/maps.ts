/** Visual theming for the arena. Collision layout is identical across maps
 * (bots/spawns/tests depend on it); only palette, sky, fog, lighting, and
 * decorative accents change. */
export interface MapPalette {
  floor: number
  floorAccent: number
  wall: number
  midWall: number
  crateA: number
  crateB: number
  platform: number
  stairs: number
  spawnPad: number
  /** Tall decorative backdrop pillars unique to each theme. */
  decor: number
}

export interface MapTheme {
  sky: number
  fog: { color: number; near: number; far: number }
  hemi: { sky: number; ground: number; intensity: number }
  sun: { color: number; intensity: number }
  palette: MapPalette
}

export interface MapDef {
  id: string
  name: string
  theme: MapTheme
}

export const MAPS: MapDef[] = [
  {
    id: 'foundry',
    name: '파운드리',
    theme: {
      sky: 0x8fc4e8,
      fog: { color: 0x8fc4e8, near: 60, far: 140 },
      hemi: { sky: 0xcfe4ff, ground: 0x9a8f7a, intensity: 1.5 },
      sun: { color: 0xfff2dd, intensity: 1.6 },
      palette: {
        floor: 0x9aa5b1,
        floorAccent: 0x8494a3,
        wall: 0x7488a0,
        midWall: 0x66788c,
        crateA: 0xe2903a,
        crateB: 0x4fa3a5,
        platform: 0x6f9a78,
        stairs: 0x7d8a97,
        spawnPad: 0xff5a3c,
        decor: 0x556071,
      },
    },
  },
  {
    id: 'sandstorm',
    name: '사막',
    theme: {
      sky: 0xe8c98f,
      fog: { color: 0xe0c090, near: 45, far: 110 },
      hemi: { sky: 0xffe6b0, ground: 0xb08040, intensity: 1.7 },
      sun: { color: 0xfff0c8, intensity: 1.9 },
      palette: {
        floor: 0xd8b878,
        floorAccent: 0xc4a060,
        wall: 0xc09a5a,
        midWall: 0xa8823f,
        crateA: 0x9c6b32,
        crateB: 0xcbb489,
        platform: 0xb89457,
        stairs: 0xc8a86a,
        spawnPad: 0xff5a3c,
        decor: 0xb58a4a,
      },
    },
  },
  {
    id: 'neon',
    name: '네온',
    theme: {
      sky: 0x141026,
      fog: { color: 0x1a1230, near: 40, far: 120 },
      hemi: { sky: 0x4a3a8f, ground: 0x1a1030, intensity: 1.1 },
      sun: { color: 0xc0a0ff, intensity: 1.2 },
      palette: {
        floor: 0x24203a,
        floorAccent: 0xff2f8f,
        wall: 0x2e2650,
        midWall: 0x3a2e66,
        crateA: 0xff2f8f,
        crateB: 0x2fd0ff,
        platform: 0x7a2fff,
        stairs: 0x3a3060,
        spawnPad: 0x2fd0ff,
        decor: 0xff2f8f,
      },
    },
  },
  {
    id: 'frost',
    name: '설원',
    theme: {
      sky: 0xd6e8f4,
      fog: { color: 0xdcecf6, near: 38, far: 105 },
      hemi: { sky: 0xeaf4ff, ground: 0xa8c0d0, intensity: 1.8 },
      sun: { color: 0xeaf2ff, intensity: 1.5 },
      palette: {
        floor: 0xdfe9f0,
        floorAccent: 0xb8cede,
        wall: 0xaec4d6,
        midWall: 0x9ab0c4,
        crateA: 0x7fa8c8,
        crateB: 0xc4d8e6,
        platform: 0x9fc0d8,
        stairs: 0xc0d4e2,
        spawnPad: 0xff5a3c,
        decor: 0x8fb0c8,
      },
    },
  },
  {
    id: 'jungle',
    name: '정글',
    theme: {
      sky: 0x8fbf7a,
      fog: { color: 0x7ba86a, near: 35, far: 95 },
      hemi: { sky: 0xcae6a8, ground: 0x3a5228, intensity: 1.4 },
      sun: { color: 0xf0f0c0, intensity: 1.5 },
      palette: {
        floor: 0x5a7742,
        floorAccent: 0x455c33,
        wall: 0x6b7856,
        midWall: 0x566044,
        crateA: 0x8a6a3a,
        crateB: 0x4e6b3a,
        platform: 0x6b8a4a,
        stairs: 0x748560,
        spawnPad: 0xff5a3c,
        decor: 0x3f5a2c,
      },
    },
  },
]

export function mapById(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0]
}
