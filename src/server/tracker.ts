import bencode from 'bencode';
import { URL } from 'url';
import dgram from 'dgram';
import crypto from 'crypto';

export interface PeerInfo {
  ip: string;
  port: number;
}

function urlEncodeBytes(buf: Buffer): string {
  let encoded = '';
  for (let i = 0; i < buf.length; i++) {
    const hex = buf[i].toString(16);
    encoded += '%' + (hex.length === 1 ? '0' + hex : hex);
  }
  return encoded;
}

export async function getPeersHttp(announce: string, infoHash: Buffer, peerId: string, port: number, length: number): Promise<PeerInfo[]> {
  const parsedUrl = new URL(announce);
  parsedUrl.searchParams.set('peer_id', peerId);
  parsedUrl.searchParams.set('port', port.toString());
  parsedUrl.searchParams.set('uploaded', '0');
  parsedUrl.searchParams.set('downloaded', '0');
  parsedUrl.searchParams.set('left', length.toString());
  parsedUrl.searchParams.set('compact', '1');

  const url = parsedUrl.toString() + '&info_hash=' + urlEncodeBytes(infoHash);
  
  const response = await fetch(url, { headers: { 'User-Agent': 'NodeBitClient/0.0.1' } });
  if (!response.ok) {
    throw new Error(`Tracker HTTP error: ${response.status}`);
  }
  
  const buffer = Buffer.from(await response.arrayBuffer());
  const decoded = bencode.decode(buffer) as any;
  
  if (decoded['failure reason']) {
    throw new Error(decoded['failure reason'].toString());
  }

  return parseCompactPeers(decoded.peers);
}

function parseCompactPeers(peers: Buffer): PeerInfo[] {
  const result: PeerInfo[] = [];
  if (!peers || !Buffer.isBuffer(peers)) return result;
  // Compact peers is a string of bytes where every 6 bytes is an IP address and Port
  for (let i = 0; i < peers.length; i += 6) {
    const ip = `${peers[i]}.${peers[i+1]}.${peers[i+2]}.${peers[i+3]}`;
    const port = peers.readUInt16BE(i + 4);
    result.push({ ip, port });
  }
  return result;
}

// UDP Tracker simple implementation
export function getPeersUdp(announce: string, infoHash: Buffer, peerId: Buffer, port: number, length: number): Promise<PeerInfo[]> {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(announce);
      const socket = dgram.createSocket('udp4');
      const transactionId = crypto.randomBytes(4);

      // Connection request
      const connectRequest = Buffer.alloc(16);
      connectRequest.writeBigUInt64BE(BigInt('0x41727101980'), 0); // Protocol ID
      connectRequest.writeUInt32BE(0, 8); // Action (0 = connect)
      transactionId.copy(connectRequest, 12);

      let connectionId: Buffer | null = null;
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          socket.close();
        }
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('UDP Tracker timeout'));
      }, 5000);

      socket.on('message', (msg) => {
        if (msg.length < 8) return;
        const action = msg.readUInt32BE(0);
        const resTransactionId = msg.slice(4, 8);
        if (!resTransactionId.equals(transactionId)) return;

        if (action === 0) { // Connect response
          if (msg.length < 16) return;
          connectionId = msg.slice(8, 16);
          
          // Send announce request
          const announceReq = Buffer.alloc(98);
          connectionId.copy(announceReq, 0);
          announceReq.writeUInt32BE(1, 8); // Action (1 = announce)
          transactionId.copy(announceReq, 12);
          infoHash.copy(announceReq, 16);
          peerId.copy(announceReq, 36);
          announceReq.writeBigUInt64BE(BigInt(0), 56); // downloaded
          announceReq.writeBigUInt64BE(BigInt(length), 64); // left
          announceReq.writeBigUInt64BE(BigInt(0), 72); // uploaded
          announceReq.writeUInt32BE(0, 80); // event (0 = none)
          announceReq.writeUInt32BE(0, 84); // ip address (0 = default)
          crypto.randomBytes(4).copy(announceReq, 88); // key
          announceReq.writeInt32BE(-1, 92); // num_want (-1 = default)
          announceReq.writeUInt16BE(port, 96); // port
          
          socket.send(announceReq, 0, announceReq.length, parseInt(url.port || '80'), url.hostname);
        } else if (action === 1) { // Announce response
          if (msg.length < 20) return;
          const peersBuf = msg.slice(20);
          clearTimeout(timer);
          cleanup();
          resolve(parseCompactPeers(peersBuf));
        }
      });

      socket.send(connectRequest, 0, connectRequest.length, parseInt(url.port || '80'), url.hostname);
    } catch (e) {
      reject(e);
    }
  });
}

export async function discoverPeers(announceList: string[], infoHash: Buffer, peerId: string, port: number, length: number): Promise<PeerInfo[]> {
  const allPeers = new Map<string, PeerInfo>();
  const peerIdBuf = Buffer.from(peerId);

  // Try top trackers in sequence
  for (const announceUrl of announceList) {
    try {
      let peers: PeerInfo[] = [];
      if (announceUrl.startsWith('http')) {
        peers = await getPeersHttp(announceUrl, infoHash, peerId, port, length);
      } else if (announceUrl.startsWith('udp')) {
        peers = await getPeersUdp(announceUrl, infoHash, peerIdBuf, port, length);
      }
      
      for (const peer of peers) {
        allPeers.set(`${peer.ip}:${peer.port}`, peer);
      }

      if (allPeers.size > 20) break; // Good enough to start mapping
    } catch (e) {
      // Ignore tracker errors (very common)
      console.log(`Failed tracker ${announceUrl}:`, (e as Error).message);
    }
  }

  return Array.from(allPeers.values());
}
