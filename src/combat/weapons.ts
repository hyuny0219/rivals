export type WeaponSlot = 'primary' | 'secondary' | 'melee' | 'utility'

export interface WeaponDef {
  id: string
  name: string
  slot: WeaponSlot
  kind: 'hitscan' | 'melee' | 'projectile'
  auto: boolean
  rpm: number
  damage: number // per bullet/pellet; projectile = max blast damage
  headshotMult: number
  pellets: number
  magazine: number // 0 = no reload (melee); utility = carry count
  reloadTime: number
  /** Base spread in radians (hip fire). */
  spread: number
  /** Extra spread added per shot, decaying over time. */
  bloom: number
  /** Camera pitch kick per shot, radians. */
  kick: number
  range: number
  /** ADS zoom FOV; 0 = no ADS. */
  adsFov: number
}

const base = {
  pellets: 1,
  bloom: 0.004,
  adsFov: 0,
}

export const WEAPONS: Record<string, WeaponDef> = {
  ar: {
    ...base,
    id: 'ar',
    name: '돌격소총',
    slot: 'primary',
    kind: 'hitscan',
    auto: true,
    rpm: 600,
    damage: 22,
    headshotMult: 1.6,
    magazine: 30,
    reloadTime: 1.8,
    spread: 0.011,
    bloom: 0.005,
    kick: 0.0055,
    range: 150,
    adsFov: 55,
  },
  shotgun: {
    ...base,
    id: 'shotgun',
    name: '샷건',
    slot: 'primary',
    kind: 'hitscan',
    auto: false,
    rpm: 78,
    damage: 9,
    headshotMult: 1.4,
    pellets: 8,
    magazine: 6,
    reloadTime: 2.4,
    spread: 0.045,
    bloom: 0.002,
    kick: 0.03,
    range: 32, // balance: reinforce its close-range role (was 40)
  },
  sniper: {
    ...base,
    id: 'sniper',
    name: '저격총',
    slot: 'primary',
    kind: 'hitscan',
    auto: false,
    rpm: 42,
    damage: 95,
    headshotMult: 2.0,
    magazine: 5,
    reloadTime: 2.6,
    spread: 0.05, // hip fire is punished; ADS shrinks it
    bloom: 0.002,
    kick: 0.022,
    range: 300,
    adsFov: 24,
  },
  pistol: {
    ...base,
    id: 'pistol',
    name: '권총',
    slot: 'secondary',
    kind: 'hitscan',
    auto: false,
    rpm: 330,
    // balance: strong precise backup, but shouldn't rival a primary — was 30 / 1.8
    damage: 27,
    headshotMult: 1.6,
    magazine: 12,
    reloadTime: 1.5,
    spread: 0.009,
    bloom: 0.006,
    kick: 0.009,
    range: 100,
  },
  uzi: {
    ...base,
    id: 'uzi',
    name: '우지',
    slot: 'secondary',
    kind: 'hitscan',
    auto: true,
    rpm: 900,
    damage: 14,
    headshotMult: 1.5,
    magazine: 25,
    reloadTime: 1.7,
    spread: 0.028,
    bloom: 0.004,
    kick: 0.004,
    range: 60,
  },
  knife: {
    ...base,
    id: 'knife',
    name: '칼',
    slot: 'melee',
    kind: 'melee',
    auto: false,
    rpm: 140,
    damage: 55,
    headshotMult: 1.0,
    magazine: 0,
    reloadTime: 0,
    spread: 0,
    bloom: 0,
    kick: 0.004,
    range: 2.4,
  },
  grenade: {
    ...base,
    id: 'grenade',
    name: '수류탄',
    slot: 'utility',
    kind: 'projectile',
    auto: false,
    rpm: 55,
    damage: 100, // at blast center
    headshotMult: 1.0,
    magazine: 2, // carried count; regenerates over time
    reloadTime: 0,
    spread: 0,
    bloom: 0,
    kick: 0.008,
    range: 6, // blast radius
  },
}

/** Slot cycling order: pressing the same slot key again cycles within it. */
export const SLOT_WEAPONS: Record<WeaponSlot, string[]> = {
  primary: ['ar', 'shotgun', 'sniper'],
  secondary: ['pistol', 'uzi'],
  melee: ['knife'],
  utility: ['grenade'],
}

export const SLOT_ORDER: WeaponSlot[] = ['primary', 'secondary', 'melee', 'utility']
