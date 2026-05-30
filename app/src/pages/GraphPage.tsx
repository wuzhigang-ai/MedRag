/**
 * GraphPage — Obsidian Graph View level knowledge graph.
 * Cinema-quality: force-directed circular layout, full state system,
 * local/global views, real-time search dimming, export, theme-aware.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/providers/trpc";
import { FiSearch, FiZoomIn, FiZoomOut, FiMaximize, FiDownload, FiFilter, FiSliders, FiInfo } from "react-icons/fi";

const ntColors: Record<string, string> = {
  disease: "#E84D4D", drug: "#3B82F6", symptom: "#F07850", treatment: "#10B981",
  clinical_indicator: "#8B5CF6", anatomy: "#06B6D4", procedure: "#EC4899",
  gene: "#7C3AED", pathogen: "#DC2626", other: "#64748B",
};
const ntLabels: Record<string, string> = { disease:"疾病",drug:"药物",symptom:"症状",treatment:"治疗",clinical_indicator:"指标",anatomy:"解剖",procedure:"手术",gene:"基因",pathogen:"病原体",other:"其他" };
const rtLabels: Record<string, string> = { treats:"治疗",causes:"导致",associated_with:"相关",contraindicated:"禁忌",diagnoses:"诊断",prevents:"预防",symptom_of:"症状",interacts_with:"相互作用",related_to:"关联" };

interface GNode { id:number|string; label:string; nodeType:string; group?:string; x:number;y:number;vx:number;vy:number; description?:string|null; occurrenceCount?:number|null; icd10Code?:string|null; meshTerm?:string|null; weight?:number; }
interface GEdge { id:number; source:number; target:number; relationType:string; strength:number|null; }

/* ── Theme color resolver (tested dark + light) ── */
let _tcCache: any = null;
function getTC() {
  const s = getComputedStyle(document.documentElement);
  const bg = s.getPropertyValue("--bg-base").trim();
  const isDark = !bg || parseInt(bg.replace("#",""),16) < 0x888888;
  _tcCache = {
    bg: bg || "#0c1222", text: s.getPropertyValue("--tx-700").trim() || (isDark?"#c8d5e8":"#1e293b"),
    textMuted: s.getPropertyValue("--tx-300").trim() || (isDark?"#7a8db0":"#64748b"),
    surface: s.getPropertyValue("--bg-surface").trim() || (isDark?"#1a2235":"#ffffff"),
    edge: isDark?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.08)",
    edgeHi: isDark?"rgba(255,255,255,0.25)":"rgba(0,0,0,0.25)",
    dot: isDark?"rgba(255,255,255,0.03)":"rgba(0,0,0,0.04)",
    isDark,
  };
  return _tcCache;
}

export default function GraphPage() {
  const cvRef = useRef<HTMLCanvasElement>(null); const ctrRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<GNode|null>(null);
  const [search, setSearch] = useState(""); const [filter, setFilter] = useState("");
  const [selNode, setSelNode] = useState<GNode|null>(null);
  const [zoom, setZoom] = useState(1); const [pan, setPan] = useState({x:0,y:0});
  const [dragging, setDragging] = useState(false); const [dragStart, setDragStart] = useState({x:0,y:0});
  const [localMode, setLocalMode] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [forces, setForces] = useState({ center:50, repel:50, link:50 });
  const [showLabels, setShowLabels] = useState(true);

  const { data: gd } = trpc.knowledge.getGraph.useQuery();
  const { data: stats } = trpc.knowledge.stats.useQuery();

  // Compute node link counts
  const linkCounts: Record<string,number> = {};
  (gd?.edges??[]).forEach((e:any) => {
    const s = String(e.source??e.sourceNodeId??""), t = String(e.target??e.targetNodeId??"");
    linkCounts[s]=(linkCounts[s]||0)+1; linkCounts[t]=(linkCounts[t]||0)+1;
  });

  const nodes: GNode[] = (gd?.nodes??[]).map((n:any) => ({
    ...n, id:n.id??Math.random(), label:n.label??"?", nodeType:n.nodeType??"other",
    x:300+Math.random()*400, y:200+Math.random()*300, vx:0, vy:0,
    weight: linkCounts[String(n.id)]??0,
  }));

  const edges: GEdge[] = (gd?.edges??[]).map((e:any)=>({
    ...e, source:e.sourceNodeId??e.source??0, target:e.targetNodeId??e.target??0,
  }));

  const nodeTypeStats: Record<string,number> = {};
  nodes.forEach(n=>{nodeTypeStats[n.nodeType]=(nodeTypeStats[n.nodeType]||0)+1;});

  // ── Force simulation + Canvas render ──
  useEffect(()=>{
    if(!nodes.length||!cvRef.current) return;
    const cv=cvRef.current, ctx=cv.getContext("2d")!; let aid:number;
    const dpr = devicePixelRatio||1;
    const resize=()=>{const c=ctrRef.current;if(c){cv.width=c.clientWidth*dpr;cv.height=c.clientHeight*dpr;cv.style.width=c.clientWidth+"px";cv.style.height=c.clientHeight+"px";ctx.setTransform(dpr,0,0,dpr,0,0);}};
    resize();window.addEventListener("resize",resize);

    const sn = JSON.parse(JSON.stringify(nodes)) as GNode[];
    const se = edges.map(e=>({...e,sn:sn.find(n=>n.id===e.source)!,tn:sn.find(n=>n.id===e.target)!})).filter(e=>e.sn&&e.tn);
    const searchLow = search.toLowerCase();

    // Local mode: filter to selected node + 1-hop neighbors
    let visibleSet = new Set(sn.map(n=>n.id));
    if(localMode && selNode){
      const neighborIds = new Set([selNode.id]);
      se.forEach(e=>{if(e.source===selNode.id)neighborIds.add(e.target);if(e.target===selNode.id)neighborIds.add(e.source);});
      visibleSet = neighborIds;
    }
    if(filter) visibleSet = new Set([...visibleSet].filter(id=>sn.find(n=>n.id===id)?.nodeType===filter));
    if(search) visibleSet = new Set([...visibleSet].filter(id=>{
      const n = sn.find(nn=>nn.id===id); return n && n.label.toLowerCase().includes(searchLow);
    }));

    const sim = ()=>{
      const W=cv.width/dpr, H=cv.height/dpr, cx=W/2, cy=H/2, maxR=Math.min(W,H)*0.44;
      for(let i=0;i<sn.length;i++){for(let j=i+1;j<sn.length;j++){
        const a=sn[i],b=sn[j],dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1;
        const f=(2000+(forces.repel-50)*40)/(d*d);
        a.vx-=(dx/d)*f;a.vy-=(dy/d)*f;b.vx+=(dx/d)*f;b.vy+=(dy/d)*f;
      }}
      for(const e of se){if(!e.sn||!e.tn)continue;
        const dx=e.tn.x-e.sn.x,dy=e.tn.y-e.sn.y,d=Math.sqrt(dx*dx+dy*dy)||1;
        const f=(d-100)*0.002*(forces.link/50);
        e.sn.vx+=(dx/d)*f;e.sn.vy+=(dy/d)*f;e.tn.vx-=(dx/d)*f;e.tn.vy-=(dy/d)*f;
      }
      for(const n of sn){
        const dx=cx-n.x,dy=cy-n.y,dist=Math.sqrt(dx*dx+dy*dy)||1;
        n.vx+=(dx/dist)*dist*0.0006*(forces.center/50);
        n.vy+=(dy/dist)*dist*0.0006*(forces.center/50);
        if(dist>maxR){const over=dist-maxR;n.vx-=(dx/dist)*over*0.02;n.vy-=(dy/dist)*over*0.02;}
        n.vx*=0.82;n.vy*=0.82;n.x+=n.vx;n.y+=n.vy;
        n.x+=(Math.max(10,Math.min(W-10,n.x))-n.x)*0.05;
        n.y+=(Math.max(10,Math.min(H-10,n.y))-n.y)*0.05;
      }
    };

    const draw = ()=>{
      sim(); const tc = getTC(); const W=cv.width/dpr, H=cv.height/dpr;
      ctx.clearRect(0,0,W,H);
      // Radial bg
      const bgG=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,Math.max(W,H)*0.7);
      bgG.addColorStop(0,tc.surface+"30");bgG.addColorStop(0.5,tc.bg);bgG.addColorStop(1,tc.bg);
      ctx.fillStyle=bgG;ctx.fillRect(0,0,W,H);
      // Dot grid
      ctx.fillStyle=tc.dot;const gs=50;
      for(let x=((pan.x%gs)+gs)%gs;x<W;x+=gs)for(let y=((pan.y%gs)+gs)%gs;y<H;y+=gs)ctx.fillRect(x,y,0.8,0.8);

      ctx.save();ctx.translate(pan.x,pan.y);ctx.scale(zoom,zoom);

      // Edges
      for(const e of se){
        const a=e.sn,b=e.tn;if(!a||!b)continue;
        const aVis=visibleSet.has(a.id),bVis=visibleSet.has(b.id);
        if(!aVis&&!bVis)continue;
        const isHighlighted = (selNode&&(a.id===selNode.id||b.id===selNode.id))||(hoverRef.current&&(a.id===hoverRef.current.id||b.id===hoverRef.current.id));
        const isDimmed = (selNode||hoverRef.current)&&!isHighlighted;
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
        ctx.strokeStyle=isHighlighted?tc.edgeHi:isDimmed?"rgba(100,100,120,0.03)":tc.edge;
        ctx.lineWidth=isHighlighted?1.8:0.6;ctx.stroke();
        if(!isDimmed&&zoom>0.55){
          const mx=(a.x+b.x)/2,my=(a.y+b.y)/2,lbl=rtLabels[e.relationType]||e.relationType;
          ctx.font="8px Inter,system-ui,sans-serif";const tw=ctx.measureText(lbl).width;
          ctx.fillStyle=tc.surface;ctx.fillRect(mx-tw/2-2,my-4,tw+4,9);
          ctx.fillStyle=tc.textMuted+"99";ctx.textAlign="center";ctx.fillText(lbl,mx,my+3);
        }
      }

      // Nodes
      for(const n of sn){
        if(!visibleSet.has(n.id))continue;
        const isSel=selNode?.id===n.id, isHover=hoverRef.current?.id===n.id;
        const isDimmed = (selNode||hoverRef.current)&&!isSel&&!isHover;
        const color=ntColors[n.nodeType]||ntColors.other;
        const linkCount = n.weight??0;
        const baseR = Math.max(5, Math.min(20, 8 + linkCount*1.5));
        const r = isSel||isHover ? baseR*1.2 : baseR;
        const alpha = isDimmed?0.25:1;

        ctx.globalAlpha = alpha;
        // Glow
        if(isSel||isHover){
          ctx.beginPath();ctx.arc(n.x,n.y,r+12,0,Math.PI*2);
          const gG=ctx.createRadialGradient(n.x,n.y,r,n.x,n.y,r+12);
          gG.addColorStop(0,color+"30");gG.addColorStop(1,"transparent");
          ctx.fillStyle=gG;ctx.fill();
          ctx.beginPath();ctx.arc(n.x,n.y,r+4,0,Math.PI*2);
          ctx.strokeStyle=color+"50";ctx.lineWidth=2;ctx.stroke();
        }
        // Orb
        ctx.beginPath();ctx.arc(n.x,n.y,r,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
        ctx.beginPath();ctx.arc(n.x-r*0.25,n.y-r*0.25,r*0.3,0,Math.PI*2);
        ctx.fillStyle="rgba(255,255,255,0.25)";ctx.fill();
        // Label
        if(showLabels&&(zoom>0.3||isSel||isHover)){
          ctx.globalAlpha = isDimmed?0.3:1;
          ctx.font="9px Inter,system-ui,sans-serif";
          const lw=ctx.measureText(n.label).width, ly=n.y+r+10;
          ctx.fillStyle=tc.surface+"cc";ctx.fillRect(n.x-lw/2-3,ly-7,lw+6,13);
          ctx.fillStyle=isSel?color:tc.text;ctx.textAlign="center";ctx.fillText(n.label,n.x,ly+2);
        }
      }
      ctx.globalAlpha=1;ctx.restore();
      aid=requestAnimationFrame(draw);
    };
    draw();
    return ()=>{cancelAnimationFrame(aid);window.removeEventListener("resize",resize);};
  },[nodes.length,edges.length,selNode,zoom,pan,filter,search,localMode,forces,showLabels]);

  // ── Interactions ──
  const hitTest = useCallback((ex:number,ey:number):GNode|null=>{
    const cv=cvRef.current;if(!cv)return null;
    const r= cv.getBoundingClientRect();
    const x=(ex-r.left-pan.x)/zoom, y=(ey-r.top-pan.y)/zoom;
    for(const n of nodes){const rad=10+Math.min(20,8+(n.weight??0)*1.5);if((x-n.x)**2+(y-n.y)**2<rad*rad)return n;}
    return null;
  },[nodes,zoom,pan]);

  const handleClick = useCallback((e:React.MouseEvent<HTMLCanvasElement>)=>{
    const n=hitTest(e.clientX,e.clientY);setSelNode(n);
    if(n&&!localMode)setLocalMode(true);
    if(!n){setSelNode(null);setLocalMode(false);}
  },[hitTest,localMode]);

  const handleMove = useCallback((e:React.MouseEvent<HTMLCanvasElement>)=>{
    hoverRef.current = hitTest(e.clientX,e.clientY);
    const cv=cvRef.current;if(cv)cv.style.cursor=hoverRef.current?"pointer":dragging?"grabbing":"grab";
  },[hitTest,dragging]);

  const handleDblClick = useCallback((e:React.MouseEvent<HTMLCanvasElement>)=>{
    const n=hitTest(e.clientX,e.clientY);
    if(n)window.open(`/admin/library?id=${n.id}`,"_blank");
  },[hitTest]);

  const handleWheel=useCallback((e:React.WheelEvent)=>{e.preventDefault();setZoom(z=>Math.max(0.15,Math.min(5,z*(e.deltaY>0?0.92:1.08))));},[]);
  const handleMD=useCallback((e:React.MouseEvent)=>{setDragging(true);setDragStart({x:e.clientX-pan.x,y:e.clientY-pan.y});},[pan]);
  const handleMM=useCallback((e:React.MouseEvent)=>{if(!dragging)return;setPan({x:e.clientX-dragStart.x,y:e.clientY-dragStart.y});},[dragging,dragStart]);
  const handleMU=useCallback(()=>setDragging(false),[]);

  const exportPNG = useCallback(()=>{
    const cv=cvRef.current;if(!cv)return;
    const a=document.createElement("a");a.download="knowledge-graph.png";
    a.href=cv.toDataURL("image/png");a.click();
  },[]);

  return (
    <div style={{display:"flex",gap:12,height:"100%"}}>
      <div style={{flex:1,display:"flex",flexDirection:"column",gap:10,minWidth:0}}>
        {/* Toolbar */}
        <div className="m-card" style={{padding:"6px 12px",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <div style={{position:"relative",flexShrink:0}}>
            <FiSearch size={12} style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:"var(--tx-100)",zIndex:1}}/>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索节点..." className="m-input" style={{paddingLeft:28,height:28,fontSize:11,width:160}}/>
          </div>
          <select value={filter} onChange={e=>setFilter(e.target.value)} className="m-input" style={{height:28,fontSize:11,width:100,cursor:"pointer"}}>
            <option value="">全部类型</option>{Object.entries(ntLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}
          </select>
          <button onClick={()=>{setLocalMode(!localMode);if(!localMode&&selNode)setSelNode(null);}} className="m-btn m-btn-ghost" style={{fontSize:10,height:28,padding:"0 10px",background:localMode?"var(--m-cyan)22":"",color:localMode?"var(--m-cyan)":""}}>
            <FiFilter size={11} style={{marginRight:4}}/>{localMode?"局部图谱":"全局图谱"}
          </button>
          <button onClick={()=>setShowLabels(!showLabels)} className="m-btn m-btn-ghost" style={{fontSize:10,height:28,padding:"0 8px",opacity:showLabels?1:0.5}}>标签</button>
          <div style={{flex:1}}/>
          <div style={{display:"flex",gap:3}}>
            <button onClick={()=>setZoom(z=>Math.min(5,z*1.2))} className="m-btn m-btn-ghost" style={{width:26,height:26,padding:0}}><FiZoomIn size={12}/></button>
            <button onClick={()=>setZoom(z=>Math.max(0.15,z*0.8))} className="m-btn m-btn-ghost" style={{width:26,height:26,padding:0}}><FiZoomOut size={12}/></button>
            <button onClick={()=>{setZoom(1);setPan({x:0,y:0});}} className="m-btn m-btn-ghost" style={{width:26,height:26,padding:0}}><FiMaximize size={12}/></button>
            <button onClick={exportPNG} className="m-btn m-btn-ghost" style={{width:26,height:26,padding:0}} title="导出PNG"><FiDownload size={12}/></button>
            <button onClick={()=>setShowPanel(!showPanel)} className="m-btn m-btn-ghost" style={{width:26,height:26,padding:0,background:showPanel?"var(--m-cyan)22":"",color:showPanel?"var(--m-cyan)":""}}><FiSliders size={12}/></button>
          </div>
        </div>

        {/* Canvas */}
        <div ref={ctrRef} style={{flex:1,borderRadius:10,overflow:"hidden",background:"var(--bg-base)",border:"1px solid var(--bd-100)",position:"relative",minHeight:400}}>
          <canvas ref={cvRef} onClick={handleClick} onDoubleClick={handleDblClick} onMouseMove={handleMove} onWheel={handleWheel} onMouseDown={handleMD} onMouseMoveCapture={handleMM} onMouseUp={handleMU} onMouseLeave={handleMU}
            style={{width:"100%",height:"100%",display:"block"}}/>
          <div style={{position:"absolute",bottom:10,left:10,display:"flex",gap:5,pointerEvents:"none"}}>
            <span style={{fontSize:9,padding:"3px 7px",borderRadius:5,background:"var(--bg-surface)",border:"1px solid var(--bd-100)",color:"var(--tx-300)",fontFamily:"monospace"}}>{nodes.length} 节点</span>
            <span style={{fontSize:9,padding:"3px 7px",borderRadius:5,background:"var(--bg-surface)",border:"1px solid var(--bd-100)",color:"var(--tx-300)",fontFamily:"monospace"}}>{edges.length} 关系</span>
            {localMode&&<span style={{fontSize:9,padding:"3px 7px",borderRadius:5,background:"var(--bg-surface)",border:"1px solid var(--m-cyan)",color:"var(--m-cyan)",fontFamily:"monospace"}}>局部视图</span>}
          </div>
        </div>
      </div>

      {/* Right side: Legend + Node detail + Force panel */}
      <div style={{width:220,flexShrink:0,display:"flex",flexDirection:"column",gap:10,overflow:"auto"}}>
        {/* Legend */}
        <div className="m-card" style={{padding:10}}>
          <div style={{fontSize:10,fontWeight:700,color:"var(--tx-700)",marginBottom:6}}>节点类型</div>
          {Object.entries(ntLabels).filter(([k])=>(nodeTypeStats[k]||0)>0).map(([k,v])=>(
            <div key={k} onClick={()=>setFilter(filter===k?"":k)} style={{display:"flex",alignItems:"center",gap:5,padding:"2px 5px",borderRadius:4,cursor:"pointer",background:filter===k?"var(--bg-hover)":"transparent",fontSize:10}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:ntColors[k],flexShrink:0}}/>
              <span style={{flex:1,color:"var(--tx-500)"}}>{v}</span>
              <span style={{color:"var(--tx-100)",fontSize:9,fontFamily:"monospace"}}>{nodeTypeStats[k]||0}</span>
            </div>
          ))}
        </div>

        {/* Node detail */}
        {selNode&&(
          <div className="m-card" style={{padding:10}}>
            <div style={{fontSize:11,fontWeight:700,color:"var(--tx-900)",marginBottom:2,wordBreak:"break-all"}}>{selNode.label}</div>
            <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:8}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:ntColors[selNode.nodeType]}}/>
              <span style={{fontSize:10,color:"var(--tx-300)"}}>{ntLabels[selNode.nodeType]||selNode.nodeType}</span>
              {selNode.group&&<span style={{fontSize:9,padding:"1px 4px",borderRadius:3,background:"var(--bg-hover)",color:"var(--tx-100)"}}>{selNode.group}</span>}
            </div>
            <div style={{display:"flex",gap:8,marginBottom:6}}>
              <div style={{fontSize:9,color:"var(--tx-100)"}}>链接: <b style={{color:"var(--m-cyan)"}}>{selNode.weight??0}</b></div>
              <div style={{fontSize:9,color:"var(--tx-100)"}}>出现: <b>{selNode.occurrenceCount??0}</b></div>
            </div>
            {selNode.icd10Code&&<div style={{fontSize:9,color:"var(--tx-300)",marginBottom:2}}>ICD-10: <span style={{fontFamily:"monospace",color:"var(--m-cyan)"}}>{selNode.icd10Code}</span></div>}
            {selNode.meshTerm&&<div style={{fontSize:9,color:"var(--tx-300)",marginBottom:2}}>MeSH: <span style={{fontFamily:"monospace",color:"var(--m-primary)"}}>{selNode.meshTerm}</span></div>}
            {selNode.description&&<div style={{fontSize:9,color:"var(--tx-300)",marginTop:4,lineHeight:1.5}}>{selNode.description}</div>}
            <div style={{marginTop:8}}>
              <div style={{fontSize:9,fontWeight:700,color:"var(--tx-400)",marginBottom:3}}>关联关系</div>
              {edges.filter(e=>e.source===selNode.id||e.target===selNode.id).slice(0,12).map((e,i)=>{
                const oid=e.source===selNode.id?e.target:e.source;
                const on=nodes.find(n=>n.id===oid);
                return <div key={i} style={{fontSize:9,padding:"2px 5px",borderRadius:3,background:"var(--bg-elevated)",marginBottom:1,display:"flex",alignItems:"center",gap:3}}>
                  <span style={{color:"var(--m-cyan)",flexShrink:0,fontSize:8}}>{rtLabels[e.relationType]||e.relationType}</span>
                  <span style={{color:"var(--tx-300)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{on?.label||`#${oid}`}</span>
                </div>;
              })}
            </div>
          </div>
        )}

        {/* Force controls panel */}
        {showPanel&&(
          <div className="m-card" style={{padding:10}}>
            <div style={{fontSize:10,fontWeight:700,color:"var(--tx-700)",marginBottom:8}}>力导向参数</div>
            {[{k:"center",l:"中心力"},{k:"repel",l:"排斥力"},{k:"link",l:"链接强度"}].map(f=>(
              <div key={f.k} style={{marginBottom:6}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"var(--tx-300)",marginBottom:2}}><span>{f.l}</span><span style={{fontFamily:"monospace"}}>{(forces as any)[f.k]}</span></div>
                <input type="range" min={0} max={100} value={(forces as any)[f.k]} onChange={e=>setForces(p=>({...p,[f.k]:parseInt(e.target.value)}))}
                  style={{width:"100%",height:3,accentColor:"var(--m-cyan)",cursor:"pointer"}}/>
              </div>
            ))}
          </div>
        )}

        {!selNode&&(
          <div className="m-card" style={{padding:10,textAlign:"center",color:"var(--tx-100)",fontSize:10}}>
            <FiInfo size={18} style={{marginBottom:4,opacity:0.3}}/>
            <p>点击节点查看详情<br/>双击打开对应文献</p>
          </div>
        )}
      </div>
    </div>
  );
}
