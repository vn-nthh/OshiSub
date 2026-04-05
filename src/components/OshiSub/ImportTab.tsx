// ImportTab.tsx — Video import with drag-and-drop, preview, and metadata

import { useRef, useState, useCallback } from 'react';

interface ImportTabProps {
  onVideoImported: (file: File, duration: number) => void;
  videoFile: File | null;
  videoObjectUrl: string | null;
}

const ACCEPTED = 'video/*,.mp4,.mkv,.webm,.mov,.avi,.ts,.m2ts,.wmv';

function FilmIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
      <line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/>
      <line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/>
      <line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/>
      <line x1="17" y1="7" x2="22" y2="7"/>
    </svg>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function ImportTab({ onVideoImported, videoFile, videoObjectUrl }: ImportTabProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [localDuration, setLocalDuration] = useState(0);

  const handleFile = useCallback((file: File) => {
    const isVideo = file.type.startsWith('video/') || /\.(mp4|mkv|webm|mov|avi|ts|m2ts|wmv)$/i.test(file.name);
    if (!isVideo) { alert('Please drop a video file.'); return; }

    // Create temp URL to get duration
    const url = URL.createObjectURL(file);
    const vid = document.createElement('video');
    vid.preload = 'metadata';
    vid.src = url;
    vid.onloadedmetadata = () => {
      const dur = vid.duration;
      URL.revokeObjectURL(url);
      setLocalDuration(dur);
      onVideoImported(file, dur);
    };
    vid.onerror = () => {
      URL.revokeObjectURL(url);
      onVideoImported(file, 0);
    };
  }, [onVideoImported]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const duration = localDuration || 0;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflow: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {!videoFile ? (
          /* Drop zone */
          <div
            className={`drop-zone${isDragOver ? ' drag-over' : ''}`}
            style={{ flex: 1, minHeight: 240 }}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            <FilmIcon />
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
                {isDragOver ? 'Drop to import' : 'Drop video here'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                or click to browse — MP4, MKV, WebM, MOV, AVI, TS...
              </div>
            </div>
          </div>
        ) : (
          /* Video preview + metadata */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} className="fadein">
            {/* Preview player */}
            <div className="video-player-wrap" style={{ maxWidth: 640, width: '100%', alignSelf: 'center' }}>
              {videoObjectUrl && (
                <video
                  ref={videoRef}
                  src={videoObjectUrl}
                  controls
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  onLoadedMetadata={(e) => setLocalDuration((e.target as HTMLVideoElement).duration)}
                />
              )}
            </div>

            {/* Metadata card */}
            <div className="panel" style={{ maxWidth: 640, width: '100%', alignSelf: 'center' }}>
              <div className="panel-label">File Info</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
                <MetaRow label="Filename" value={videoFile.name} />
                <MetaRow label="Size" value={formatBytes(videoFile.size)} />
                <MetaRow label="Type" value={videoFile.type || 'video/unknown'} />
                {duration > 0 && (
                  <MetaRow
                    label="Duration"
                    value={`${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}`}
                  />
                )}
              </div>
            </div>

            <div style={{ maxWidth: 640, width: '100%', alignSelf: 'center' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                Video imported. You've been moved to the{' '}
                <strong style={{ color: 'var(--accent)' }}>Cut</strong> tab — set your cut points, then proceed to{' '}
                <strong style={{ color: 'var(--accent)' }}>Transcribe</strong>.
              </div>
            </div>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text)', wordBreak: 'break-all' }}>{value}</div>
    </div>
  );
}
