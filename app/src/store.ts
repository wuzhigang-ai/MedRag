import type { Note } from './types';
import { v4 as uuidv4 } from 'uuid';
import { starterNotes, storageConfig } from './config';

const DEFAULT_NOTES_KEY = 'template-03-notes';

export function loadNotes(): Note[] {
  try {
    const raw = localStorage.getItem(storageConfig.notesKey || DEFAULT_NOTES_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore malformed storage
  }
  return getDefaultNotes();
}

export function saveNotes(notes: Note[]) {
  localStorage.setItem(storageConfig.notesKey || DEFAULT_NOTES_KEY, JSON.stringify(notes));
}

export function createNote(title: string, content: string, source?: string): Note {
  const now = Date.now();
  return { id: uuidv4(), title, content, createdAt: now, updatedAt: now, tags: [], source };
}

function getDefaultNotes(): Note[] {
  return starterNotes.map((note) => {
    const created = createNote(note.title, note.content, note.source);
    return {
      ...created,
      tags: note.tags ?? [],
    };
  });
}
