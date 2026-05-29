import type { Note, GraphData, GraphNode, GraphEdge } from '../types';

/** Strip code blocks and inline code from text */
function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
}

/** Extract all [[wiki links]] from content (ignoring code blocks) */
export function extractLinks(content: string): string[] {
  const clean = stripCode(content);
  const re = /\[\[([^\]]+)\]\]/g;
  const links: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) links.push(m[1]);
  return [...new Set(links)];
}

/** Build graph data from all notes */
export function buildGraphData(notes: Note[]): GraphData {
  const byTitle = new Map<string, Note>();
  for (const n of notes) byTitle.set(n.title.toLowerCase(), n);

  const edgeKeys = new Set<string>();
  const edges: GraphEdge[] = [];
  const degree = new Map<string, number>();

  for (const note of notes) {
    for (const linkTitle of extractLinks(note.content)) {
      const target = byTitle.get(linkTitle.toLowerCase());
      if (target && target.id !== note.id) {
        const key = [note.id, target.id].sort().join('::');
        if (!edgeKeys.has(key)) {
          edgeKeys.add(key);
          edges.push({ source: note.id, target: target.id });
          degree.set(note.id, (degree.get(note.id) || 0) + 1);
          degree.set(target.id, (degree.get(target.id) || 0) + 1);
        }
      }
    }
  }

  const nodes: GraphNode[] = notes.map(n => ({
    id: n.id,
    title: n.title,
    linkCount: degree.get(n.id) || 0,
  }));

  return { nodes, edges };
}

/** Find notes that link TO the given note title */
export function getBacklinks(title: string, notes: Note[]): Note[] {
  const lower = title.toLowerCase();
  return notes.filter(n =>
    extractLinks(n.content).some(l => l.toLowerCase() === lower),
  );
}

/** Render content with [[links]] replaced for markdown — skips code blocks */
export function wikiLinksToMarkdown(content: string): string {
  return content.replace(
    /(```[\s\S]*?```|`[^`]*`)|(\[\[([^\]]+)\]\])/g,
    (_match, code, _wikiLink, title) => {
      if (code) return code;
      return `[${title}](wiki:${encodeURIComponent(title)})`;
    },
  );
}
