/**
 * RIFLE.GG server — Deno Deploy transport.
 *
 * Serves the built client from ../dist and runs the WebSocket game server on
 * the same origin. Game logic lives in ./game.js (runtime-agnostic); this file
 * only adapts Deno's native WebSocket to the `conn` interface game.js expects.
 * The Node entrypoint (./index.js) is the other adapter over game.js.
 *
 * Deploy: GitHub Actions builds the client (dist/) and runs deployctl with the
 * entrypoint server/deno.ts — see .github/workflows/deploy.yml.
 */
import { serveDir } from 'jsr:@std/http@1/file-server'
import { fromFileUrl } from 'jsr:@std/path@1'
import { handleMessage, handleClose, startIdleSweep } from './game.js'

startIdleSweep()

const FS_ROOT = fromFileUrl(new URL('../dist', import.meta.url))

async function serveClient(req: Request): Promise<Response> {
  const res = await serveDir(req, { fsRoot: FS_ROOT, quiet: true })
  if (res.status !== 404) return res
  // SPA fallback → index.html so the app still loads on unknown paths
  try {
    const html = await Deno.readTextFile(`${FS_ROOT}/index.html`)
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  } catch {
    return new Response('not found\n', { status: 404 })
  }
}

Deno.serve((req: Request) => {
  const url = new URL(req.url)
  if (url.pathname === '/healthz') return new Response('ok\n')

  if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
    const { socket, response } = Deno.upgradeWebSocket(req)
    // adapt the Deno socket to the conn interface game.js works with
    const conn = {
      room: null as unknown,
      playerId: '',
      send(obj: unknown) {
        if (obj != null && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(obj))
      },
      close() {
        try {
          socket.close()
        } catch {
          /* already closing */
        }
      },
    }
    socket.onmessage = (e: MessageEvent) => {
      let msg: unknown
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }
      handleMessage(conn, msg)
    }
    socket.onclose = () => handleClose(conn)
    socket.onerror = () => handleClose(conn)
    return response
  }

  return serveClient(req)
})
