import { useState, useEffect } from 'react';
import { Upload, StopCircle, RefreshCw, Server, Activity, CheckCircle2, Box } from 'lucide-react';
import { formatBytes } from './lib/utils';
import { TorrentState } from './types';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<TorrentState | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let eventSource: EventSource;

    const connectStream = () => {
      eventSource = new EventSource('/api/stream');
      
      eventSource.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === 'state') {
          setState(data.state);
        } else if (data.type === 'log') {
          setLogs(prev => {
            const next = [...prev, data.message];
            return next.length > 50 ? next.slice(next.length - 50) : next;
          });
        }
      };

      eventSource.onerror = () => {
        // Handle reconnects automatically via EventSource
      };
    };

    connectStream();
    
    return () => {
      if (eventSource) eventSource.close();
    };
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setError('');
    const formData = new FormData();
    formData.append('torrent', file);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to upload');
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleStop = async () => {
    try {
      await fetch('/api/stop', { method: 'POST' });
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-[#D1D1D1] p-4 sm:p-8 font-sans relative flex flex-col overflow-x-hidden">
      <div className="absolute inset-0 pointer-events-none opacity-[0.03] z-0" style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
      <div className="max-w-5xl mx-auto space-y-6 relative z-10 w-full">
        <header className="flex justify-between items-center bg-[#121214] p-5 sm:p-6 rounded-lg shadow-sm border border-[#262626] flex-col sm:flex-row gap-4 sm:gap-0">
          <div className="flex flex-col sm:flex-row items-center sm:gap-6 gap-2 w-full sm:w-auto">
            <div className="flex items-center gap-3 border-b sm:border-b-0 sm:border-r border-[#262626] pb-3 sm:pb-0 sm:pr-6 w-full sm:w-auto justify-center sm:justify-start">
              <div className="w-3 h-3 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)] animate-pulse"></div>
              <h1 className="text-sm font-bold tracking-tight text-white uppercase mt-0">Borealis P2P</h1>
            </div>
            <p className="text-[10px] font-mono text-[#888] tracking-widest uppercase">SDE Protocol Simulation</p>
          </div>
          
          <div className="flex flex-wrap items-center justify-center gap-3">
            <input 
              type="file" 
              accept=".torrent"
              id="torrent-upload"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            <label 
              htmlFor="torrent-upload"
              className="cursor-pointer flex items-center gap-2 px-4 py-2 bg-[#262626] hover:bg-[#333] text-white border-0 rounded text-[10px] font-bold uppercase tracking-wider transition-colors max-w-[12rem] truncate"
            >
              <Upload className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{file ? file.name : "Select .torrent"}</span>
            </label>
            <button 
              onClick={handleUpload}
              disabled={!file}
              className="flex items-center gap-2 px-5 py-2 bg-[#3B82F6] text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-[10px] font-bold uppercase tracking-wider"
            >
              Start Engine
            </button>
            {state && (
              <button 
                onClick={handleStop}
                className="flex items-center gap-2 px-4 py-2 bg-[#3A1414] text-red-400 border border-red-900/50 rounded hover:bg-[#4A1A1A] transition-colors text-[10px] font-bold uppercase tracking-wider"
              >
                <StopCircle className="w-3.5 h-3.5 shrink-0" /> Stop
              </button>
            )}
          </div>
        </header>

        {error && (
          <div className="bg-[#1A1111] text-red-400 p-4 rounded-lg border border-red-900/50 text-xs font-mono uppercase tracking-wide">
            {error}
          </div>
        )}

        {state && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-[#0F0F11] p-5 rounded-lg border border-[#262626] flex items-center justify-between col-span-3 lg:col-span-1">
               <div className="flex flex-col justify-center">
                  <p className="text-[10px] font-bold text-[#555] uppercase tracking-[0.1em]">PROGRESS</p>
                  <p className="text-xl font-bold text-white mt-1.5 font-mono">{state.percent.toFixed(2)}%</p>
               </div>
               <div className="h-10 w-10 rounded-full bg-blue-900/20 border border-blue-900/50 flex items-center justify-center text-blue-400">
                 <RefreshCw className="w-5 h-5" />
               </div>
            </div>
            <div className="bg-[#0F0F11] p-5 rounded-lg border border-[#262626] flex items-center justify-between col-span-3 lg:col-span-1">
               <div className="flex flex-col justify-center">
                  <p className="text-[10px] font-bold text-[#555] uppercase tracking-[0.1em]">ACTIVE PEERS</p>
                  <p className="text-xl font-bold text-white mt-1.5 font-mono">{state.activePeers}</p>
               </div>
               <div className="h-10 w-10 rounded-full bg-emerald-900/20 border border-emerald-900/50 flex items-center justify-center text-emerald-400">
                 <Server className="w-5 h-5" />
               </div>
            </div>
            <div className="bg-[#0F0F11] p-5 rounded-lg border border-[#262626] flex items-center justify-between col-span-3 lg:col-span-1">
               <div className="flex flex-col justify-center">
                  <p className="text-[10px] font-bold text-[#555] uppercase tracking-[0.1em]">DOWNLOADED</p>
                  <p className="text-xl font-bold text-white mt-1.5 font-mono">
                    {formatBytes(state.downloaded)} <span className="text-[#555] text-sm">/ {formatBytes(state.totalLength)}</span>
                  </p>
               </div>
               <div className="h-10 w-10 rounded-full bg-indigo-900/20 border border-indigo-900/50 flex items-center justify-center text-indigo-400">
                 <Activity className="w-5 h-5" />
               </div>
            </div>

            {/* Pieces Grid & Activity Log */}
            <div className="col-span-3 lg:col-span-2 flex flex-col">
              <div className="bg-[#0F0F11] p-5 rounded-lg border border-[#262626] flex flex-col flex-1 h-[26rem] sm:h-[28rem]">
                <div className="flex items-center justify-between mb-4 border-b border-[#262626] pb-3">
                   <h2 className="text-[11px] font-bold text-[#D1D1D1] uppercase tracking-[0.1em] flex items-center gap-2">
                     <Box className="w-4 h-4 text-blue-500" /> Bitfield Map
                   </h2>
                   <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-[#555]">
                     <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded bg-[#1A1A1D]"></span> <span className="hidden sm:inline">Missing</span></span>
                     <span className="flex items-center gap-1.5 text-blue-400"><span className="w-2 h-2 rounded bg-blue-500"></span> <span className="hidden sm:inline">Downloading</span></span>
                     <span className="flex items-center gap-1.5 text-green-500"><span className="w-2 h-2 rounded bg-green-500"></span> <span className="hidden sm:inline">Verified</span></span>
                   </div>
                </div>
                <div className="bg-[#050505] border border-[#262626] p-2 flex-1 overflow-hidden">
                  <div className="grid grid-cols-[repeat(16,1fr)] sm:grid-cols-[repeat(20,1fr)] md:grid-cols-[repeat(30,1fr)] lg:grid-cols-[repeat(40,1fr)] gap-px auto-rows-max h-full overflow-y-auto content-start custom-scrollbar">
                    {state.pieceState.map((status, idx) => (
                      <div 
                        key={idx} 
                        title={`Piece ${idx}`}
                        className={`
                          w-full aspect-square transition-colors
                          ${status === 2 ? 'bg-green-500' : 
                            status === 1 ? 'bg-blue-500 animate-pulse' : 
                            'bg-[#1A1A1D]'}
                        `}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="col-span-3 lg:col-span-1 bg-[#121214] border border-[#262626] rounded-lg p-5 overflow-hidden flex flex-col h-[28rem]">
              <h2 className="text-[10px] font-bold text-[#555] mb-3 tracking-[0.1em] uppercase border-b border-[#262626] pb-3">Network Logs</h2>
              <div className="flex-1 overflow-y-auto font-mono text-[10px] custom-scrollbar pr-2">
                <div className="space-y-1.5 text-[#888]">
                  {logs.map((log, i) => (
                    <div key={i} className="break-all leading-relaxed whitespace-pre-wrap">
                      <span className="text-[#444] mr-2">[{new Date().toLocaleTimeString()}]</span> 
                      <span className="text-[#D1D1D1]" dangerouslySetInnerHTML={{__html: log.replace(/(FAILED|error)/gi, '<span class="text-red-400 font-bold">$1</span>').replace(/(Verified piece)/gi, '<span class="text-green-500">$1</span>')}} />
                    </div>
                  ))}
                  {logs.length === 0 && <p className="text-[#555] italic">Awaiting activity...</p>}
                </div>
              </div>
            </div>
            
          </div>
        )}
      </div>
    </div>
  );
}
