/** Keys the game consumes; default browser behavior is suppressed for these. */
const GAME_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'Space',
  'ShiftLeft',
  'ShiftRight',
  'KeyC',
  'KeyR',
  'KeyQ',
  'KeyG',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
])

/**
 * Keyboard + mouse + touch state.
 * Mouse deltas are consumed once per rendered frame (clearMouse); pressed
 * events are consumed only after a frame that ran at least one physics step
 * (clearPressed) so taps are never dropped on displays faster than the
 * physics rate.
 */
export class Input {
  private down = new Set<string>()
  private pressed = new Set<string>()
  mouseDX = 0
  mouseDY = 0
  /** Analog movement from the virtual joystick: x = strafe right, y = forward. */
  touchMoveX = 0
  touchMoveY = 0

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault()
      if (e.repeat) return
      this.down.add(e.code)
      this.pressed.add(e.code)
    })
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code)
    })
    window.addEventListener('blur', () => {
      this.down.clear()
    })
    // mouse buttons share the key-code path as Mouse0/Mouse1/Mouse2
    window.addEventListener('mousedown', (e) => {
      this.down.add(`Mouse${e.button}`)
      this.pressed.add(`Mouse${e.button}`)
    })
    window.addEventListener('mouseup', (e) => {
      this.down.delete(`Mouse${e.button}`)
    })
  }

  /** Called from the pointer-lock mousemove handler or the touch look zone. */
  addMouseDelta(dx: number, dy: number) {
    this.mouseDX += dx
    this.mouseDY += dy
  }

  /** Touch buttons synthesize key codes so they share the keyboard code path. */
  virtualDown(code: string) {
    this.down.add(code)
    this.pressed.add(code)
  }

  /** One-shot synthetic press with no held state (mouse wheel notches). */
  pressOnce(code: string) {
    this.pressed.add(code)
  }

  virtualUp(code: string) {
    this.down.delete(code)
  }

  setTouchMove(x: number, y: number) {
    this.touchMoveX = x
    this.touchMoveY = y
  }

  isDown(code: string): boolean {
    return this.down.has(code)
  }

  /** True from the keydown until the next clearPressed(). */
  wasPressed(code: string): boolean {
    return this.pressed.has(code)
  }

  /**
   * One-shot read of a press: true once, then cleared. Use for actions that
   * must not repeat across the multiple physics steps of a single frame
   * (weapon switch, reload, semi-auto trigger).
   */
  consumePress(code: string): boolean {
    if (!this.pressed.has(code)) return false
    this.pressed.delete(code)
    return true
  }

  /** Drop all held/pressed state (e.g. when entering or leaving the game). */
  releaseAll() {
    this.down.clear()
    this.pressed.clear()
    this.touchMoveX = 0
    this.touchMoveY = 0
  }

  /** Call once per rendered frame, after mouse look has been applied. */
  clearMouse() {
    this.mouseDX = 0
    this.mouseDY = 0
  }

  /** Call only after at least one physics step consumed the presses. */
  clearPressed() {
    this.pressed.clear()
  }
}
