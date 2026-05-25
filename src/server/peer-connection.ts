import net from 'net';
import crypto from 'crypto';
import { EventEmitter } from 'events';

export interface PeerInfo {
  ip: string;
  port: number;
}

export class PeerConnection extends EventEmitter {
  private socket: net.Socket;
  private buffer: Buffer = Buffer.alloc(0);
  private ip: string;
  private port: number;

  public amChoking = true;
  public amInterested = false;
  public peerChoking = true;
  public peerInterested = false;
  public bitfield: boolean[] = [];
  public connected = false;

  private infoHash: Buffer;
  private peerId: string;
  private handshaked = false;
  public id: string;

  constructor(peer: PeerInfo, infoHash: Buffer, peerId: string, numPieces: number) {
    super();
    this.ip = peer.ip;
    this.port = peer.port;
    this.id = `${this.ip}:${this.port}`;
    this.infoHash = infoHash;
    this.peerId = peerId;
    this.socket = new net.Socket();
    this.bitfield = new Array(numPieces).fill(false);

    this.setupSocket();
  }

  private setupSocket() {
    this.socket.setTimeout(10000); // 10s timeout
    this.socket.on('connect', () => {
      this.connected = true;
      this.sendHandshake();
      this.emit('connected');
    });

    this.socket.on('data', (data) => {
      this.buffer = Buffer.concat([this.buffer, data]);
      this.parseMessages();
    });

    this.socket.on('error', (err) => {
      this.close();
    });

    this.socket.on('timeout', () => {
      this.close();
    });

    this.socket.on('close', () => {
      this.connected = false;
      this.emit('disconnected');
    });
  }

  public connect() {
    this.socket.connect(this.port, this.ip);
  }

  public close() {
    this.connected = false;
    this.socket.destroy();
  }

  private sendHandshake() {
    const protocolId = Buffer.from('BitTorrent protocol');
    const handshake = Buffer.alloc(49 + protocolId.length);
    handshake.writeUInt8(protocolId.length, 0);
    protocolId.copy(handshake, 1);
    // 8 reserved bytes
    Buffer.alloc(8).copy(handshake, protocolId.length + 1);
    this.infoHash.copy(handshake, protocolId.length + 9);
    Buffer.from(this.peerId).copy(handshake, protocolId.length + 29);
    
    this.socket.write(handshake);
  }

  private parseMessages() {
    if (!this.handshaked) {
      if (this.buffer.length < 68) return; // standard handshake length
      const pstrlen = this.buffer.readUInt8(0);
      if (pstrlen !== 19 || this.buffer.length < 49 + pstrlen) {
        this.close(); // Invalid handshake
        return;
      }
      this.handshaked = true;
      this.buffer = this.buffer.slice(49 + pstrlen);
      this.emit('handshaked');
    }

    while (this.buffer.length >= 4) {
      const payloadLength = this.buffer.readUInt32BE(0);
      if (payloadLength === 0) {
        // Keep-alive
        this.buffer = this.buffer.slice(4);
        continue;
      }

      if (this.buffer.length < 4 + payloadLength) {
        break; // Wait for more data
      }

      const id = this.buffer.readUInt8(4);
      const payload = this.buffer.slice(5, 4 + payloadLength);
      
      this.handleMessage(id, payload);
      this.buffer = this.buffer.slice(4 + payloadLength);
    }
  }

  private handleMessage(id: number, payload: Buffer) {
    if (id === 0) { // choke
      this.peerChoking = true;
      this.emit('choke');
    } else if (id === 1) { // unchoke
      this.peerChoking = false;
      this.emit('unchoke');
    } else if (id === 2) { // interested
      this.peerInterested = true;
    } else if (id === 3) { // not interested
      this.peerInterested = false;
    } else if (id === 4) { // have
      const pieceIndex = payload.readUInt32BE(0);
      this.bitfield[pieceIndex] = true;
      this.emit('have', pieceIndex);
    } else if (id === 5) { // bitfield
      let index = 0;
      for (let i = 0; i < payload.length; i++) {
        const byte = payload[i];
        for (let j = 0; j < 8; j++) {
          if (index < this.bitfield.length) {
            this.bitfield[index] = !!((byte >> (7 - j)) & 1);
          }
          index++;
        }
      }
      this.emit('bitfield');
    } else if (id === 7) { // piece
      const index = payload.readUInt32BE(0);
      const begin = payload.readUInt32BE(4);
      const block = payload.slice(8);
      this.emit('piece', index, begin, block);
    }
  }

  public sendInterested() {
    this.amInterested = true;
    const msg = Buffer.alloc(5);
    msg.writeUInt32BE(1, 0);
    msg.writeUInt8(2, 4);
    if (this.connected) this.socket.write(msg);
  }

  public sendRequest(index: number, begin: number, length: number) {
    const msg = Buffer.alloc(17);
    msg.writeUInt32BE(13, 0);
    msg.writeUInt8(6, 4);
    msg.writeUInt32BE(index, 5);
    msg.writeUInt32BE(begin, 9);
    msg.writeUInt32BE(length, 13);
    if (this.connected) this.socket.write(msg);
  }
}
