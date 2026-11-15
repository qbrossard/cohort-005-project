// PROTOTYPE tooling — the floating bar that flips between UI prototype variants.
// Deliberately loud so nobody mistakes it for part of the design being judged.

import { useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface PrototypeVariant {
  key: string;
  name: string;
}

export function PrototypeSwitcher({
  variants,
  current,
  onChange,
  children,
}: {
  variants: PrototypeVariant[];
  current: string;
  onChange: (key: string) => void;
  children?: React.ReactNode;
}) {
  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === current)
  );
  const step = (delta: number) =>
    onChange(variants[(index + delta + variants.length) % variants.length].key);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (process.env.NODE_ENV === "production") return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
      <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-full border-2 border-dashed border-fuchsia-400 bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-100 shadow-2xl">
        <span className="rounded-full bg-fuchsia-500 px-2 py-0.5 font-bold uppercase tracking-wide text-white">
          Prototype
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => step(-1)}
            className="rounded-full p-1 hover:bg-zinc-800"
            aria-label="Previous variant"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-36 text-center">
            <b>{variants[index].key}</b> ({variants[index].name})
          </span>
          <button
            onClick={() => step(1)}
            className="rounded-full p-1 hover:bg-zinc-800"
            aria-label="Next variant"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
