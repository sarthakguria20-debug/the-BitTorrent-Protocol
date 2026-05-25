export interface TorrentState {
  downloaded: number;
  totalLength: number;
  percent: number;
  activePeers: number;
  verifiedPieces: number;
  totalPieces: number;
  pieceState: number[]; // 0: missing, 1: downloading, 2: verified
}
