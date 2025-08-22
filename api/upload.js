// /api/upload.js
import { Web3Storage, File } from 'web3.storage';

export const config = {
  api: { bodyParser: { sizeLimit: '8mb' } } // höheres Limit
};

function dataURLtoBuffer(dataURL){
  const base64 = dataURL.split(',')[1];
  return Buffer.from(base64, 'base64');
}

export default async function handler(req, res){
  try{
    if(req.method!=='POST') return res.status(405).send('Method Not Allowed');

    const { imageDataURL, name, description } = req.body || {};
    if(!imageDataURL) return res.status(400).send('Missing imageDataURL');

    const token = process.env.WEB3STORAGE_TOKEN;
    if(!token) return res.status(500).send('Missing WEB3STORAGE_TOKEN');

    const client = new Web3Storage({ token });

    // 1) Bild
    const buf = dataURLtoBuffer(imageDataURL);
    const imageFile = new File([buf], 'dna.jpg', { type: 'image/jpeg' });
    const imageCid = await client.put([imageFile], { wrapWithDirectory:false });
    const imageURI = `ipfs://${imageCid}`;

    // 2) Metadaten (ERC721)
    const metadata = {
      name: name || 'NLABS DNA',
      description: description || 'On-chain DNA artwork',
      image: imageURI,
      attributes: [] // Traits später
    };
    const metaBlob = new Blob([JSON.stringify(metadata)], { type:'application/json' });
    const metaFile = new File([metaBlob], 'metadata.json', { type:'application/json' });
    const metadataCid = await client.put([metaFile], { wrapWithDirectory:false });

    const tokenURI = `ipfs://${metadataCid}`;
    return res.status(200).json({ imageCid, metadataCid, tokenURI });
  }catch(e){
    console.error(e);
    if(String(e?.message||'').toLowerCase().includes('too large')){
      return res.status(413).send('Payload too large');
    }
    return res.status(500).send(`Upload failed: ${e.message}`);
  }
}
