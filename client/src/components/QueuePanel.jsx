import React, { useState, useRef } from 'react';
import {
  Trash2,
  Play,
  Clock,
  ListVideo,
  History,
  ChevronUp,
  ChevronDown,
  HardDrive,
  WifiOff,
  Copy,
  Check,
  Download,
  Upload,
  ExternalLink,
  Music,
  Film,
  Server,
  Loader2,
  FolderX,
} from 'lucide-react';
import { formatTime } from '../utils/youtube';
import { formatBytes } from '../storage/mediaDB';
import { getExternalUrl, isAudioItem, TRUSTED_DOWNLOADERS } from '../utils/sourceDetector';
import { buildConverterUrl, DEFAULT_FALLBACK_CONVERTER_URL } from '../utils/sidecarClient';

export default function QueuePanel({
  queue,
  history,
  activeItemId,
  isOnline = true,
  sidecarConfigured = false,
  fallbackConverterUrl = DEFAULT_FALLBACK_CONVERTER_URL,
  extractingItemId = null,
  onSelectVideo,
  onRemoveFromQueue,
  onDeleteHistoryItem,
  onDeleteLocalFile,
  onMoveQueueItem,
  onReplaceWithLocalFile,
  onFetchViaSidecar,
  onNotify,
}) {
  const [tab, setTab] = useState('queue');
  const [expandedCopyId, setExpandedCopyId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const replaceTargetRef = useRef(null);
  const replaceInputRef = useRef(null);

  const items = tab === 'queue' ? queue : history;

  const handleCopyUrl = async (e, item) => {
    e.stopPropagation();
    const url = getExternalUrl(item);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedId(item.id);
    onNotify?.('Link copied!', 'success');
    setTimeout(() => setCopiedId((prev) => (prev === item.id ? null : prev)), 2000);
  };

  const handleOpenExternalConverter = async (e, item) => {
    e.stopPropagation();
    const url = getExternalUrl(item);
    if (url) {
      await handleCopyUrl(e, item);
    }
    const rawId = item.youtubeVideoId || item.videoId || item.id || '';
    const target = buildConverterUrl(
      fallbackConverterUrl || DEFAULT_FALLBACK_CONVERTER_URL,
      url || '',
      rawId.startsWith('playlist:') ? '' : rawId
    );
    window.open(target, '_blank', 'noopener,noreferrer');
  };

  const triggerReplaceFile = (e, item) => {
    e.stopPropagation();
    replaceTargetRef.current = item;
    replaceInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file && replaceTargetRef.current && onReplaceWithLocalFile) {
      onReplaceWithLocalFile(replaceTargetRef.current, file);
      setExpandedCopyId(null);
    }
    replaceTargetRef.current = null;
  };

  return (
    <aside className="flex h-full flex-col rounded-2xl border border-zinc-800/80 bg-obsidian-900/90 p-4">
      {/* Hidden input for upgrading any queue/history item to a local copy */}
      <input
        ref={replaceInputRef}
        type="file"
        accept="video/*,audio/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Tabs */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex w-full rounded-xl bg-obsidian-950 p-1">
          <button
            type="button"
            onClick={() => setTab('queue')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition ${
              tab === 'queue'
                ? 'bg-obsidian-800 text-amber-400 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <ListVideo className="h-3.5 w-3.5" />
            Queue ({queue.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('history')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition ${
              tab === 'history'
                ? 'bg-obsidian-800 text-amber-400 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <History className="h-3.5 w-3.5" />
            History ({history.length})
          </button>
        </div>
      </div>

      {/* Item List */}
      <div className="flex-1 space-y-2.5 overflow-y-auto pr-1">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 py-10 text-center">
            <p className="text-xs font-medium text-zinc-400">
              {tab === 'queue' ? 'Your study queue is empty' : 'No watch history yet'}
            </p>
            <p className="mt-1 px-4 text-[11px] text-zinc-600">
              Paste a YouTube, Vimeo, playlist, direct URL, or import a local MP4/MP3 above
            </p>
          </div>
        ) : (
          items.map((item, idx) => {
            const itemId = item.id || item.videoId;
            const isActive = itemId === activeItemId;
            const offlineLocked = !isOnline && !item.isOfflineReady;
            const externalUrl = getExternalUrl(item);
            const isExpanded = expandedCopyId === itemId;
            const isExtracting = extractingItemId === itemId;
            const audioOnly = isAudioItem(item);
            const pct =
              item.duration > 0
                ? Math.min(100, Math.round((item.lastPosition / item.duration) * 100))
                : 0;

            return (
              <div
                key={itemId}
                onClick={() => onSelectVideo(item)}
                className={`group relative cursor-pointer rounded-xl border p-2 transition-all ${
                  isActive
                    ? 'border-amber-500/80 bg-amber-500/10 shadow-[0_0_15px_rgba(245,158,11,0.12)]'
                    : 'border-zinc-800/80 bg-obsidian-950/70 hover:border-zinc-700 hover:bg-obsidian-850'
                } ${offlineLocked ? 'opacity-50' : ''}`}
              >
                <div className="flex gap-2.5">
                  {/* Thumbnail */}
                  <div className="relative flex h-14 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-obsidian-800">
                    {item.thumbnail ? (
                      <img
                        src={item.thumbnail}
                        alt={item.title}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : audioOnly ? (
                      <Music className="h-5 w-5 text-amber-400/80" />
                    ) : (
                      <Film className="h-5 w-5 text-zinc-500" />
                    )}

                    {isActive && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                        <Play className="h-4 w-4 fill-amber-400 text-amber-400" />
                      </div>
                    )}

                    {item.lastPosition > 0 && (
                      <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 font-mono text-[10px] font-medium text-zinc-200">
                        {formatTime(item.lastPosition)}
                      </span>
                    )}
                  </div>

                  {/* Metadata */}
                  <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
                    <p
                      className={`line-clamp-2 pr-12 text-xs font-semibold leading-snug ${
                        isActive ? 'text-amber-300' : 'text-zinc-200'
                      }`}
                    >
                      {item.title || `Lecture (${itemId})`}
                    </p>

                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {item.duration > 0 ? `${pct}% • ${formatTime(item.duration)}` : 'Ready'}
                      </span>

                      {/* Offline Ready Badge */}
                      {item.isOfflineReady && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-400">
                          <HardDrive className="h-2.5 w-2.5" />
                          Offline Ready
                          {item.sizeBytes ? ` • ${formatBytes(item.sizeBytes)}` : ''}
                        </span>
                      )}

                      {/* Requires Internet label when offline */}
                      {offlineLocked && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-zinc-800 px-1.5 py-0.5 font-medium text-zinc-400">
                          <WifiOff className="h-2.5 w-2.5" />
                          Requires Internet
                        </span>
                      )}

                      {/* Source badge for non-YouTube online sources */}
                      {!item.isOfflineReady && item.sourceType === 'vimeo' && (
                        <span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-medium text-sky-400">
                          Vimeo
                        </span>
                      )}
                      {!item.isOfflineReady && item.sourceType === 'direct' && (
                        <span className="rounded bg-purple-500/15 px-1.5 py-0.5 font-medium text-purple-300">
                          Direct
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Progress bar */}
                {pct > 0 && (
                  <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-amber-400 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}

                {/* Quick Local Copy / Downloader Utility Row for Online Items */}
                {!item.isOfflineReady && externalUrl && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-zinc-800/60 pt-1.5"
                  >
                    <button
                      type="button"
                      onClick={(e) => handleCopyUrl(e, item)}
                      className="inline-flex items-center gap-1 rounded-md bg-obsidian-800/90 px-2 py-0.5 text-[10px] font-medium text-zinc-300 transition hover:bg-obsidian-700 hover:text-white"
                      title="Copy lecture URL"
                    >
                      {copiedId === itemId ? (
                        <>
                          <Check className="h-2.5 w-2.5 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-2.5 w-2.5" />
                          Copy URL
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setExpandedCopyId(isExpanded ? null : itemId)}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium transition ${
                        isExpanded
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-obsidian-800/90 text-zinc-300 hover:bg-obsidian-700 hover:text-white'
                      }`}
                      title="Download & import local offline copy"
                    >
                      <Download className="h-2.5 w-2.5" />
                      Local Copy
                    </button>

                    {sidecarConfigured && item.sourceType === 'youtube' && (
                      <button
                        type="button"
                        disabled={isExtracting}
                        onClick={() => onFetchViaSidecar?.(item, 'mp4')}
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 transition hover:bg-emerald-500/25 disabled:opacity-60"
                        title="Extract via Home Sidecar directly to IndexedDB"
                      >
                        {isExtracting ? (
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        ) : (
                          <Server className="h-2.5 w-2.5" />
                        )}
                        {isExtracting ? 'Fetching...' : 'Sidecar'}
                      </button>
                    )}
                  </div>
                )}

                {/* Expanded Local Copy Drawer: Trusted Downloaders + Direct Import */}
                {isExpanded && !item.isOfflineReady && externalUrl && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="mt-2 space-y-2 rounded-lg border border-zinc-800 bg-obsidian-950 p-2.5 text-[11px]"
                  >
                    <p className="text-[10px] text-zinc-400">
                      1. Auto-copy URL &amp; download, 2. Import to upgrade this item offline:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => handleOpenExternalConverter(e, item)}
                        className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-1 text-[10px] font-bold text-amber-300 hover:bg-amber-500/25"
                      >
                        <ExternalLink className="h-2.5 w-2.5" />
                        Open External Downloader
                      </button>
                      {TRUSTED_DOWNLOADERS.slice(0, 2).map((dl) => (
                        <a
                          key={dl.name}
                          href={dl.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={dl.description}
                          className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-obsidian-800 px-2 py-1 text-[10px] font-medium text-zinc-300 hover:text-white"
                        >
                          <ExternalLink className="h-2.5 w-2.5" />
                          {dl.name}
                        </a>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={(e) => triggerReplaceFile(e, item)}
                        className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2.5 py-1 text-[10px] font-bold text-black hover:bg-amber-400"
                      >
                        <Upload className="h-3 w-3" />
                        Import Downloaded File
                      </button>
                      {sidecarConfigured && item.sourceType === 'youtube' && (
                        <button
                          type="button"
                          disabled={isExtracting}
                          onClick={() => onFetchViaSidecar?.(item, 'mp3')}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-500/20"
                        >
                          <Server className="h-2.5 w-2.5" />
                          Sidecar MP3
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Per-item Delete Local File link for Offline Ready items */}
                {item.isOfflineReady && onDeleteLocalFile && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="mt-2 flex items-center justify-end border-t border-zinc-800/60 pt-1.5"
                  >
                    <button
                      type="button"
                      onClick={() => onDeleteLocalFile(item)}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium text-zinc-400 transition hover:bg-red-500/15 hover:text-red-400"
                      title="Delete local blob from IndexedDB to free device storage"
                    >
                      <FolderX className="h-3 w-3" />
                      Delete Local File
                    </button>
                  </div>
                )}

                {/* Hover Action Controls */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-1.5 top-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  {tab === 'queue' && onMoveQueueItem && (
                    <>
                      {idx > 0 && (
                        <button
                          type="button"
                          onClick={() => onMoveQueueItem(idx, idx - 1)}
                          className="rounded bg-obsidian-800/90 p-1 text-zinc-400 hover:text-white"
                          title="Move up"
                        >
                          <ChevronUp className="h-3 w-3" />
                        </button>
                      )}
                      {idx < items.length - 1 && (
                        <button
                          type="button"
                          onClick={() => onMoveQueueItem(idx, idx + 1)}
                          className="rounded bg-obsidian-800/90 p-1 text-zinc-400 hover:text-white"
                          title="Move down"
                        >
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      tab === 'queue'
                        ? onRemoveFromQueue(itemId)
                        : onDeleteHistoryItem(itemId)
                    }
                    className="rounded bg-obsidian-800/90 p-1 text-zinc-400 hover:bg-red-500/20 hover:text-red-400"
                    title={tab === 'queue' ? 'Remove from queue' : 'Delete from history'}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
