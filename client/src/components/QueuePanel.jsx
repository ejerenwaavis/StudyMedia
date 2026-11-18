import React, { useState } from 'react';
import { Trash2, Play, Clock, ListVideo, History, ChevronUp, ChevronDown } from 'lucide-react';
import { formatTime, getThumbnailUrl } from '../utils/youtube';

export default function QueuePanel({
  queue,
  history,
  activeVideoId,
  onSelectVideo,
  onRemoveFromQueue,
  onDeleteHistoryItem,
  onMoveQueueItem,
}) {
  const [tab, setTab] = useState('queue');

  const items = tab === 'queue' ? queue : history;

  return (
    <aside className="flex h-full flex-col rounded-2xl border border-zinc-800/80 bg-obsidian-900/90 p-4">
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
            <p className="mt-1 text-[11px] text-zinc-600">
              Paste a YouTube lecture URL above to begin
            </p>
          </div>
        ) : (
          items.map((item, idx) => {
            const isActive = item.videoId === activeVideoId;
            const pct =
              item.duration > 0 ? Math.min(100, Math.round((item.lastPosition / item.duration) * 100)) : 0;

            return (
              <div
                key={item.videoId}
                onClick={() => onSelectVideo(item)}
                className={`group relative cursor-pointer rounded-xl border p-2 transition-all ${
                  isActive
                    ? 'border-amber-500/80 bg-amber-500/10 shadow-[0_0_15px_rgba(245,158,11,0.12)]'
                    : 'border-zinc-800/80 bg-obsidian-950/70 hover:border-zinc-700 hover:bg-obsidian-850'
                }`}
              >
                <div className="flex gap-2.5">
                  {/* Thumbnail */}
                  <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-obsidian-800">
                    <img
                      src={item.thumbnail || getThumbnailUrl(item.videoId)}
                      alt={item.title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
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
                      className={`line-clamp-2 text-xs font-semibold leading-snug ${
                        isActive ? 'text-amber-300' : 'text-zinc-200'
                      }`}
                    >
                      {item.title || `Lecture (${item.videoId})`}
                    </p>

                    <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-500">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {item.duration > 0 ? `${pct}% • ${formatTime(item.duration)}` : 'Ready'}
                      </span>
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
                        ? onRemoveFromQueue(item.videoId)
                        : onDeleteHistoryItem(item.videoId)
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
