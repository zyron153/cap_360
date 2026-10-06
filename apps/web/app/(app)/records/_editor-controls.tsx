"use client";

import { useRef, useState, type KeyboardEvent } from "react";

export type Chip = { label: string; text: string };

/**
 * The quick phrases under a section, as a toolbar: a single tab stop for the whole row (a section can have five or
 * more phrases, and four sections used to put ~20 tab stops between the doctor and the next field), arrow keys /
 * Home / End to move along it, Enter or Space to add the phrase.
 */
export function PhraseToolbar({ label, chips, onPick }: { label: string; chips: Chip[]; onPick: (text: string) => void }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // The phrase list can shrink (the clinic's own phrases arrive after the suggested ones): keep the stop on a real chip.
  const current = Math.min(active, Math.max(chips.length - 1, 0));

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const last = chips.length - 1;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? (current + 1) % chips.length
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (current - 1 + chips.length) % chips.length
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : -1;
    if (next < 0) return;
    e.preventDefault();
    setActive(next);
    refs.current[next]?.focus();
  }

  return (
    <div role="toolbar" aria-label={label} aria-orientation="horizontal" className="flex flex-wrap gap-1.5 mt-2" onKeyDown={onKeyDown}>
      {chips.map((c, i) => (
        <button
          key={c.label}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          tabIndex={i === current ? 0 : -1}
          onFocus={() => setActive(i)}
          onClick={() => onPick(c.text)}
          className="text-[11px] text-dim-600 bg-dim-50 hover:bg-brand-50 hover:text-brand-800 border border-dim-100 rounded-full px-2.5 py-1 transition-colors text-left"
        >
          + {c.label}
        </button>
      ))}
    </div>
  );
}
