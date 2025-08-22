// /api/upload.js
// Vercel Serverless Function (Node.js)
// Proxy zu Web3.Storage: nimmt Bild (image/png) oder JSON entgegen
// und lädt mit deinem WEB3STORAGE_TOKEN sicher auf IPFS.

// WICHTIG: In Vercel unter Settings > Environment Variables
// WEB3STORAGE_TOKEN=<dein_token> setzen und neu deployen.

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Only POST allowed' });
    }

    const token = process.env.WEB3STORAGE_TOKEN;
    if (!token) {
      return res.status(500).json({ error: 'Missing WEB3STORAGE_TOKEN' });
    }

    // Body als Buffer lesen (roh, damit wir Blobs/JSON etc. 1:1 weiterreichen)
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyBuffer = Buffer.concat(chunks);

    const contentType = req.headers['content-type'] || 'application/octet-stream';

    const r = await fetch('https://api.web3.storage/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': contentType
      },
      body: bodyBuffer
    });

    const text = await r.text();
    res.status(r.status).send(text);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message || e) });
  }
}
