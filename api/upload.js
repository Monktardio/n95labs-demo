// /api/upload.js  — Vercel Serverless Function (Node.js runtime, CommonJS)
module.exports.config = { runtime: 'nodejs' }; // erzwingt Node (nicht Edge)

const Busboy = require('busboy');
const { Web3Storage, File } = require('web3.storage');

// --- CORS ---
function withCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// --- multipart reader (bis 25 MB) ---
function readMultipart(req, { maxBytes = 25 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers, limits: { fileSize: maxBytes } });
    const files = [];
    const fields = {};

    busboy.on('file', (fieldname, file, info = {}) => {
      const { filename, mimeType } = info;
      const chunks = [];
      let total = 0;

      file.on('data', (d) => {
        total += d.length;
        if (total > maxBytes) {
          file.unpipe();
          reject(new Error('413: file too large'));
          return;
        }
        chunks.push(d);
      });

      file.on('end', () => {
        files.push({
          fieldname,
          filename: filename || 'upload.bin',
          mimeType: mimeType || 'application/octet-stream',
          buffer: Buffer.concat(chunks),
          size: total,
        });
      });
    });

    busboy.on('field', (name, val) => { fields[name] = val; });
    busboy.on('error', reject);
    busboy.on('finish', () => resolve({ files, fields }));

    req.pipe(busboy);
  });
}

module.exports = async (req, res) => {
  withCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: einfacher Self-Test (hilft beim Debuggen)
  if (req.method === 'GET') {
    const hasToken = Boolean(process.env.WEB3_STORAGE_TOKEN);
    return res.status(200).json({ ok: true, route: '/api/upload', runtime: 'nodejs', hasToken });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const token = process.env.WEB3_STORAGE_TOKEN;
    if (!token) {
      return res.status(500).json({ ok: false, error: 'Missing WEB3_STORAGE_TOKEN env' });
    }
    const client = new Web3Storage({ token });

    // 1) Multipart lesen
    const { files } = await readMultipart(req, { maxBytes: 25 * 1024 * 1024 });

    // Bild finden
    const img = files.find((f) => f.fieldname === 'file');
    if (!img) {
      return res.status(400).json({ ok: false, error: "No 'file' found in form-data" });
    }

    // 2) Bild → IPFS
    const imageFile = new File([img.buffer], img.filename || 'dna-art.jpg', {
      type: img.mimeType || 'image/jpeg',
    });

    let imageCid;
    try {
      imageCid = await client.put([imageFile], { wrapWithDirectory: false });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'web3.storage put(image) failed: ' + (e?.message || e) });
    }
    const imageUrl = `ipfs://${imageCid}`;

    // 3) Metadata finden/patchen
    const metaUpload = files.find((f) => f.filename === 'metadata.json');
    let metadata = {};
    if (metaUpload) {
      try {
        metadata = JSON.parse(metaUpload.buffer.toString('utf8'));
      } catch {
        return res.status(400).json({ ok: false, error: 'Invalid metadata.json (not JSON)' });
      }
    }
    metadata.image = imageUrl;
    if (!metadata.name) metadata.name = 'NLABS DNA';
    if (!metadata.description) metadata.description = 'Generated DNA artwork on Base.';

    const metaBuffer = Buffer.from(JSON.stringify(metadata, null, 2));
    const metaFile = new File([metaBuffer], 'metadata.json', { type: 'application/json' });

    let metadataCid;
    try {
      metadataCid = await client.put([metaFile], { wrapWithDirectory: false });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'web3.storage put(metadata) failed: ' + (e?.message || e) });
    }
    const metadataUrl = `ipfs://${metadataCid}`;

    return res.status(200).json({
      ok: true,
      imageCid,
      imageUrl,
      metadataCid,
      metadataUrl,
    });
  } catch (err) {
    const msg = err?.message || String(err);
    const is413 = msg.includes('413');
    return res.status(is413 ? 413 : 500).json({ ok: false, error: msg });
  }
};
