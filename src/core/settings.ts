export interface GameSettings {
  sensitivity: number // multiplier, 0.3–3
  volume: number // 0–1
  fov: number // degrees, 60–110
  autofire: boolean // auto-shoot while the crosshair is on an enemy
}

const KEY = 'rifle-gg-settings'

export const DEFAULT_SETTINGS: GameSettings = { sensitivity: 1, volume: 0.8, fov: 80, autofire: false }

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<GameSettings>
    const num = (v: unknown, def: number) => (Number.isFinite(Number(v)) ? Number(v) : def)
    return {
      sensitivity: clamp(num(parsed.sensitivity, DEFAULT_SETTINGS.sensitivity), 0.3, 3),
      volume: clamp(num(parsed.volume, DEFAULT_SETTINGS.volume), 0, 1),
      fov: clamp(num(parsed.fov, DEFAULT_SETTINGS.fov), 60, 110),
      autofire: parsed.autofire === true,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: GameSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage may be unavailable (private mode) */
  }
}

function clamp(v: number, min: number, max: number): number {
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min
}
