/** Keyboard + mouse state, fed by DOM events, consumed once per frame. */
export class Input {
  private down = new Set<string>()
  private pressed = new Set<string>()
  mouseDX = 0
  mouseDY = 0

  constructor() {
    window.addEventListener('keydown', (e) => {
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

  /** Called from the pointer-lock mousemove handler. */
  addMouseDelta(dx: number, dy: number) {
    this.mouseDX += dx
    this.mouseDY += dy
  }

  isDown(code: string): boolean {
    return this.down.has(code)
  }

  /** True only on the frame the key went down. */
  wasPressed(code: string): boolean {
    return this.pressed.has(code)
  }

  /** Clear per-frame state. Call at the end of every update. */
  endFrame() {
    this.pressed.clear()
    this.mouseDX = 0
    this.mouseDY = 0
  }
}
