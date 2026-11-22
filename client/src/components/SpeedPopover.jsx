import React, { useState, useRef, useEffect } from 'react';
import { Gauge, Check } from 'lucide-react';

export const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

/**
 * Reusable direct-select playback speed popover menu.
 * Opens upward by default so bottom HUDs and mobile screens never clip options.
 */
export default function SpeedPopover({
  speed = 1,
  onSelectSpeed,
  onOpenChange,
  variant = 'study', // 'study' | 'hud' | 'car'
  align = 'right', // 'left' | 'right' | 'center'
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const setOpenState = (next) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpenState(false);
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') setOpenState(false);
    };
    document.addEventListener('pointerdown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const handleChoose = (rate) => {
    onSelectSpeed?.(rate);
    setOpenState(false);
  };

  const alignClass =
    align === 'left'
      ? 'left-0'
      : align === 'center'
      ? 'left-1/2 -translate-x-1/2'
      : 'right-0';

  const triggerClass =
    variant === 'car'
      ? 'flex h-14 w-full items-center justify-center gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 font-mono text-sm font-bold text-amber-400 transition hover:bg-amber-500/20'
      : variant === 'hud'
      ? 'rounded-full border border-white/15 bg-black/45 px-2.5 py-1.5 font-mono text-xs font-semibold text-zinc-100 transition hover:border-amber-400/60 hover:bg-white/15'
      : 'rounded-full border border-zinc-700 bg-obsidian-800 px-3.5 py-1.5 font-mono text-xs font-semibold text-zinc-200 transition hover:border-amber-500/60 hover:text-white';

  return (
    <div
      ref={rootRef}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className={`relative ${variant === 'car' ? 'col-span-2 sm:col-span-1' : 'inline-block'}`}
    >
      <button
        type="button"
        onClick={() => setOpenState(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Select playback speed"
        className={triggerClass}
      >
        {variant === 'car' && <Gauge className="h-4 w-4" />}
        <span>{variant === 'car' ? `Speed: ${speed}x` : `${speed}x`}</span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Playback speed options"
          className={`absolute bottom-full ${alignClass} z-50 mb-2 w-32 overflow-hidden rounded-xl border border-zinc-700/90 bg-obsidian-950/95 p-1 shadow-2xl backdrop-blur-md`}
        >
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Speed
          </div>
          <div className="grid grid-cols-1 gap-0.5">
            {SPEED_OPTIONS.map((rate) => {
              const active = Number(speed) === rate;
              return (
                <button
                  key={rate}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => handleChoose(rate)}
                  className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 font-mono text-xs font-semibold transition ${
                    active
                      ? 'bg-amber-500 text-black'
                      : 'text-zinc-200 hover:bg-obsidian-800 hover:text-white'
                  }`}
                >
                  <span>{rate}x</span>
                  {active && <Check className="h-3.5 w-3.5" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
