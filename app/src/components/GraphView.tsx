import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import type { GraphData } from '../types';
import { graphConfig } from '../config';

interface Props {
  data: GraphData;
  onNodeClick: (id: string) => void;
  selectedNodeId?: string | null;
}

const COLORS = [
  '#c8956c', '#d4a574', '#b8845e', '#a07050',
  '#c0a080', '#d09060', '#b09070', '#c8a888',
];

export default function GraphView({ data, onNodeClick, selectedNodeId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const stableClick = useCallback(onNodeClick, [onNodeClick]);

  useEffect(() => {
    const container = containerRef.current;
    const svgEl = svgRef.current;
    if (!container || !svgEl || data.nodes.length === 0) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    const svg = d3.select(svgEl).attr('width', width).attr('height', height);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');
    const filter = defs.append('filter').attr('id', 'glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    filter.append('feGaussianBlur').attr('stdDeviation', '5').attr('result', 'blur');
    const merge = filter.append('feMerge');
    merge.append('feMergeNode').attr('in', 'blur');
    merge.append('feMergeNode').attr('in', 'SourceGraphic');

    const g = svg.append('g');
    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.15, 5]).on('zoom', (e) => g.attr('transform', e.transform));
    svg.call(zoom);

    const nodes = data.nodes.map((d) => ({ ...d }));
    const links = data.edges.map((d) => ({ ...d }));

    const sim = d3.forceSimulation(nodes as any)
      .force('link', d3.forceLink(links).id((d: any) => d.id).distance(160).strength(0.35))
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius((d: any) => nr(d) + 10))
      .force('x', d3.forceX(width / 2).strength(0.03))
      .force('y', d3.forceY(height / 2).strength(0.03));

    function nr(d: any) { return Math.max(5, Math.sqrt(d.linkCount + 1) * 5.5); }

    const link = g.append('g').selectAll('line').data(links).enter().append('line')
      .attr('stroke', 'rgba(200,149,108,0.12)')
      .attr('stroke-width', 1);

    const node = g.append('g').selectAll<SVGGElement, any>('g').data(nodes).enter().append('g')
      .style('cursor', 'pointer')
      .call(d3.drag<SVGGElement, any>()
        .on('start', (e) => { if (!e.active) sim.alphaTarget(0.3).restart(); e.subject.fx = e.subject.x; e.subject.fy = e.subject.y; })
        .on('drag', (e) => { e.subject.fx = e.x; e.subject.fy = e.y; })
        .on('end', (e) => { if (!e.active) sim.alphaTarget(0); e.subject.fx = null; e.subject.fy = null; }));

    node.append('circle')
      .attr('r', nr)
      .attr('fill', (_, i) => COLORS[i % COLORS.length])
      .attr('fill-opacity', 0.7)
      .attr('stroke', (d: any) => d.id === selectedNodeId ? 'rgba(212,165,116,0.6)' : 'transparent')
      .attr('stroke-width', 2)
      .attr('filter', 'url(#glow)');

    node.append('text')
      .text((d: any) => (d.title.length > 14 ? `${d.title.slice(0, 13)}…` : d.title))
      .attr('dx', (d: any) => nr(d) + 6)
      .attr('dy', 4)
      .attr('fill', '#777')
      .attr('font-size', '11px')
      .attr('pointer-events', 'none');

    node.on('click', (_, d: any) => stableClick(d.id));

    node.on('mouseover', function (_, d: any) {
      d3.select(this).select('circle').attr('fill-opacity', 1).attr('stroke', 'rgba(212,165,116,0.6)');
      link
        .attr('stroke', (l: any) => l.source.id === d.id || l.target.id === d.id ? 'rgba(200,149,108,0.35)' : 'rgba(200,149,108,0.03)')
        .attr('stroke-width', (l: any) => l.source.id === d.id || l.target.id === d.id ? 1.5 : 0.5);
      node.select('circle').attr('fill-opacity', (n: any) => {
        if (n.id === d.id) return 1;
        return links.some((l: any) => (l.source.id === d.id && l.target.id === n.id) || (l.target.id === d.id && l.source.id === n.id)) ? 0.8 : 0.15;
      });
      node.select('text').attr('fill-opacity', (n: any) => {
        if (n.id === d.id) return 1;
        return links.some((l: any) => (l.source.id === d.id && l.target.id === n.id) || (l.target.id === d.id && l.source.id === n.id)) ? 1 : 0.15;
      });
    });

    node.on('mouseout', () => {
      node.select('circle').attr('fill-opacity', 0.7).attr('stroke', (d: any) => d.id === selectedNodeId ? 'rgba(212,165,116,0.6)' : 'transparent');
      node.select('text').attr('fill-opacity', 1);
      link.attr('stroke', 'rgba(200,149,108,0.12)').attr('stroke-width', 1);
    });

    // Constrain nodes within SVG bounds to prevent clipping
    const padding = 30;
    sim.on('tick', () => {
      nodes.forEach((d: any) => {
        const r = nr(d) + padding;
        d.x = Math.max(r, Math.min(width - r, d.x));
        d.y = Math.max(r, Math.min(height - r, d.y));
      });
      link.attr('x1', (d: any) => d.source.x).attr('y1', (d: any) => d.source.y).attr('x2', (d: any) => d.target.x).attr('y2', (d: any) => d.target.y);
      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });

    return () => { sim.stop(); };
  }, [data, stableClick, selectedNodeId]);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <svg ref={svgRef} className="w-full h-full" />
      <div className="liquid-glass absolute bottom-10 left-4 rounded-xl px-4 py-2.5 w-fit">
        <div className="relative z-10 text-xs text-[#666] space-y-0.5">
          <div><span className="text-[#999]">{data.nodes.length}</span> {graphConfig.notesLabel} · <span className="text-[#999]">{data.edges.length}</span> {graphConfig.connectionsLabel}</div>
        </div>
      </div>
      {data.nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-[#333] text-sm">{graphConfig.emptyGraphLabel}</div>
      )}
    </div>
  );
}
