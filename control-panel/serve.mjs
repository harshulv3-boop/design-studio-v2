// Tiny zero-dependency static server for the control-panel dashboard.
// Serves dashboard.html on http://localhost:8090. The dashboard talks to the
// clone engine (:8081, CORS-enabled) directly and links to the studio (:8080).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DASHBOARD_PORT || 8090);
const FILE = path.join(__dirname, "dashboard.html");

const server = http.createServer((req, res) => {
  // Only serves the dashboard (and its root). Everything else 404s.
  const url = (req.url || "/").split("?")[0];
  if (url === "/" || url === "/dashboard" || url === "/dashboard.html") {
    fs.readFile(FILE, (err, buf) => {
      if (err) { res.writeHead(500); res.end("dashboard.html not found next to serve.mjs"); return; }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(buf);
    });
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`\n  Control panel:  http://localhost:${PORT}\n`);
});
