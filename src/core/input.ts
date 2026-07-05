/** Keys the game consumes; default browser behavior is suppressed for these. */
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyC'])

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
