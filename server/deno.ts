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

const MAX_MSG_BYTES = 4096 // mirror the Node ws maxPayload

async function serveClient(req: Request, pathname: string): Promise<Response> {
  const res = await serveDir(req, { fsRoot: FS_ROOT, quiet: true })
  if (res.status !== 404) return res
  // a missing *asset* (has a file extension) is a real 404 — don't mask a
  // broken deploy as HTML; only unknown routes fall back to index.html
  if (/\.[a-z0-9]+$/i.test(pathname)) return res
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
    let socket: WebSocket, response: Response
    try {
      ;({ socket, response } = Deno.upgradeWebSocket(req))
    } catch {
      return new Response('invalid websocket upgrade', { status: 400 })
    }
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
      // drop oversized/non-text frames (Node's ws enforces this via maxPayload)
      if (typeof e.data !== 'string' || e.data.length > MAX_MSG_BYTES) return
      let msg: unknown
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }
      handleMessage(conn, msg)
    }
    // tear the room down on close only; a transient onerror is usually
    // followed by onclose, and shouldn't end everyone's match on its own
    socket.onclose = () => handleClose(conn)
    return response
  }

  return serveClient(req, url.pathname)
})
