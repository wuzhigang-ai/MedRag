import { useState, useEffect, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Note } from '../types';
import { editorConfig } from '../config';
import { getBacklinks, wikiLinksToMarkdown, extractLinks } from '../utils/linkParser';

interface Props {
  note: Note;
  allNotes: Note[];
  onUpdate: (id: string, updates: Partial<Note>) => void;
  onDelete: (id: string) => void;
  onNavigate: (title: string) => void;
}

export default function NoteEditor({ note, allNotes, onUpdate, onDelete, onNavigate }: Props) {
  const [mode, setMode] = useState<'edit' | 'preview'>('preview');
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Only reset mode when switching notes (id changes), not on content updates
  useEffect(() => {
    setTitle(note.title);
    setContent(note.content);
    setMode('preview');
    setConfirmDelete(false);
  }, [note.id]);

  // Sync title from parent only (e.g., rename via sidebar).
  // Do NOT overwrite content here — during editing the local state is the
  // source of truth, and overwriting it causes the textarea cursor to jump.
  useEffect(() => {
    setTitle(note.title);
  }, [note.title]);

  useEffect(() => {
    if (title === note.title && content === note.content) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      onUpdate(note.id, { title, content, updatedAt: Date.now() });
    }, 400);
    return () => clearTimeout(timer.current);
  }, [title, content, note.id, note.title, note.content, onUpdate]);

  const backlinks = useMemo(
    () => getBacklinks(note.title, allNotes).filter((n) => n.id !== note.id),
    [note.title, note.id, allNotes],
  );

  const outLinks = useMemo(() => {
    return extractLinks(note.content).map((t) => ({
      title: t,
      exists: allNotes.some((n) => n.title.toLowerCase() === t.toLowerCase()),
    }));
  }, [note.content, allNotes]);

  const mdContent = useMemo(() => wikiLinksToMarkdown(content), [content]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      onUpdate(note.id, { title, content, updatedAt: Date.now() });
      setMode('preview');
    }
  };

  return (
    <div className="h-full flex flex-col" onKeyDown={handleKeyDown}>
      <div className="flex items-center gap-2 px-6 py-2.5 border-b border-white/[0.04]">
        <div className="flex bg-white/[0.03] rounded-lg p-0.5">
          {(['edit', 'preview'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                mode === m ? 'bg-white/[0.08] text-[#e0e0e0]' : 'text-[#555] hover:text-[#999]'
              }`}
            >
              {m === 'edit' ? editorConfig.editLabel : editorConfig.previewLabel}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {note.source && (
          <a href={note.source} target="_blank" rel="noopener noreferrer" className="text-xs text-accent/60 hover:text-accent truncate max-w-40">
            {editorConfig.sourceLabel}
          </a>
        )}
        {confirmDelete ? (
          <div className="flex items-center gap-1.5">
            <button onClick={() => onDelete(note.id)} className="px-2 py-1 text-xs rounded bg-danger/20 text-danger">{editorConfig.deleteLabel}</button>
            <button onClick={() => setConfirmDelete(false)} className="px-2 py-1 text-xs text-[#555]">{editorConfig.cancelLabel}</button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="text-xs text-[#333] hover:text-danger transition-colors">{editorConfig.deleteLabel}</button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-8 py-8">
          {mode === 'edit' ? (
            <>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full text-xl font-semibold bg-transparent border-none outline-none text-[#e0e0e0] mb-6 placeholder:text-[#333]"
                placeholder={editorConfig.titlePlaceholder}
              />
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full min-h-[50vh] bg-transparent border-none outline-none text-[#999] resize-none leading-relaxed font-mono text-sm placeholder:text-[#333]"
                placeholder={editorConfig.contentPlaceholder}
              />
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-[#e0e0e0] mb-6">{title}</h1>
              <div className="md-body">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  urlTransform={(url) => url}
                  components={{
                    a: ({ href, children }) => {
                      if (href?.startsWith('wiki:')) {
                        return (
                          <span className="wiki-link" onClick={() => onNavigate(decodeURIComponent(href.slice(5)))}>
                            {children}
                          </span>
                        );
                      }
                      return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
                    },
                  }}
                >
                  {mdContent}
                </ReactMarkdown>
              </div>

              {(outLinks.length > 0 || backlinks.length > 0) && (
                <div className="mt-10 pt-6 border-t border-white/[0.04] flex gap-6 flex-wrap text-xs">
                  {outLinks.length > 0 && (
                    <div>
                      <span className="text-[#444] mr-2">{editorConfig.outgoingLinksLabel}</span>
                      {outLinks.map((l) => (
                        <button
                          key={l.title}
                          onClick={() => onNavigate(l.title)}
                          className={`mr-2 ${l.exists ? 'text-link/70 hover:text-link' : 'text-[#444] hover:text-[#666]'} transition-colors`}
                        >
                          {l.title}
                        </button>
                      ))}
                    </div>
                  )}
                  {backlinks.length > 0 && (
                    <div>
                      <span className="text-[#444] mr-2">{editorConfig.incomingLinksLabel}</span>
                      {backlinks.map((bl) => (
                        <button
                          key={bl.id}
                          onClick={() => onNavigate(bl.title)}
                          className="mr-2 text-link/70 hover:text-link transition-colors"
                        >
                          {bl.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
