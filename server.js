// server.js — Local dev server (mirrors Netlify functions)
const http = require("http");
const fs   = require("fs");
const path = require("path");
const { handler } = require("./netlify/functions/api");

const PORT = 3001;

const server = http.createServer(async (req, res) => {
  const url = req.url;

  // Serve static files from public/
  if (!url.startsWith("/api")) {
    const filePath = path.join(__dirname, "public", url === "/" ? "index.html" : url);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const mime = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json" };
      res.writeHead(200, { "Content-Type": mime[ext] || "text/plain" });
      res.end(fs.readFileSync(filePath));
      return;
    }
    // Default to index.html
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(fs.readFileSync(path.join(__dirname, "public/index.html")));
    return;
  }

  // Route API calls to the Netlify function handler
  const event = { path: url, httpMethod: req.method, queryStringParameters: {}, headers: {} };
  try {
    const result = await handler(event);
    res.writeHead(result.statusCode, result.headers || {});
    res.end(result.body);
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => {
  console.log(`\n🏏 Pavilion dev server running at http://localhost:${PORT}\n`);
});
