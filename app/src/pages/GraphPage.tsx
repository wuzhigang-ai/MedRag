/**
 * GraphPage — AntV G6 powered knowledge graph visualization.
 * Professional graph rendering with force layout, search, filter, minimap & tooltips.
 * Zero backend impact: consumes existing /api/graph & /api/graph/stats endpoints.
 */
import { useState, useCallback, useRef } from "react";
import { trpc } from "@/providers/trpc";
import { FiSearch, FiZoomIn, FiZoomOut, FiMaximize, FiDownload, FiFilter, FiSliders, FiInfo } from "react-icons/fi";
import G6GraphView from "@/components/G6GraphView";
import { Graph } from "@antv/g6";

const ntColors: Record<string,string> = { disease:"#E84D4D",drug:"#3B82F6",symptom:"#F07850",treatment:"#10B981",clinical_indicator:"#8B5CF6",anatomy:"#06B6D4",procedure:"#EC4899",gene:"#7C3AED",pathogen:"#DC2626",other:"#64748B",check:"#8B5CF6",exam:"#8B5CF6",metric:"#3B82F6",guideline:"#D4A853" };
const ntLabels: Record<string,string> = { disease:"疾病",drug:"药物",symptom:"症状",treatment:"治疗",clinical_indicator:"指标",anatomy:"解剖",procedure:"手术",gene:"基因",pathogen:"病原体",other:"其他",check:"检查",exam:"检查",metric:"指标",guideline:"指南" };
const rtLabels: Record<string,string> = { treats:"治疗",causes:"导致",associated_with:"相关",contraindicated:"禁忌",diagnoses:"诊断",prevents:"预防",symptom_of:"症状",interacts_with:"相互作用",related_to:"关联" };

export default function GraphPage() {
  const { data: gd } = trpc.knowledge.getGraph.useQuery();
  const { data: stats } = trpc.knowledge.stats.useQuery();
  const graphRef = useRef<Graph | null>(null);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [selNode, setSelNode] = useState<any>(null);
  const [showPanel, setShowPanel] = useState(false);

  const nodes = (gd?.nodes ?? []).map((n:any) => ({ ...n, id:n.id??Math.random(), label:n.label??"?", group:n.group??n.nodeType??"other" }));
  const edges = (gd?.edges ?? []).map((e:any) => ({ ...e, source:e.sourceNodeId??e.source??0, target:e.targetNodeId??e.target??0 }));

  const nodeTypeStats: Record<string,number> = {};
  nodes.forEach((n:any) => { nodeTypeStats[n.group||n.nodeType] = (nodeTypeStats[n.group||n.nodeType]||0)+1; });

  const handleGraphReady = useCallback((g: Graph) => { graphRef.current = g; }, []);

  const zoomIn = () => { try { const g = graphRef.current; if (g) { const z = g.getZoom(); g.zoomTo(z * 1.3); } } catch {} };
  const zoomOut = () => { try { const g = graphRef.current; if (g) { const z = g.getZoom(); g.zoomTo(z / 1.3); } } catch {} };
  const resetView = () => { try { graphRef.current?.fitView(); } catch {} };
  const exportPNG = useCallback(async () => {
    try { const g = graphRef.current; if (g) { const url = await g.toDataURL({ type:"image/png", backgroundColor:"#0c1222" }); const a = document.createElement("a"); a.download = "knowledge-graph.png"; a.href = url; a.click(); } } catch {}
  }, []);

  return (
    <div style={{display:"flex",gap:12,height:"100%"}}>
      <div style={{flex:1,display:"flex",flexDirection:"column",gap:10,minWidth:0}}>
        {/* Toolbar */}
        <div className="m-card" style={{padding:"6px 12px",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",flexShrink:0}}>
          <div style={{position:"relative",flexShrink:0}}>
            <FiSearch size={12} style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:"var(--tx-100)",zIndex:1}}/>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索节点..." className="m-input" style={{paddingLeft:28,height:28,fontSize:11,width:160}}/>
          </div>
          <select value={filter} onChange={e=>setFilter(e.target.value)} className="m-input" style={{height:28,fontSize:11,width:100,cursor:"pointer"}}>
            <option value="">全部类型</option>{Object.entries(ntLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}
          </select>
          <div style={{flex:1}}/>
          <div style={{display:"flex",gap:3}}>
            <button onClick={zoomIn} className="m-btn m-btn-ghost" style={{width:26,height:26,padding:0}} title="放大"><FiZoomIn size={12}/></button>
            <button onClick={zoomOut} className="m-btn m-btn-ghost" style={{width:26,height:26,padding:0}} title="缩小"><FiZoomOut size={12}/></button>
            <button onClick={resetView} className="m-btn m-btn-ghost" style={{width:26,height:26,padding:0}} title="重置视图"><FiMaximize size={12}/></button>
            <button onClick={exportPNG} className="m-btn m-btn-ghost" style={{width:26,height:26,padding:0}} title="导出PNG"><FiDownload size={12}/></button>
            <button onClick={()=>setShowPanel(!showPanel)} className="m-btn m-btn-ghost" style={{width:26,height:26,padding:0,background:showPanel?"var(--m-cyan)22":"",color:showPanel?"var(--m-cyan)":""}}><FiSliders size={12}/></button>
          </div>
        </div>

        {/* G6 Graph Canvas */}
        <div style={{flex:1,borderRadius:10,overflow:"hidden",background:"var(--bg-base)",border:"1px solid var(--bd-100)",position:"relative",minHeight:400}}>
          <G6GraphView nodes={nodes} edges={edges} search={search} filter={filter} onNodeClick={setSelNode} onReady={handleGraphReady} />
          <div style={{position:"absolute",bottom:10,left:10,display:"flex",gap:5,pointerEvents:"none"}}>
            <span style={{fontSize:9,padding:"3px 7px",borderRadius:5,background:"var(--bg-surface)",border:"1px solid var(--bd-100)",color:"var(--tx-300)",fontFamily:"monospace"}}>{nodes.length} 节点</span>
            <span style={{fontSize:9,padding:"3px 7px",borderRadius:5,background:"var(--bg-surface)",border:"1px solid var(--bd-100)",color:"var(--tx-300)",fontFamily:"monospace"}}>{edges.length} 关系</span>
          </div>
        </div>
      </div>

      {/* Right Panel */}
      <div style={{width:220,flexShrink:0,display:"flex",flexDirection:"column",gap:10,overflow:"auto"}}>
        {/* Legend */}
        <div className="m-card" style={{padding:10}}>
          <div style={{fontSize:10,fontWeight:700,color:"var(--tx-700)",marginBottom:6}}>节点类型</div>
          {Object.entries(ntLabels).filter(([k])=>(nodeTypeStats[k]||0)>0).map(([k,v])=>(
            <div key={k} onClick={()=>setFilter(filter===k?"":k)} style={{display:"flex",alignItems:"center",gap:5,padding:"2px 5px",borderRadius:4,cursor:"pointer",background:filter===k?"var(--bg-hover)":"transparent",fontSize:10,transition:"background 0.15s"}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:ntColors[k]||"#64748B",flexShrink:0}}/>
              <span style={{flex:1,color:"var(--tx-500)"}}>{v}</span>
              <span style={{color:"var(--tx-100)",fontSize:9,fontFamily:"monospace"}}>{nodeTypeStats[k]||0}</span>
            </div>
          ))}
        </div>

        {/* Node Detail */}
        {selNode ? (
          <div className="m-card" style={{padding:10}}>
            <div style={{fontSize:11,fontWeight:700,color:"var(--tx-900)",marginBottom:4,wordBreak:"break-all"}}>{selNode.label}</div>
            <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:6}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:ntColors[selNode.group||selNode.nodeType]||"#64748B"}}/>
              <span style={{fontSize:10,color:"var(--tx-300)"}}>{ntLabels[selNode.group||selNode.nodeType]||selNode.group||selNode.nodeType||"其他"}</span>
            </div>
            {selNode.description && <div style={{fontSize:9,color:"var(--tx-300)",marginTop:4,lineHeight:1.5}}>{selNode.description}</div>}
            <div style={{marginTop:8}}>
              <div style={{fontSize:9,fontWeight:700,color:"var(--tx-400)",marginBottom:3}}>关联关系</div>
              {edges.filter((e:any)=>String(e.source)===String(selNode.id)||String(e.target)===String(selNode.id)).slice(0,12).map((e:any,i:number)=>{
                const oid = String(e.source)===String(selNode.id) ? e.target : e.source;
                const on = nodes.find((n:any)=>String(n.id)===String(oid));
                return (
                  <div key={i} style={{fontSize:9,padding:"2px 5px",borderRadius:3,background:"var(--bg-elevated)",marginBottom:1,display:"flex",alignItems:"center",gap:3}}>
                    <span style={{color:"var(--m-cyan)",flexShrink:0,fontSize:8}}>{rtLabels[e.relationType]||e.relationType||"关联"}</span>
                    <span style={{color:"var(--tx-300)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{on?.label||`#${oid}`}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="m-card" style={{padding:10,textAlign:"center",color:"var(--tx-100)",fontSize:10}}>
            <FiInfo size={18} style={{marginBottom:4,opacity:0.3}}/>
            <p>点击节点查看详情</p>
          </div>
        )}
      </div>
    </div>
  );
}
