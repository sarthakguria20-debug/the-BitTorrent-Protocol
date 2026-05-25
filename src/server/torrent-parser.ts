import bencode from 'bencode';
import crypto from 'crypto';

export interface TorrentInfo {
  infoHash: Buffer;
  infoHashHex: string;
  pieceLength: number;
  pieces: Buffer;
  name: string;
  length: number;
  announce: string;
  announceList?: string[][];
  files?: { path: string[], length: number }[];
}

export function parseTorrent(buffer: Buffer): TorrentInfo {
  const decoded = bencode.decode(buffer) as any;
  
  // Ensure we get the raw info dictionary for accurate hashing
  // bencode.encode matches standard sorting natively so it usually produces identical bytes
  const infoBuffer = bencode.encode(decoded.info);
  const infoHash = crypto.createHash('sha1').update(infoBuffer).digest();
  
  let length = 0;
  let files = undefined;
  
  if (decoded.info.length) {
    length = decoded.info.length;
  } else if (decoded.info.files) {
    length = decoded.info.files.reduce((acc: number, f: any) => acc + f.length, 0);
    files = decoded.info.files.map((f: any) => ({
      path: f.path.map((p: any) => p.toString('utf-8')),
      length: f.length
    }));
  }

  const announceList = [];
  if (decoded['announce-list']) {
    for (const list of decoded['announce-list']) {
      announceList.push(list.map((a: any) => a.toString('utf-8')));
    }
  }

  return {
    infoHash,
    infoHashHex: infoHash.toString('hex'),
    pieceLength: decoded.info['piece length'],
    pieces: decoded.info.pieces,
    name: decoded.info.name ? decoded.info.name.toString('utf-8') : 'Unknown',
    length,
    announce: decoded.announce ? decoded.announce.toString('utf-8') : '',
    announceList: announceList.length > 0 ? announceList : undefined,
    files
  };
}
