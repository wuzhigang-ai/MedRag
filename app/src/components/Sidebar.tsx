import { useState } from 'react';
import type { Note } from '../types';
import { sidebarConfig } from '../config';
import MoonPhase from './MoonPhase';

interface Props {
  notes: Note[];
  selectedId: string | null;
  search: string;
  onSearch: (q: string) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDeleteMany: (ids: string[]) => void;
}

export default function Sidebar({ notes, selectedId, search, onSearch, onSelect, onNew, onDeleteMany }: Props) {
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = search
    ? notes.filter((n) => n.title.toLowerCase().includes(search.toLowerCase()) || n.content.toLowerCase().includes(search.toLowerCase()))
    : notes;
  const sorted = [...filtered].sort((a, b) => b.updatedAt - a.updatedAt);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === sorted.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sorted.map((n) => n.id)));
    }
  };

  const handleDelete = () => {
    if (selected.size === 0) return;
    onDeleteMany([...selected]);
    setSelected(new Set());
    setManaging(false);
  };

  const exitManage = () => {
    setManaging(false);
    setSelected(new Set());
  };

  return (
    <aside className="liquid-glass w-60 shrink-0 h-full">
      <div className="h-full flex flex-col relative z-10">
        <MoonPhase />

        <div className="px-3 pb-3">
          <input
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={sidebarConfig.searchPlaceholder}
            className="w-full px-3 py-2 text-sm bg-white/[0.03] rounded-lg text-[#e0e0e0] placeholder:text-[#444] focus:outline-none focus:bg-white/[0.05] transition-colors"
          />
        </div>

        {managing && (
          <div className="px-3 pb-2 flex items-center justify-between">
            <button onClick={selectAll} className="text-xs text-[#888] hover:text-[#ccc] transition-colors">
              {selected.size === sorted.length ? sidebarConfig.clearSelectionLabel : sidebarConfig.selectAllLabel}
            </button>
            <span className="text-xs text-[#555]">{selected.size} {sidebarConfig.selectedCountSuffix}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2">
          {sorted.length === 0 && (
            <p className="text-center text-xs text-[#444] mt-8">{search ? sidebarConfig.noResultsLabel : sidebarConfig.emptyNotesLabel}</p>
          )}
          {sorted.map((note) => (
            <button
              key={note.id}
              onClick={() => (managing ? toggle(note.id) : onSelect(note.id))}
              className={`w-full text-left px-3 py-2 rounded-lg mb-0.5 transition-all flex items-center gap-2 ${
                managing
                  ? selected.has(note.id)
                    ? 'bg-red-500/10 text-[#e0e0e0]'
                    : 'text-[#888] hover:bg-white/[0.03]'
                  : note.id === selectedId
                    ? 'bg-white/[0.06] text-[#e0e0e0]'
                    : 'text-[#888] hover:bg-white/[0.03] hover:text-[#bbb]'
              }`}
            >
              {managing && (
                <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center text-[10px] ${
                  selected.has(note.id) ? 'bg-red-500/60 border-red-500/80 text-white' : 'border-[#555]'
                }`}>
                  {selected.has(note.id) && '✓'}
                </span>
              )}
              <div className="text-sm truncate">{note.title}</div>
            </button>
          ))}
        </div>

        <div className="p-3 flex flex-col gap-1.5">
          {managing ? (
            <div className="flex gap-1.5">
              <button
                onClick={handleDelete}
                disabled={selected.size === 0}
                className={`flex-1 px-3 py-2 text-xs rounded-xl transition-colors ${
                  selected.size > 0
                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                    : 'bg-white/[0.03] text-[#444] cursor-not-allowed'
                }`}
              >
                {sidebarConfig.deleteSelectedLabel} {selected.size > 0 ? `(${selected.size})` : ''}
              </button>
              <button
                onClick={exitManage}
                className="flex-1 px-3 py-2 text-xs rounded-xl text-[#888] bg-white/[0.03] hover:text-[#ccc] transition-colors"
              >
                {sidebarConfig.cancelLabel}
              </button>
            </div>
          ) : (
            <div className="flex gap-1.5">
              <button
                onClick={onNew}
                className="liquid-glass-strong flex-1 px-3 py-2 text-xs rounded-xl text-[#d4a574] hover:text-[#e0c0a0] transition-colors"
              >
                <span className="relative z-10">+ {sidebarConfig.newNoteLabel}</span>
              </button>
              <button
                onClick={() => setManaging(true)}
                className="px-3 py-2 text-xs rounded-xl text-[#555] hover:text-[#999] bg-white/[0.03] transition-colors"
              >
                {sidebarConfig.manageLabel}
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
