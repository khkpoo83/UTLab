#!/usr/bin/env node
// Design Commenter — local, zero-dependency server (roadmap Phase 3, P3-7).
//
// Serves the embedded-browser shell (app.html) and injects the overlay
// (design-commenter.js) into any local file or URL you open, so you can hover /
// comment on it inside an iframe and export markdown for Claude Code.
//
//   node server.js [port]     # default 4700, binds 127.0.0.1 only
//
// Routes:
//   GET /                 -> app.html (the shell)
//   GET /dc.js            -> design-commenter.js (overlay; add ?embedded=1)
//   GET /open?src=<p|url> -> target HTML with <base> + overlay injected,
//                            framing headers stripped (same-origin for the iframe)
//   GET /fs/<abs path>    -> local file (for a local page's relative assets)
//
// LOCAL TOOL ONLY: /fs exposes the filesystem, hence the 127.0.0.1 bind.
'use strict'

const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')
const url = require('url')

const PORT = Number(process.argv[2]) || 4700
const HOST = '127.0.0.1'
const DIR = __dirname

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.map': 'application/json; charset=utf-8',
}
const mime = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream'

function sendFile(res, filePath, status) {
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Not found: ' + filePath); return }
    res.writeHead(status || 200, { 'content-type': mime(filePath), 'cache-control': 'no-store' })
    res.end(buf)
  })
}

// Inject <base> + the embedded overlay <script> into an HTML string.
function injectOverlay(html, baseHref) {
  const baseTag = `<base href="${baseHref}">`
  const scriptTag = '<script src="/dc.js?embedded=1"></script>'
  let out = html
  // <base> must come first inside <head> so relative assets resolve correctly.
  if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (m) => m + '\n' + baseTag)
  else out = baseTag + out
  // Overlay last, before </body> (fallback: append).
  if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, scriptTag + '\n</body>')
  else out += '\n' + scriptTag
  return out
}

// Fetch a URL's HTML (follows up to 3 redirects). Callback(err, htmlString).
function fetchUrl(target, cb, depth) {
  if (depth > 3) return cb(new Error('too many redirects'))
  const lib = target.startsWith('https:') ? https : http
  const req = lib.get(target, { headers: { 'user-agent': 'design-commenter/1.0', 'accept': 'text/html,*/*' } }, (r) => {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
      r.resume()
      return fetchUrl(url.resolve(target, r.headers.location), cb, (depth || 0) + 1)
    }
    let body = ''
    r.setEncoding('utf8')
    r.on('data', (c) => { body += c })
    r.on('end', () => cb(null, body))
  })
  req.on('error', cb)
  req.setTimeout(15000, () => { req.destroy(new Error('timeout')); })
}

function handleOpen(res, src) {
  if (!src) { res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); res.end('missing ?src'); return }

  if (/^https?:\/\//i.test(src)) {
    // Remote page: proxy the top HTML, <base> = original URL (assets load from origin).
    fetchUrl(src, (err, html) => {
      if (err) { res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); res.end('fetch failed: ' + err.message); return }
      const out = injectOverlay(html, src)
      // No framing headers → the shell iframe can embed it.
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(out)
    }, 0)
    return
  }

  // Local file: read + inject; <base> points at /fs/<dir>/ for relative assets.
  const abs = path.resolve(src)
  fs.readFile(abs, 'utf8', (err, html) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('file not found: ' + abs); return }
    const baseHref = '/fs' + path.dirname(abs).replace(/\\/g, '/') + '/'
    const out = injectOverlay(html, baseHref)
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(out)
  })
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true)
  const pathname = decodeURIComponent(parsed.pathname)

  if (pathname === '/' || pathname === '/index.html') return sendFile(res, path.join(DIR, 'app.html'))
  if (pathname === '/dc.js') return sendFile(res, path.join(DIR, 'design-commenter.js'))
  if (pathname === '/open') return handleOpen(res, parsed.query.src)
  if (pathname.startsWith('/fs/')) {
    // /fs/<absolute path> → serve that file (local-only; host is 127.0.0.1).
    const abs = path.resolve('/' + pathname.slice('/fs/'.length))
    return sendFile(res, abs)
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('Not found')
})

server.listen(PORT, HOST, () => {
  console.log(`Design Commenter shell → http://${HOST}:${PORT}`)
  console.log(`  open a local page:  http://${HOST}:${PORT}/  then type a path or URL`)
})
