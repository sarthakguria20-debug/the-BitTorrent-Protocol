import crypto from 'crypto';
import { EventEmitter } from 'events';
import { PeerConnection, PeerInfo } from './peer-connection';
import { discoverPeers } from './tracker';

export const BLOCK_SIZE = 16384;

export interface Piece {
  index: number;
  length: number;
  hash: string;
  blocks: { begin: number, length: number, data?: Buffer }[];
  downloadedBytes: number;
  isComplete: boolean;
  isVerified: boolean;
  isDownloading: boolean;
}

export class TorrentEngine extends EventEmitter {
  private fileId: string;
  private infoHash: Buffer;
  private peerId: string;
  private announceList: string[];
  public pieceLength: number;
  public totalLength: number;
  public numPieces: number;
  private piecesHashes: Buffer;

  public pieces: Piece[] = [];
  public connections: Map<string, PeerConnection> = new Map();
  public downloaded: number = 0;
  
  public isActive = false;

  constructor(fileId: string, infoHash: Buffer, peerId: string, announceList: string[], piecesHashes: Buffer, pieceLength: number, totalLength: number) {
    super();
    this.fileId = fileId;
    this.infoHash = infoHash;
    this.peerId = peerId;
    this.announceList = announceList;
    this.piecesHashes = piecesHashes;
    this.pieceLength = pieceLength;
    this.totalLength = totalLength;
    this.numPieces = piecesHashes.length / 20;

    this.initPieces();
  }

  private initPieces() {
    for (let i = 0; i < this.numPieces; i++) {
      const pHash = this.piecesHashes.slice(i * 20, i * 20 + 20).toString('hex');
      const pieceLen = i === this.numPieces - 1 ? (this.totalLength % this.pieceLength || this.pieceLength) : this.pieceLength;
      
      const blocks = [];
      for (let begin = 0; begin < pieceLen; begin += BLOCK_SIZE) {
        blocks.push({
          begin,
          length: Math.min(BLOCK_SIZE, pieceLen - begin)
        });
      }

      this.pieces.push({
        index: i,
        length: pieceLen,
        hash: pHash,
        blocks,
        downloadedBytes: 0,
        isComplete: false,
        isVerified: false,
        isDownloading: false
      });
    }
  }

  public async start() {
    this.isActive = true;
    this.emit('status', 'Discovering peers...');
    
    try {
      const peers = await discoverPeers(this.announceList, this.infoHash, this.peerId, 6881, this.totalLength);
      this.emit('log', `Found ${peers.length} peers from trackers.`);
      
      // Limit to 30 concurrent peer attempts for sanity
      const limit = Math.min(peers.length, 30);
      for (let i = 0; i < limit; i++) {
        this.addPeer(peers[i]);
      }
    } catch (e: any) {
      this.emit('error', 'Tracker discovery failed: ' + e.message);
    }
  }

  private addPeer(peer: PeerInfo) {
    if (!this.isActive) return;
    const conn = new PeerConnection(peer, this.infoHash, this.peerId, this.numPieces);
    this.connections.set(conn.id, conn);

    conn.on('connected', () => this.emit('log', `Connected to ${conn.id}`));
    conn.on('disconnected', () => {
      this.connections.delete(conn.id);
      this.rescheduleUnfinishedBlocks();
      this.requestMorePieces();
    });

    conn.on('bitfield', () => {
      conn.sendInterested();
      this.requestMorePieces();
    });

    conn.on('have', () => {
      conn.sendInterested();
      this.requestMorePieces();
    });

    conn.on('unchoke', () => {
      this.requestMorePieces();
    });

    conn.on('piece', (index: number, begin: number, block: Buffer) => {
      this.handleBlockPayload(conn, index, begin, block);
    });

    conn.connect();
  }

  private requestMorePieces() {
    // Basic rarest-first / open-slot allocator
    if (!this.isActive) return;

    for (const conn of Array.from(this.connections.values())) {
      if (conn.peerChoking || !conn.connected) continue;

      // Find an incomplete piece that this peer has
      const piece = this.pieces.find(p => !p.isVerified && conn.bitfield[p.index]);
      
      if (piece) {
        piece.isDownloading = true;
        // Request missing blocks
        for (const block of piece.blocks) {
          if (!block.data) {
            conn.sendRequest(piece.index, block.begin, block.length);
            // In a real client we track pipeline, but here we just request all needed blocks from unchoked peers
          }
        }
      }
    }
    this.emitState();
  }

  private handleBlockPayload(conn: PeerConnection, index: number, begin: number, data: Buffer) {
    const piece = this.pieces[index];
    if (!piece || piece.isVerified) return;

    const block = piece.blocks.find(b => b.begin === begin);
    if (block && !block.data) {
      block.data = data;
      piece.downloadedBytes += data.length;
      this.downloaded += data.length;
      
      if (piece.downloadedBytes === piece.length) {
        this.verifyPiece(piece);
      }
    }
    this.emitState();
  }

  private verifyPiece(piece: Piece) {
    const sortedBlocks = [...piece.blocks].sort((a, b) => a.begin - b.begin);
    const bufs = sortedBlocks.map(b => b.data as Buffer);
    const pieceBuf = Buffer.concat(bufs);
    
    const hash = crypto.createHash('sha1').update(pieceBuf).digest('hex');
    if (hash === piece.hash) {
      piece.isVerified = true;
      piece.isComplete = true;
      this.emit('log', `Verified piece ${piece.index}`);
      
      if (this.pieces.every(p => p.isVerified)) {
        this.completeDownload();
      }
    } else {
      // hash failed
      this.emit('log', `Hash FAILED for piece ${piece.index}`);
      piece.downloadedBytes = 0;
      piece.isDownloading = false;
      for (const b of piece.blocks) {
        b.data = undefined;
      }
    }
    this.requestMorePieces();
  }

  private rescheduleUnfinishedBlocks() {
    for (const piece of this.pieces) {
      if (piece.isDownloading && !piece.isVerified) {
         // Not doing exact mapping here for simplicity, 
         // it will retry blocks without data when unchoked again.
      }
    }
  }

  private completeDownload() {
    this.isActive = false;
    this.emit('log', 'Download Complete!');
    for (const conn of this.connections.values()) {
      conn.close();
    }
    this.emitState();
  }

  public stop() {
    this.isActive = false;
    for (const conn of this.connections.values()) {
      conn.close();
    }
  }

  public getProgress() {
    const verifiedPieces = this.pieces.filter(p => p.isVerified).length;
    return {
      downloaded: this.downloaded,
      totalLength: this.totalLength,
      percent: (this.downloaded / this.totalLength) * 100,
      activePeers: Array.from(this.connections.values()).filter(c => c.connected).length,
      verifiedPieces,
      totalPieces: this.numPieces,
      // Pass a compact map of piece state for the UI
      pieceState: this.pieces.map(p => p.isVerified ? 2 : p.isDownloading ? 1 : 0)
    };
  }

  private emitState() {
     this.emit('update', this.getProgress());
  }
}
