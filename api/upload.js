// /api/upload.js — Vercel Serverless (Node), Pinata backend
module.exports.config = { runtime: 'nodejs' };

const Busboy = require('busboy'); // parse incoming multipart

function withCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

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
          size: total
        });
      });
    });
    busboy.on('field', (n, v) => { fields[n] = v; });
    busboy.on('error', reject);
    busboy.on('finish', () => resolve({ files, fields }));
    req.pipe(busboy);
  });
}

module.exports = async (req, res) => {
  withCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET-Selbsttest: zeigt ob Env vorhanden ist
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      route: '/api/upload',
      runtime: 'nodejs',
      pinata: { hasJwt: Boolean(process.env.PINATA_JWT) }
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const PINATA_JWT = process.env.PINATA_JWT;
    if (!PINATA_JWT) {
      return res.status(500).json({ ok: false, error: 'Missing PINATA_JWT env' });
    }

    // 1) multipart lesen
    const { files } = await readMultipart(req, { maxBytes: 25 * 1024 * 1024 });
    const img = files.find(f => f.fieldname === 'file');
    if (!img) return res.status(400).json({ ok: false, error: "No 'file' found in form-data" });

    // 2) Bild -> Pinata pinFileToIPFS
    const fd = new FormData();
    // Node 18+ hat Blob/FormData global
    fd.append(
      'file',
      new Blob([img.buffer], { type: img.mimeType || 'image/jpeg' }),
      img.filename || 'dna-art.jpg'
    );

    const pinataFileRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${PINATA_JWT}` },
      body: fd
    });

    const pinataFileJson = await pinataFileRes.json().catch(() => null);
    if (!pinataFileRes.ok) {
      const errMsg = pinataFileJson?.error || pinataFileJson?.message || JSON.stringify(pinataFileJson) || 'pinFileToIPFS failed';
      return res.status(500).json({ ok: false, error: errMsg });
    }
    const imageCid = pinataFileJson.IpfsHash;
    const imageUrl = `ipfs://${imageCid}`;

    // 3) Metadata vorbereiten/patchen
    const metaUpload = files.find(f => f.filename === 'metadata.json');
    let metadata = {};
    if (metaUpload) {
      try { metadata = JSON.parse(Buffer.from(metaUpload.buffer).toString('utf8')); }
      catch { return res.status(400).json({ ok: false, error: 'Invalid metadata.json (not JSON)' }); }
    }
    metadata.image = imageUrl;
    if (!metadata.name) metadata.name = 'NLABS DNA';
    if (!metadata.description) metadata.description = 'Generated DNA artwork on Base.';

    // 4) Metadata -> Pinata pinJSONToIPFS
    const pinataJsonRes = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PINATA_JWT}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pinataContent: metadata
      })
    });

    const pinataJson = await pinataJsonRes.json().catch(() => null);
    if (!pinataJsonRes.ok) {
      const errMsg = pinataJson?.error || pinataJson?.message || JSON.stringify(pinataJson) || 'pinJSONToIPFS failed';
      return res.status(500).json({ ok: false, error: errMsg });
    }
    const metadataCid = pinataJson.IpfsHash;
    const metadataUrl = `ipfs://${metadataCid}`;

    return res.status(200).json({ ok: true, imageCid, imageUrl, metadataCid, metadataUrl });
  } catch (err) {
    const msg = err?.message || String(err);
    const is413 = msg.includes('413');
    return res.status(is413 ? 413 : 500).json({ ok: false, error: msg });
  }
};
