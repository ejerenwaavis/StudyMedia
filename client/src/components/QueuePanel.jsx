import React, { useState, useRef } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Trash2,
  Play,
  Pause,
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
  GripVertical,
  Plus,
  Pencil,
  X,
  AlertCircle,
  Square,
  CloudUpload,
  CloudDownload,
  Cloud,
  CloudOff,
  Users,
} from 'lucide-react';
import { formatTime } from '../utils/youtube';
import { formatBytes } from '../storage/mediaDB';
import { getExternalUrl, isAudioItem, TRUSTED_DOWNLOADERS } from '../utils/sourceDetector';
import { buildConverterUrl, DEFAULT_FALLBACK_CONVERTER_URL } from '../utils/sidecarClient';

function SortableQueueCard({
  item,
  idx,
  totalCount,
  isSortable,
  isActive,
  isOnline,
  sidecarConfigured,
  r2Configured,
  r2Transfer,
  canManageCloudItem,
  isExpanded,
  isCopied,
  isExtracting,
  downloadError,
  onSelectVideo,
  onMoveQueueItem,
  onRemove,
  onDeleteLocalFile,
  onUploadToR2,
  onSaveR2Offline,
  onDeleteFromR2,
  onCopyUrl,
  onToggleExpand,
  onOpenExternalConverter,
  onTriggerReplaceFile,
  onFetchViaSidecar,
  tab,
}) {
  const itemId = item.id || item.videoId;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: itemId, disabled: !isSortable });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
  };

  const offlineLocked = !isOnline && !item.isOfflineReady;
  const externalUrl = getExternalUrl(item);
  const audioOnly = isAudioItem(item);
  const pct =
    item.duration > 0
      ? Math.min(100, Math.round((item.lastPosition / item.duration) * 100))
      : 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => onSelectVideo(item)}
      className={`group relative cursor-pointer rounded-xl border p-2 transition-colors ${
        isDragging
          ? 'border-amber-400 bg-obsidian-800 shadow-2xl ring-1 ring-amber-400/50'
          : isActive
          ? 'border-amber-500/80 bg-amber-500/10 shadow-[0_0_15px_rgba(245,158,11,0.12)]'
          : 'border-zinc-800/80 bg-obsidian-950/70 hover:border-zinc-700 hover:bg-obsidian-850'
      } ${offlineLocked && !isDragging ? 'opacity-50' : ''}`}
    >
      <div className="flex items-start gap-2">
        {/* Dedicated Touch-Safe Drag Handle (touchAction: none ONLY on the grip!) */}
        {isSortable && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            style={{ touchAction: 'none' }}
            title="Drag to reorder"
            aria-label="Drag to reorder lecture"
            className="mt-1 flex h-12 w-5 shrink-0 cursor-grab items-center justify-center rounded-md text-zinc-600 transition hover:bg-obsidian-800 hover:text-zinc-300 active:cursor-grabbing active:text-amber-400"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}

        {/* Thumbnail */}
        <div className="relative flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-obsidian-800 sm:w-24">
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

          {isExtracting && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/65">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
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
            className={`line-clamp-2 pr-14 text-xs font-semibold leading-snug ${
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

            {item.isOfflineReady && (
              <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-400">
                <HardDrive className="h-2.5 w-2.5" />
                Offline Ready
                {item.sizeBytes ? ` • ${formatBytes(item.sizeBytes)}` : ''}
              </span>
            )}

            {item.r2Key && (
              <span className="inline-flex items-center gap-0.5 rounded bg-sky-500/15 px-1.5 py-0.5 font-semibold text-sky-300">
                <Cloud className="h-2.5 w-2.5" />
                Cloud Vault
              </span>
            )}

            {offlineLocked && (
              <span className="inline-flex items-center gap-0.5 rounded bg-zinc-800 px-1.5 py-0.5 font-medium text-zinc-400">
                <WifiOff className="h-2.5 w-2.5" />
                Requires Internet
              </span>
            )}

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

      {/* Per-item sequential download error badge */}
      {downloadError && !item.isOfflineReady && (
        <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-300">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span className="truncate">{downloadError}</span>
        </div>
      )}

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
            onClick={(e) => onCopyUrl(e, item)}
            className="inline-flex items-center gap-1 rounded-md bg-obsidian-800/90 px-2 py-0.5 text-[10px] font-medium text-zinc-300 transition hover:bg-obsidian-700 hover:text-white"
            title="Copy lecture URL"
          >
            {isCopied ? (
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
            onClick={() => onToggleExpand(itemId)}
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

      {/* Expanded Local Copy Drawer */}
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
              onClick={(e) => onOpenExternalConverter(e, item)}
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
              onClick={(e) => onTriggerReplaceFile(e, item)}
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

      {/* Cloud Vault & Local Offline Storage Controls Row */}
      {(item.isOfflineReady || item.r2Key) && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="mt-2 flex flex-wrap items-center justify-between gap-1.5 border-t border-zinc-800/60 pt-1.5"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Local item NOT yet in Cloud Vault -> Save to Cloud Vault */}
            {item.isOfflineReady && !item.r2Key && onUploadToR2 && (
              <button
                type="button"
                disabled={!isOnline || !r2Configured || Boolean(r2Transfer)}
                onClick={() => onUploadToR2(item)}
                title={
                  r2Configured
                    ? 'Upload to Cloudflare R2 Cloud Vault for cross-device streaming & sharing'
                    : 'Configure Cloudflare R2 credentials on server to enable Cloud Vault'
                }
                className="inline-flex items-center gap-1 rounded-md bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-300 transition hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {r2Transfer?.itemId === itemId && r2Transfer.type === 'upload' ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Uploading {r2Transfer.pct ?? 0}%
                  </>
                ) : (
                  <>
                    <CloudUpload className="h-3 w-3" />
                    Save to Cloud Vault
                  </>
                )}
              </button>
            )}

            {/* Cloud Vault item NOT yet in local IndexedDB -> Save Offline */}
            {item.r2Key && !item.isOfflineReady && onSaveR2Offline && (
              <button
                type="button"
                disabled={!isOnline || Boolean(r2Transfer)}
                onClick={() => onSaveR2Offline(item)}
                title="Download from Cloud Vault into local IndexedDB (0 R2 requests on future plays)"
                className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {r2Transfer?.itemId === itemId && r2Transfer.type === 'download' ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Saving {r2Transfer.pct != null ? `${r2Transfer.pct}%` : '...'}
                  </>
                ) : (
                  <>
                    <CloudDownload className="h-3 w-3" />
                    Save Offline
                  </>
                )}
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {item.r2Key && canManageCloudItem && onDeleteFromR2 && (
              <button
                type="button"
                disabled={!isOnline || Boolean(r2Transfer)}
                onClick={() => onDeleteFromR2(item)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium text-zinc-400 transition hover:bg-red-500/15 hover:text-red-400 disabled:opacity-40"
                title="Delete video from Cloudflare R2 Cloud Vault"
              >
                <CloudOff className="h-3 w-3" />
                Delete Cloud
              </button>
            )}

            {item.isOfflineReady && onDeleteLocalFile && (
              <button
                type="button"
                onClick={() => onDeleteLocalFile(item)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium text-zinc-400 transition hover:bg-red-500/15 hover:text-red-400"
                title="Delete local blob from IndexedDB to free device storage"
              >
                <FolderX className="h-3 w-3" />
                Delete Local
              </button>
            )}
          </div>
        </div>
      )}

      {/* One-Thumb Move Up / Down + Delete Controls */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-85 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
      >
        {tab === 'queue' && onMoveQueueItem && (
          <>
            {idx > 0 && (
              <button
                type="button"
                onClick={() => onMoveQueueItem(idx, idx - 1)}
                className="rounded bg-obsidian-800/95 p-1 text-zinc-400 hover:text-white"
                title="Move up"
              >
                <ChevronUp className="h-3 w-3" />
              </button>
            )}
            {idx < totalCount - 1 && (
              <button
                type="button"
                onClick={() => onMoveQueueItem(idx, idx + 1)}
                className="rounded bg-obsidian-800/95 p-1 text-zinc-400 hover:text-white"
                title="Move down"
              >
                <ChevronDown className="h-3 w-3" />
              </button>
            )}
          </>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={() => onRemove(itemId)}
            className="rounded bg-obsidian-800/95 p-1 text-zinc-400 hover:bg-red-500/20 hover:text-red-400"
            title={tab === 'queue' ? 'Remove from playlist' : 'Delete from history'}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

export default function QueuePanel({
  playlists = [],
  activePlaylistId,
  queue = [],
  history = [],
  activeItemId,
  currentUser = null,
  isOnline = true,
  sidecarConfigured = false,
  r2Configured = false,
  r2Transfer = null,
  fallbackConverterUrl = DEFAULT_FALLBACK_CONVERTER_URL,
  extractingItemId = null,
  localImportProgress = null,
  batchDownload = null,
  batchErrors = {},
  onSelectPlaylist,
  onCreatePlaylist,
  onRenamePlaylist,
  onDeletePlaylist,
  onToggleSharePlaylist,
  onSelectVideo,
  onRemoveFromQueue,
  onDeleteHistoryItem,
  onDeleteLocalFile,
  onUploadToR2,
  onSaveR2Offline,
  onDeleteFromR2,
  onMoveQueueItem,
  onReplaceWithLocalFile,
  onFetchViaSidecar,
  onStartPlaylistDownload,
  onTogglePausePlaylistDownload,
  onCancelPlaylistDownload,
  onNotify,
}) {
  const [tab, setTab] = useState('queue');
  const [expandedCopyId, setExpandedCopyId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [batchFormat, setBatchFormat] = useState('mp4');

  // Playlist creation / renaming inline state
  const [playlistFormMode, setPlaylistFormMode] = useState(null); // null | 'create' | 'rename'
  const [playlistNameDraft, setPlaylistNameDraft] = useState('');

  const replaceTargetRef = useRef(null);
  const replaceInputRef = useRef(null);

  const activePlaylist =
    playlists.find((p) => p.id === activePlaylistId) || playlists[0] || null;

  const pendingYouTubeCount = queue.filter(
    (item) =>
      item.sourceType === 'youtube' &&
      !item.isOfflineReady &&
      !String(item.id).startsWith('playlist:')
  ).length;

  const isBatchActiveForThisPlaylist = Boolean(
    batchDownload && batchDownload.playlistId === activePlaylist?.id
  );

  // Configure dnd-kit sensors (Pointer activation distance + TouchSensor on grip handle)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 120, tolerance: 5 },
    })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !onMoveQueueItem) return;
    const oldIndex = queue.findIndex((i) => (i.id || i.videoId) === active.id);
    const newIndex = queue.findIndex((i) => (i.id || i.videoId) === over.id);
    if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
      onMoveQueueItem(oldIndex, newIndex);
    }
  };

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

  const handlePlaylistFormSubmit = (e) => {
    e.preventDefault();
    const trimmed = playlistNameDraft.trim();
    if (!trimmed) return;
    if (playlistFormMode === 'create') {
      onCreatePlaylist?.(trimmed);
    } else if (playlistFormMode === 'rename' && activePlaylist) {
      onRenamePlaylist?.(activePlaylist.id, trimmed);
    }
    setPlaylistFormMode(null);
    setPlaylistNameDraft('');
  };

  const items = tab === 'queue' ? queue : history;
  const sortableIds = queue.map((i) => i.id || i.videoId);

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
            Playlists ({queue.length})
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

      {/* Named Playlist Switcher Bar (Queue Tab) */}
      {tab === 'queue' && (
        <div className="mb-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <select
              value={activePlaylist?.id || ''}
              onChange={(e) => onSelectPlaylist?.(e.target.value)}
              aria-label="Select active playlist"
              className="min-w-0 flex-1 truncate rounded-xl border border-zinc-800 bg-obsidian-950 px-2.5 py-2 text-xs font-semibold text-zinc-100 focus:border-amber-500/70 focus:outline-none"
            >
              {playlists.map((pl) => (
                <option key={pl.id} value={pl.id} className="bg-obsidian-950 text-zinc-100">
                  {pl.isOwner === false ? `[Shared] ${pl.name}` : pl.name} ({pl.items.length})
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => {
                setPlaylistFormMode('create');
                setPlaylistNameDraft('');
              }}
              title="New Playlist"
              className="flex shrink-0 items-center gap-1 rounded-xl border border-zinc-800 bg-obsidian-950 px-2 py-2 text-[11px] font-semibold text-amber-400 transition hover:border-amber-500/50 hover:bg-obsidian-800"
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">New</span>
            </button>

            {activePlaylist?.isOwner !== false && (
              <>
                <button
                  type="button"
                  onClick={() => activePlaylist && onToggleSharePlaylist?.(activePlaylist.id)}
                  title={
                    activePlaylist?.isSharedWithFriends
                      ? 'Shared with Friends (click to make private)'
                      : 'Private Playlist (click to share with friends)'
                  }
                  className={`shrink-0 rounded-xl border p-2 transition ${
                    activePlaylist?.isSharedWithFriends
                      ? 'border-sky-500/50 bg-sky-500/15 text-sky-300'
                      : 'border-zinc-800 bg-obsidian-950 text-zinc-400 hover:border-zinc-700 hover:text-white'
                  }`}
                >
                  <Users className="h-3.5 w-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!activePlaylist) return;
                    setPlaylistFormMode('rename');
                    setPlaylistNameDraft(activePlaylist.name);
                  }}
                  title="Rename Playlist"
                  className="shrink-0 rounded-xl border border-zinc-800 bg-obsidian-950 p-2 text-zinc-400 transition hover:border-zinc-700 hover:text-white"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>

                {playlists.filter((p) => p.isOwner !== false).length > 1 && (
                  <button
                    type="button"
                    onClick={() => activePlaylist && onDeletePlaylist?.(activePlaylist.id)}
                    title="Delete Playlist"
                    className="shrink-0 rounded-xl border border-zinc-800 bg-obsidian-950 p-2 text-zinc-400 transition hover:border-red-500/40 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </>
            )}
          </div>

          {activePlaylist?.isOwner === false && (
            <div className="flex items-center gap-1.5 rounded-lg border border-sky-500/25 bg-sky-500/10 px-2.5 py-1 text-[10px] font-semibold text-sky-300">
              <Users className="h-3 w-3" />
              <span>Shared by {activePlaylist.ownerName || 'Friend'}</span>
            </div>
          )}

          {/* Inline Create / Rename Form */}
          {playlistFormMode && (
            <form
              onSubmit={handlePlaylistFormSubmit}
              className="flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-obsidian-950 p-1.5"
            >
              <input
                type="text"
                autoFocus
                value={playlistNameDraft}
                onChange={(e) => setPlaylistNameDraft(e.target.value)}
                placeholder={
                  playlistFormMode === 'create' ? 'New playlist name...' : 'Rename playlist...'
                }
                className="min-w-0 flex-1 bg-transparent px-2 py-1 text-xs text-white placeholder-zinc-500 focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-lg bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-black hover:bg-amber-400"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setPlaylistFormMode(null);
                  setPlaylistNameDraft('');
                }}
                className="rounded-lg p-1 text-zinc-400 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </form>
          )}

          {/* Local Multi-File Import Progress */}
          {localImportProgress && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-medium text-emerald-300">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              <span className="truncate">
                Importing {localImportProgress.current} of {localImportProgress.total} files...
              </span>
            </div>
          )}

          {/* Sticky Sequential Offline Playlist Download Progress Bar */}
          {batchDownload && (
            <div className="sticky top-0 z-20 space-y-2 rounded-xl border border-emerald-500/40 bg-obsidian-950/95 p-2.5 shadow-lg backdrop-blur-md">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="flex min-w-0 items-center gap-1.5 font-semibold text-emerald-300">
                  {batchDownload.status === 'paused' ? (
                    <Pause className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  ) : (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  )}
                  <span className="truncate">
                    {batchDownload.status === 'paused'
                      ? `Paused • ${batchDownload.completed} of ${batchDownload.total}`
                      : `Downloading ${batchDownload.currentIndex} of ${batchDownload.total}${
                          batchDownload.itemPct != null ? ` • ${batchDownload.itemPct}%` : ''
                        }`}
                  </span>
                </span>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={onTogglePausePlaylistDownload}
                    title={batchDownload.status === 'paused' ? 'Resume download' : 'Pause after current'}
                    className="rounded-md border border-zinc-700 bg-obsidian-800 p-1 text-zinc-200 hover:border-amber-500/50 hover:text-amber-300"
                  >
                    {batchDownload.status === 'paused' ? (
                      <Play className="h-3 w-3 fill-current" />
                    ) : (
                      <Pause className="h-3 w-3" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={onCancelPlaylistDownload}
                    title="Cancel remaining downloads (completed files stay saved)"
                    className="rounded-md border border-red-500/30 bg-red-500/10 p-1 text-red-400 hover:bg-red-500/20"
                  >
                    <Square className="h-3 w-3 fill-current" />
                  </button>
                </div>
              </div>

              {batchDownload.activeItemTitle && (
                <p className="truncate text-[10px] text-zinc-400">
                  {batchDownload.phase === 'extracting' ? 'Extracting: ' : 'Saving: '}
                  {batchDownload.activeItemTitle}
                </p>
              )}

              <div className="h-1.5 w-full overflow-hidden rounded-full bg-obsidian-800">
                <div
                  className="h-full rounded-full bg-emerald-400 transition-all duration-300"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.round(
                        ((batchDownload.completed +
                          (batchDownload.itemPct != null ? batchDownload.itemPct / 100 : 0.25)) /
                          Math.max(1, batchDownload.total)) *
                          100
                      )
                    )}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Download Playlist Offline Trigger Bar (when playlist has online YouTube items) */}
          {!isBatchActiveForThisPlaylist && pendingYouTubeCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-1.5 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-2">
              <div className="flex rounded-lg bg-obsidian-950 p-0.5 text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => setBatchFormat('mp4')}
                  className={`rounded-md px-2 py-1 transition ${
                    batchFormat === 'mp4'
                      ? 'bg-emerald-500 text-black'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  MP4
                </button>
                <button
                  type="button"
                  onClick={() => setBatchFormat('mp3')}
                  className={`rounded-md px-2 py-1 transition ${
                    batchFormat === 'mp3'
                      ? 'bg-emerald-500 text-black'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  MP3
                </button>
              </div>
              <button
                type="button"
                disabled={Boolean(batchDownload)}
                onClick={() =>
                  activePlaylist && onStartPlaylistDownload?.(activePlaylist, batchFormat)
                }
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-bold text-emerald-300 ring-1 ring-emerald-500/35 transition hover:bg-emerald-500/25 disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" />
                Download Playlist Offline ({pendingYouTubeCount})
              </button>
            </div>
          )}
        </div>
      )}

      {/* Item List */}
      <div className="flex-1 space-y-2.5 overflow-y-auto pr-1">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 py-10 text-center">
            <p className="text-xs font-medium text-zinc-400">
              {tab === 'queue'
                ? `"${activePlaylist?.name || 'Study Queue'}" is empty`
                : 'No watch history yet'}
            </p>
            <p className="mt-1 px-4 text-[11px] text-zinc-600">
              Paste a YouTube, playlist, Vimeo, direct URL, or import local MP4/MP3 files above
            </p>
          </div>
        ) : tab === 'queue' ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              {queue.map((item, idx) => {
                const itemId = item.id || item.videoId;
                return (
                  <SortableQueueCard
                    key={itemId}
                    item={item}
                    idx={idx}
                    totalCount={queue.length}
                    isSortable={activePlaylist?.isOwner !== false}
                    isActive={itemId === activeItemId}
                    isOnline={isOnline}
                    sidecarConfigured={sidecarConfigured}
                    r2Configured={r2Configured}
                    r2Transfer={r2Transfer}
                    canManageCloudItem={
                      activePlaylist?.isOwner !== false || currentUser?.role === 'admin'
                    }
                    isExpanded={expandedCopyId === itemId}
                    isCopied={copiedId === itemId}
                    isExtracting={
                      extractingItemId === itemId || batchDownload?.activeItemId === itemId
                    }
                    downloadError={batchErrors[itemId] || item.downloadError}
                    onSelectVideo={onSelectVideo}
                    onMoveQueueItem={activePlaylist?.isOwner !== false ? onMoveQueueItem : null}
                    onRemove={activePlaylist?.isOwner !== false ? onRemoveFromQueue : null}
                    onDeleteLocalFile={onDeleteLocalFile}
                    onUploadToR2={onUploadToR2}
                    onSaveR2Offline={onSaveR2Offline}
                    onDeleteFromR2={onDeleteFromR2}
                    onCopyUrl={handleCopyUrl}
                    onToggleExpand={(id) =>
                      setExpandedCopyId((prev) => (prev === id ? null : id))
                    }
                    onOpenExternalConverter={handleOpenExternalConverter}
                    onTriggerReplaceFile={triggerReplaceFile}
                    onFetchViaSidecar={onFetchViaSidecar}
                    tab="queue"
                  />
                );
              })}
            </SortableContext>
          </DndContext>
        ) : (
          history.map((item, idx) => {
            const itemId = item.id || item.videoId;
            return (
              <SortableQueueCard
                key={itemId}
                item={item}
                idx={idx}
                totalCount={history.length}
                isSortable={false}
                isActive={itemId === activeItemId}
                isOnline={isOnline}
                sidecarConfigured={sidecarConfigured}
                r2Configured={r2Configured}
                r2Transfer={r2Transfer}
                canManageCloudItem={true}
                isExpanded={expandedCopyId === itemId}
                isCopied={copiedId === itemId}
                isExtracting={extractingItemId === itemId}
                downloadError={batchErrors[itemId] || item.downloadError}
                onSelectVideo={onSelectVideo}
                onMoveQueueItem={null}
                onRemove={onDeleteHistoryItem}
                onDeleteLocalFile={onDeleteLocalFile}
                onUploadToR2={onUploadToR2}
                onSaveR2Offline={onSaveR2Offline}
                onDeleteFromR2={onDeleteFromR2}
                onCopyUrl={handleCopyUrl}
                onToggleExpand={(id) =>
                  setExpandedCopyId((prev) => (prev === id ? null : id))
                }
                onOpenExternalConverter={handleOpenExternalConverter}
                onTriggerReplaceFile={triggerReplaceFile}
                onFetchViaSidecar={onFetchViaSidecar}
                tab="history"
              />
            );
          })
        )}
      </div>
    </aside>
  );
}
