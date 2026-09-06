import { createServer } from "node:http";
import { readFile, stat, realpath } from "node:fs/promises";
import { join, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const ROOT_REAL = await realpath(ROOT);
const PORT = process.env.PORT ? Number(process.env.PORT) : 5000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(req.url.split("?")[0]);
    if (urlPath === "/") urlPath = "/index.html";
    let filePath = join(ROOT, urlPath);

    const info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) {
      filePath = join(filePath, "index.html");
    }

    const resolved = await realpath(filePath).catch(() => null);
    if (!resolved || (resolved !== ROOT_REAL && !resolved.startsWith(ROOT_REAL + sep))) {
      throw new Error("path outside root");
    }

    const data = await readFile(resolved);
    const ext = extname(resolved).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache, must-revalidate",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 - not found");
  }
});

server.listen(PORT, () => {
  console.log(`Ápse rodando em http://localhost:${PORT}`);
});
