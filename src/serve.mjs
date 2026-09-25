// A tiny static server for a built site, so `open` works like
// `npx playwright show-report`: serve the folder on localhost, open the
// browser, stop on Ctrl-C. No dependency, no directory listing, no
// path escapes.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ndjson": "application/x-ndjson; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
};

// Maps a request URL to a file inside root, or null when it escapes or
// does not exist. A directory maps to its index.html.
export function resolveFile(root, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url, "http://x").pathname);
  } catch {
    return null;
  }
  const abs = resolve(root, "." + normalize("/" + pathname));
  const rootAbs = resolve(root);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) return null;
  if (!existsSync(abs)) return null;
  const st = statSync(abs);
  if (st.isDirectory()) {
    const index = join(abs, "index.html");
    return existsSync(index) ? index : null;
  }
  return abs;
}

export function contentType(file) {
  return TYPES[extname(file).toLowerCase()] || "application/octet-stream";
}

// Starts the server. Resolves to { url, port, close }.
export function serveSite({ root, host = "127.0.0.1", port = 0 } = {}) {
  if (!root || !existsSync(join(root, "index.html"))) {
    throw new Error(`no index.html in ${root || "(none)"}; run build first`);
  }
  const server = createServer((req, res) => {
    const file = resolveFile(root, req.url || "/");
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": contentType(file),
      "cache-control": "no-cache",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  });
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      const shownHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
      resolvePromise({
        url: `http://${shownHost}:${actual}/`,
        port: actual,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// Opens a URL in the default browser. Never throws: a headless box just
// gets the URL printed by the caller.
export function openInBrowser(url, platform = process.platform) {
  const cmd =
    platform === "darwin" ? ["open", [url]]
    : platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : ["xdg-open", [url]];
  try {
    const child = spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
