// api/upload.js  — Vercel Serverless Function (Node.js runtime)
const Busboy = require("busboy");
const { Web3Storage, File } = require("web3.storage");

// --- Hilfsfunktion: Multipart lesen ---
function readMultipart(req, { maxBytes = 10 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers, limits: { fileSize: maxBytes } });

    const files = [];
    const fields = {};

    busboy.on("file", (name, file, info) => {
      const { filename, mimeType } = info;
      const chunks = [];
      let total = 0;

      file.on("data", (d) => {
        total += d.length;
        if (total > maxBytes) {
          file.unpipe();
          reject(new Error("413: file too large"));
          return;
        }
        chunks.push(d);
      });
      file.on("end", () => {
        files.push({
          fieldname: name,
          filename: filename || "upload.bin",
          mimeType: mimeType || "application/octet-stream",
          buffer: Buffer.concat(chunks)
        });
      });
    });

    busboy.on("field", (name, val) => {
      fields[name] = val;
    });

    busboy.on("error", reject);
    busboy.on("finish", () => resolve({ files, fields }));

    req.pipe(busboy);
  });
}

// --- CORS (optional, falls du von anderen Domains testest) ---
function withCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

module.exports = async (req, res) => {
  withCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const token = process.env.WEB3_STORAGE_TOKEN;
    if (!token) {
      return res.status(500).json({ ok: false, error: "Missing WEB3_STORAGE_TOKEN env" });
    }
    const client = new Web3Storage({ token });

    // 1) Multipart einlesen (Standard: max 10MB; anpassbar)
    const { files } = await readMultipart(req, { maxBytes: 12 * 1024 * 1024 });

    // Wir erwarten:
    // - PNG/JPG unter Feldname "file"
    // - optional: "metadata.json" (wird gepatcht)
    const img = files.find((f) => f.fieldname === "file");
    if (!img) {
      return res.status(400).json({ ok: false, error: "No 'file' found in form-data" });
    }

    // 2) Bild zu IPFS
    const imageFile = new File([img.buffer], img.filename || "dna-art.png", {
      type: img.mimeType || "image/png"
    });
    const imageCid = await client.put([imageFile], { wrapWithDirectory: false });
    const imageUrl = `ipfs://${imageCid}`;

    // 3) Metadata vorbereiten/patchen
    const metaUpload = files.find((f) => f.filename === "metadata.json");
    let metadata;
    if (metaUpload) {
      try {
        metadata = JSON.parse(metaUpload.buffer.toString("utf8"));
      } catch {
        metadata = {};
      }
    } else {
      metadata = {};
    }
    // Pflichtfeld setzen / überschreiben
    metadata.image = imageUrl;
    if (!metadata.name) metadata.name = "NLABS DNA";
    if (!metadata.description) metadata.description = "Generated DNA artwork on Base.";

    const metaBuffer = Buffer.from(JSON.stringify(metadata, null, 2));
    const metaFile = new File([metaBuffer], "metadata.json", { type: "application/json" });
    const metadataCid = await client.put([metaFile], { wrapWithDirectory: false });
    const metadataUrl = `ipfs://${metadataCid}`;

    // 4) Ergebnis zurück
    return res.status(200).json({
      ok: true,
      imageCid,
      imageUrl,
      metadataCid,
      metadataUrl
    });
  } catch (err) {
    const msg = (err && err.message) || String(err);
    const is413 = msg.includes("413");
    return res.status(is413 ? 413 : 500).json({ ok: false, error: msg });
  }
};
