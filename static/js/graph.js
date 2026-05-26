/* ============================================================
   MedASR — Knowledge Graph (Cytoscape.js)
   Professional biomedical entity-relationship visualization.
   Exposes Graph3D on window for admin.js compatibility.
   ============================================================ */

const PALETTE = {
    '疾病': '#ef4444', '药物': '#10b981', '治疗': '#3b82f6',
    '检查': '#f59e0b', '症状': '#ec4899', '解剖': '#8b5cf6',
    '指标': '#06b6d4', '指南': '#6366f1', '基因': '#f97316',
    'default': '#94a3b8'
};

const SHAPES = {
    '疾病': 'diamond', '药物': 'round-rectangle', '治疗': 'ellipse',
    '检查': 'hexagon', '症状': 'triangle', '指标': 'rectangle',
    'default': 'ellipse'
};

class Graph3D {
    constructor(container) {
        this.container = container;
        this.cy = null;
        this._nodes = [];
        this._edges = [];
    }

    loadGraph(data) {
        if (!data || !data.nodes) return;
        this._nodes = data.nodes;
        this._edges = data.edges || [];
        this._render();
    }

    _render() {
        // Clear container
        this.container.innerHTML = '';

        // Map nodes to Cytoscape format
        const elements = [];
        const nodeMap = {};

        this._nodes.forEach((n, i) => {
            const group = (n.group || 'default');
            const color = PALETTE[group] || PALETTE['default'];
            const shape = SHAPES[group] || SHAPES['default'];
            const id = n.id || `n${i}`;
            nodeMap[id] = n;
            elements.push({
                data: {
                    id: id,
                    label: (n.label || id).substring(0, 40),
                    group: group,
                    color: color,
                    shape: shape,
                    fullLabel: n.label || id,
                    docCount: n.doc_count || n.docCount || 0,
                    weight: n.weight || 1
                }
            });
        });

        this._edges.forEach((e, i) => {
            const src = e.source || e.from || '';
            const tgt = e.target || e.to || '';
            if (src && tgt) {
                elements.push({
                    data: {
                        id: e.id || `e${i}`,
                        source: src,
                        target: tgt,
                        label: (e.label || e.relation || '').substring(0, 30),
                        weight: e.weight || 1
                    }
                });
            }
        });

        // Create Cytoscape instance
        this.cy = cytoscape({
            container: this.container,
            elements: elements,
            style: [
                // ── Node style ──
                { selector: 'node', style: {
                    'background-color': 'data(color)',
                    'shape': 'data(shape)',
                    'width': 'mapData(weight, 1, 10, 20, 60)',
                    'height': 'mapData(weight, 1, 10, 20, 60)',
                    'label': 'data(label)',
                    'color': '#e2e8f0',
                    'font-size': '9px',
                    'text-valign': 'bottom',
                    'text-halign': 'center',
                    'text-margin-y': 6,
                    'text-wrap': 'wrap',
                    'text-max-width': '80px',
                    'border-width': 2,
                    'border-color': 'data(color)',
                    'border-opacity': 0.5,
                    'text-background-color': '#0f172a',
                    'text-background-opacity': 0.7,
                    'text-background-padding': '2px',
                    'text-background-shape': 'roundrectangle',
                }},
                // ── Edge style ──
                { selector: 'edge', style: {
                    'width': 'mapData(weight, 1, 5, 0.5, 3)',
                    'line-color': '#475569',
                    'target-arrow-color': '#475569',
                    'target-arrow-shape': 'triangle',
                    'arrow-scale': 0.8,
                    'curve-style': 'bezier',
                    'label': 'data(label)',
                    'color': '#94a3b8',
                    'font-size': '7px',
                    'text-rotation': 'autorotate',
                }},
                // ── Hover ──
                { selector: 'node:hover', style: {
                    'border-width': 4,
                    'border-color': '#60a5fa',
                    'border-opacity': 1,
                    'z-index': 9999,
                }},
                { selector: 'edge:hover', style: {
                    'width': 5,
                    'line-color': '#60a5fa',
                    'target-arrow-color': '#60a5fa',
                    'z-index': 9999,
                }},
                // ── Selected ──
                { selector: 'node:selected', style: {
                    'border-width': 4,
                    'border-color': '#f59e0b',
                    'background-color': '#f59e0b',
                }},
                // ── Neighbor highlight ──
                { selector: '.neighbor', style: {
                    'border-width': 3,
                    'border-color': '#60a5fa',
                    'border-opacity': 0.8,
                }},
                { selector: '.neighbor-edge', style: {
                    'line-color': '#60a5fa',
                    'target-arrow-color': '#60a5fa',
                }},
            ],
            layout: {
                name: 'cose',
                animate: true,
                animationDuration: 2000,
                nodeRepulsion: () => 8000,
                idealEdgeLength: () => 120,
                gravity: 0.25,
                numIter: 3000,
                initialTemp: 200,
                coolingFactor: 0.95,
            },
            wheelSensitivity: 0.3,
            minZoom: 0.1,
            maxZoom: 3,
        });

        // ── Click: highlight neighbors ──
        this.cy.on('tap', 'node', (evt) => {
            const node = evt.target;
            const neighborhood = node.closedNeighborhood();
            this.cy.elements().removeClass('neighbor neighbor-edge');
            neighborhood.nodes().addClass('neighbor');
            neighborhood.edges().addClass('neighbor-edge');
        });

        this.cy.on('tap', (evt) => {
            if (evt.target === this.cy) {
                this.cy.elements().removeClass('neighbor neighbor-edge');
            }
        });

        // ── Tooltip ──
        const tooltip = document.createElement('div');
        tooltip.className = 'graph-tooltip';
        tooltip.style.cssText = 'display:none;position:absolute;z-index:100;background:rgba(15,23,42,0.95);color:#e2e8f0;padding:8px 12px;border-radius:6px;font-size:12px;pointer-events:none;max-width:220px;border:1px solid rgba(59,130,246,0.3);';
        this.container.appendChild(tooltip);

        this.cy.on('mouseover', 'node', (evt) => {
            const n = evt.target.data();
            tooltip.innerHTML = `<strong style="color:${n.color}">${n.group}</strong><br>${n.fullLabel}<br>📄 ${n.docCount} 篇文献`;
            tooltip.style.display = 'block';
        });
        this.cy.on('mousemove', (evt) => {
            tooltip.style.left = (evt.renderedPosition.x + 16) + 'px';
            tooltip.style.top = (evt.renderedPosition.y - 40) + 'px';
        });
        this.cy.on('mouseout', 'node', () => { tooltip.style.display = 'none'; });

        // ── Expose for external access ──
        this.container._cy = this.cy;
    }

    addNodesWithAnimation(newNodes) {
        if (!this.cy || !newNodes) return;
        newNodes.forEach(n => {
            const group = n.group || 'default';
            this.cy.add({
                group: 'nodes',
                data: {
                    id: n.id, label: (n.label || n.id).substring(0, 40),
                    group: group, color: PALETTE[group] || PALETTE['default'],
                    shape: SHAPES[group] || SHAPES['default'],
                    fullLabel: n.label || n.id, weight: n.weight || 1, docCount: n.doc_count || n.docCount || 0
                }
            });
        });
        this.cy.layout({ name: 'cose', animate: true, animationDuration: 1000, randomize: false }).run();
    }

    addEdgesWithAnimation(newEdges) {
        if (!this.cy || !newEdges) return;
        var added = false;
        newEdges.forEach(e => {
            if (e.source && e.target) {
                this.cy.add({
                    group: 'edges',
                    data: { id: e.id || `e_${Date.now()}_${Math.random()}`, source: e.source, target: e.target, label: (e.label || '').substring(0, 30), weight: e.weight || 1 }
                });
                added = true;
            }
        });
        if (added) this.cy.layout({ name: 'cose', animate: true, animationDuration: 800, randomize: false, fit: false }).run();
    }

    getStats() {
        return { nodes: this.cy ? this.cy.nodes().length : 0, edges: this.cy ? this.cy.edges().length : 0 };
    }
}

window.Graph3D = Graph3D;
