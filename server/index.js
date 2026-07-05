/**
 * RIFLE.GG server — Node transport (local dev / Node hosts).
 *
 * Serves the built client from ../dist and runs the WebSocket game server on
 * the same port. Game logic lives in ./game.js (runtime-agnostic); this file
 * only adapts Node's `ws` sockets to the `conn` interface game.js expects.
 * The Deno Deploy entrypoint (./deno.ts) is the other adapter over game.js.
 */
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { readFile, stat } from 'fs/promises'
import { join, normalize, extname } from 'path'
import { fileURLToPath } from 'url'
import { handleMessage, handleClose, startIdleSweep } from './game.js'

const PORT = Number(process.env.PORT) || 8081

// ---- static hosting: serve the built client from ../dist (single-service deploy) ----
const CLIENT_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist')
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

async function serveStatic(req, res) {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    return res.end('ok\n')
  }
  let pathname = decodeURIComponent((req.url || '/').split('?')[0])
  if (pathname === '/') pathname = '/index.html'
  // strip leading ../ then re-check the resolved path is inside CLIENT_DIR
  const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, '')
  let filePath = join(CLIENT_DIR, rel)
  if (!filePath.startsWith(CLIENT_DIR)) filePath = join(CLIENT_DIR, 'index.html')
  try {
    if ((await stat(filePath)).isDirectory()) filePath = join(filePath, 'index.html')
    const data = await readFile(filePath)
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' })
    res.end(data)
  } catch {
    // fall back to index.html so the app still loads; 404 only if the build is missing
    try {
      const data = await readFile(join(CLIENT_DIR, 'index.html'))
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(data)
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found\n')
    }
  }
}

const httpServer = createServer((req, res) => {
  serveStatic(req, res).catch(() => {
    res.writeHead(500, { 'content-type': 'text/plain' })
    res.end('server error\n')
  })
})

const wss = new WebSocketServer({ server: httpServer, maxPayload: 4096 })

wss.on('connection', (ws) => {
  ws.isAlive = true
  ws.on('pong', () => (ws.isAlive = true))
  // adapt the Node socket to the conn interface game.js works with
  const conn = {
    room: null,
    playerId: '',
    send(obj) {
      if (obj != null && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj))
    },
    close() {
      ws.close()
    },
  }
  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    handleMessage(conn, msg)
  })
  ws.on('close', () => handleClose(conn))
})

// ws-level liveness: drop sockets that stop answering pings (Node only)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate()
      continue
    }
    ws.isAlive = false
    ws.ping()
  }
}, 30_000)

startIdleSweep()

httpServer.listen(PORT, () => {
  console.log(`rifle-gg-server listening on :${PORT}`)
})
