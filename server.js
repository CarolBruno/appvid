// Servidor mínimo sin dependencias (Node 18+). Guarda la API key y llama a Replicate.
// Uso:  REPLICATE_API_TOKEN=xxx node server.js   ->  http://localhost:3000
const http = require("http");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.REPLICATE_API_TOKEN;
// Modelo de imagen→video. Verificá el nombre y sus parámetros en replicate.com/collections/image-to-video
const MODEL = process.env.REPLICATE_MODEL || "kwaivgi/kling-v2.1";
const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.APP_PASSWORD; // contraseña de acceso (obligatoria si la publicás en internet)
if (!PASSWORD) console.warn("AVISO: sin APP_PASSWORD, cualquiera con el link puede usar tu crédito.");

const crypto = require("crypto");
const okPassword = (given = "") => {
  const a = Buffer.from(String(given)), b = Buffer.from(PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const json = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 25e6) { reject(new Error("Imagen demasiado grande")); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });

const replicate = (url, opts = {}) =>
  fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  });

http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(fs.readFileSync(path.join(__dirname, "public", "index.html")));
    }

    if (PASSWORD && req.url.startsWith("/api/") && !okPassword(req.headers["x-password"]))
      return json(res, 401, { error: "Contraseña incorrecta." });

    if (!TOKEN && req.url.startsWith("/api/"))
      return json(res, 500, { error: "Falta REPLICATE_API_TOKEN en el servidor." });

    if (req.method === "POST" && req.url === "/api/generate") {
      const { image, prompt, duration, quality } = JSON.parse(await readBody(req));
      if (!image || !prompt) return json(res, 400, { error: "Falta la imagen o el prompt." });
      // Los nombres de los campos cambian según el modelo: ajustá este objeto si usás otro.
      const input = {
        prompt,
        start_image: image, // data URI base64
        duration: Number(duration) || 5,
        mode: quality === "pro" ? "pro" : "standard",
      };
      const r = await replicate(`https://api.replicate.com/v1/models/${MODEL}/predictions`, {
        method: "POST",
        body: JSON.stringify({ input }),
      });
      const data = await r.json();
      if (!r.ok) return json(res, r.status, { error: data.detail || "Error al crear el video." });
      return json(res, 200, { id: data.id });
    }

    const m = req.url.match(/^\/api\/status\/([\w-]+)$/);
    if (req.method === "GET" && m) {
      const r = await replicate(`https://api.replicate.com/v1/predictions/${m[1]}`);
      const d = await r.json();
      const output = Array.isArray(d.output) ? d.output[0] : d.output;
      return json(res, 200, { status: d.status, output, error: d.error });
    }

    json(res, 404, { error: "No encontrado" });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
}).listen(PORT, () => console.log(`Listo en http://localhost:${PORT}  (modelo: ${MODEL})`));
