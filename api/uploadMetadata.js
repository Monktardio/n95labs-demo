export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  const token = process.env.WEB3STORAGE_TOKEN;
  if (!token) {
    return new Response('Missing WEB3STORAGE_TOKEN', { status: 500 });
  }
  try {
    const meta = await req.json(); // { name, description, image, attributes }
    const up = await fetch('https://api.web3.storage/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(meta)
    });
    if (!up.ok) {
      const txt = await up.text();
      return new Response(JSON.stringify({ error: txt }), { status: up.status, headers: { 'content-type': 'application/json' }});
    }
    const data = await up.json(); // { cid }
    return new Response(JSON.stringify({ metadataCid: data.cid, tokenURI: `ipfs://${data.cid}` }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}
