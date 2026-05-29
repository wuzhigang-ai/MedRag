import { useCallback, useMemo } from 'react';
import { trpc } from '@/providers/trpc';
import type { Note } from '@/types';

export function useNotes() {
  const utils = trpc.useUtils();

  const { data: dbNotes = [], isLoading } = trpc.notes.list.useQuery(
    undefined,
    {
      retry: false,
      refetchOnWindowFocus: false,
    }
  );

  const notes: Note[] = useMemo(() => {
    return dbNotes.map((n) => ({
      id: String(n.id),
      title: n.title,
      content: n.content,
      createdAt: n.createdAt?.getTime() ?? 0,
      updatedAt: n.updatedAt?.getTime() ?? 0,
      tags: (n.tags as string[]) ?? [],
      source: n.source ?? undefined,
    }));
  }, [dbNotes]);

  const createMutation = trpc.notes.create.useMutation({
    onSuccess: () => {
      utils.notes.list.invalidate();
    },
  });

  const updateMutation = trpc.notes.update.useMutation({
    onSuccess: () => {
      utils.notes.list.invalidate();
    },
  });

  const deleteMutation = trpc.notes.delete.useMutation({
    onSuccess: () => {
      utils.notes.list.invalidate();
    },
  });

  const deleteManyMutation = trpc.notes.deleteMany.useMutation({
    onSuccess: () => {
      utils.notes.list.invalidate();
    },
  });

  const createNote = useCallback(
    (title: string, content: string, source?: string) => {
      return new Promise<Note>((resolve, reject) => {
        createMutation.mutate(
          { title, content, tags: [], source },
          {
            onSuccess: (data) => {
              const now = Date.now();
              resolve({
                id: String(data.id),
                title,
                content,
                createdAt: now,
                updatedAt: now,
                tags: [],
                source,
              });
            },
            onError: (err) => {
              reject(err);
            },
          }
        );
      });
    },
    [createMutation]
  );

  const updateNote = useCallback(
    (id: string, updates: Partial<Note>) => {
      const numId = Number(id);
      if (isNaN(numId)) return;
      updateMutation.mutate({
        id: numId,
        ...(updates.title !== undefined ? { title: updates.title } : {}),
        ...(updates.content !== undefined ? { content: updates.content } : {}),
        ...(updates.tags !== undefined ? { tags: updates.tags } : {}),
        ...(updates.source !== undefined ? { source: updates.source } : {}),
      });
    },
    [updateMutation]
  );

  const deleteNote = useCallback(
    (id: string) => {
      const numId = Number(id);
      if (isNaN(numId)) return;
      deleteMutation.mutate({ id: numId });
    },
    [deleteMutation]
  );

  const deleteManyNotes = useCallback(
    (ids: string[]) => {
      const numIds = ids.map(Number).filter((n) => !isNaN(n));
      if (numIds.length === 0) return;
      deleteManyMutation.mutate({ ids: numIds });
    },
    [deleteManyMutation]
  );

  return {
    notes,
    isLoading,
    createNote,
    updateNote,
    deleteNote,
    deleteManyNotes,
  };
}
