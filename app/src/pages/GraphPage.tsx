/**
 * GraphPage — AntV G6 知识图谱 · 多类型配色 · 双主题 · 力导向布局
 * 加载/空/错误三态覆盖 · 图例联动筛选 · 节点详情关联跳转
 */
import { useState, useCallback, useRef } from "react";
import { trpc } from "@/providers/trpc";
import { FiSearch, FiZoomIn, FiZoomOut, FiMaximize, FiDownload, FiFilter, FiSliders, FiInfo, FiX, FiRefreshCw } from "react-icons/fi";
import G6GraphView from "@/components/G6GraphView";

const ntColors: Record<string,string> = { disease:"#E84D4D",drug:"#3B82F6",symptom:"#F07850",treatment:"#10B981",clinical_indicator:"#8B5CF6",anatomy:"#06B6D4",procedure:"#EC4899",gene:"#7C3AED",pathogen:"#DC2626",other:"#64748B",check:"#8B5CF6",exam:"#8B5CF6",metric:"#3B82F6",guideline:"#D4A853" };
const ntLabels: Record<string,string> = { disease:"疾病",drug:"药物",symptom:"症状",treatment:"治疗",clinical_indicator:"指标",anatomy:"解剖",procedure:"手术",gene:"基因",pathogen:"病原体",other:"其他",check:"检查",exam:"检查",metric:"指标",guideline:"指南" };
const rtLabels: Record<string,string> = { treats:"治疗",causes:"导致",associated_with:"相关",contraindicated:"禁忌",diagnoses:"诊断",prevents:"预防",symptom_of:"症状",interacts_with:"相互作用",related_to:"关联" };

export default function GraphPage() {
  const { data: gd, isLoading, error, refetch } = trpc.knowledge.getGraph.useQuery();
  const graphRef = useRef<any>(null);
  const [search, setSearch] = useState(""); const [filter, setFilter] = useState("");
  const [selNode, setSelNode] = useState<any>(null); const [showPanel, setShowPanel] = useState(false);

  const nodes = (gd?.nodes ?? []).map((n:any)=>({...n,id:n.id??Math.random(),label:n.label??"?",group:n.group??n.nodeType??"other"}));
  const edges = (gd?.edges??[]).map((e:any)=>({...e,source:e.sourceNodeId??e.source??0,target:e.targetNodeId??e.target??0}));
  const nodeTypeStats: Record<string,number> = {};
  nodes.forEach((n:any)=>{nodeTypeStats[n.group||n.nodeType]=(nodeTypeStats[n.group||n.nodeType]||0)+1;});

  const handleGraphReady = useCallback((g:any)=>{graphRef.current=g;},[]);
  const zoomIn = ()=>{try{const g=graphRef.current;if(g)g.zoomTo((g.getZoom()||1)*1.3)}catch{}};
  const zoomOut = ()=>{try{const g=graphRef.current;if(g)g.zoomTo((g.getZoom()||1)/1.3)}catch{}};
  const resetView = ()=>{try{graphRef.current?.fitView({padding:80})}catch{}};
  const exportPNG = useCallback(async()=>{try{const g=graphRef.current;if(g){const d=document.documentElement.getAttribute("data-theme");const url=await g.toDataURL({type:"image/png",backgroundColor:d==="dark"?"#080E1A":"#F0F4F8"});const a=document.createElement("a");a.download=`graph-${nodes.length}n-${edges.length}e.png`;a.href=url;a.click()}}catch{}},[nodes.length,edges.length]);

  return (
    <div style={{display:"flex",gap:12,height:"100%"}}>
      <div style={{flex:1,display:"flex",flexDirection:"column",gap:10,minWidth:0}}>
        {/* Toolbar */}
        <div className="m-card" style={{padding:"6px 12px",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",flexShrink:0}}>
          <div style={{position:"relative",flexShrink:0}}>
            <FiSearch size={12} style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:"var(--tx-100)",zIndex:1,pointerEvents:"none"}}/>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索节点…" className="m-input" style={{paddingLeft:28,height:30,fontSize:11,width:170,borderRadius:8}}/>
            {search&&<FiX size={12} onClick={()=>setSearch("")} style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",cursor:"pointer",color:"var(--tx-200)"}}/>}
          </div>
          <select value={filter} onChange={e=>setFilter(e.target.value)} className="m-input" style={{height:30,fontSize:11,width:100,cursor:"pointer",borderRadius:8}}>
            <option value="">全部类型</option>{Object.entries(ntLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}
          </select>
          {filter&&<span onClick={()=>setFilter("")} style={{fontSize:10,color:"var(--m-cyan)",cursor:"pointer",whiteSpace:"nowrap"}}>清除</span>}
          <div style={{flex:1}}/>
          <span style={{fontSize:10,color:"var(--tx-200)",whiteSpace:"nowrap"}}>{nodes.length}节点 {edges.length}边</span>
          <div style={{display:"flex",gap:3}}>
            <button onClick={zoomIn} className="m-btn m-btn-ghost" style={{width:28,height:28,padding:0,borderRadius:8}} title="放大"><FiZoomIn size={13}/></button>
            <button onClick={zoomOut} className="m-btn m-btn-ghost" style={{width:28,height:28,padding:0,borderRadius:8}} title="缩小"><FiZoomOut size={13}/></button>
            <button onClick={resetView} className="m-btn m-btn-ghost" style={{width:28,height:28,padding:0,borderRadius:8}} title="重置视图 (F键)"><FiMaximize size={13}/></button>
            <button onClick={exportPNG} className="m-btn m-btn-ghost" style={{width:28,height:28,padding:0,borderRadius:8}} title="导出PNG"><FiDownload size={13}/></button>
            <button onClick={()=>setShowPanel(!showPanel)} className="m-btn m-btn-ghost" style={{width:28,height:28,padding:0,borderRadius:8,background:showPanel?"var(--m-cyan)18":"",color:showPanel?"var(--m-cyan)":""}} title="快捷键"><FiSliders size={13}/></button>
          </div>
        </div>

        {/* Graph Canvas */}
        <div style={{flex:1,borderRadius:12,overflow:"hidden",background:"var(--bg-base)",border:"1px solid var(--bd-100)",position:"relative",minHeight:450}}>
          {isLoading ? (
            <div style={{height:"100%",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12}}>
              <div style={{width:40,height:40,borderRadius:"50%",border:"2px solid var(--bd-200)",borderTopColor:"var(--m-cyan)",animation:"spin 1s linear infinite"}}/>
              <p style={{fontSize:12,color:"var(--tx-300)"}}>图谱加载中…</p>
            </div>
          ) : error ? (
            <div style={{height:"100%",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12}}>
              <FiInfo size={28} style={{color:"var(--m-red)",opacity:0.5}}/>
              <p style={{fontSize:12,color:"var(--tx-300)"}}>图谱加载失败</p>
              <button onClick={()=>refetch()} className="m-btn m-btn-ghost" style={{fontSize:11}}><FiRefreshCw size={11} style={{marginRight:4}}/>重试</button>
            </div>
          ) : !nodes.length ? (
            <div style={{height:"100%",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12}}>
              <div style={{width:48,height:48,borderRadius:14,background:"var(--bg-elevated)",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--tx-100)"}}><FiFilter size={20}/></div>
              <p style={{fontSize:13,fontWeight:600,color:"var(--tx-500)"}}>暂无知识图谱数据</p>
              <p style={{fontSize:11,color:"var(--tx-200)"}}>上传医学文献完成解析后自动构建</p>
            </div>
          ) : (
            <>
              <G6GraphView nodes={nodes} edges={edges} search={search} filter={filter} onNodeClick={setSelNode} onReady={handleGraphReady}/>
              {showPanel&&(
                <div style={{position:"absolute",top:10,right:10,background:"var(--bg-surface)dd",backdropFilter:"blur(12px)",border:"1px solid var(--bd-100)",borderRadius:8,padding:"8px 12px",zIndex:10,fontSize:10,color:"var(--tx-300)",lineHeight:1.8}}>
                  <div style={{fontWeight:700,marginBottom:4,color:"var(--tx-500)"}}>快捷键</div>
                  <div><b style={{color:"var(--m-cyan)"}}>F</b> 重置视图</div>
                  <div><b style={{color:"var(--m-cyan)"}}>滚轮</b> 缩放</div>
                  <div><b style={{color:"var(--m-cyan)"}}>拖拽</b> 平移画布</div>
                  <div><b style={{color:"var(--m-cyan)"}}>拖拽节点</b> 调整位置</div>
                  <div><b style={{color:"var(--m-cyan)"}}>点击节点</b> 查看详情</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Right Panel */}
      <div style={{width:220,flexShrink:0,display:"flex",flexDirection:"column",gap:10,overflow:"auto"}}>
        {/* Legend */}
        <div className="m-card" style={{padding:10,borderRadius:12}}>
          <div style={{fontSize:10,fontWeight:700,color:"var(--tx-500)",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.05em"}}>节点类型</div>
          {Object.entries(ntLabels).filter(([k])=>(nodeTypeStats[k]||0)>0).map(([k,v])=>(
            <div key={k} onClick={()=>setFilter(filter===k?"":k)} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 6px",borderRadius:6,cursor:"pointer",background:filter===k?"var(--bg-hover)":"transparent",fontSize:10,transition:"all 0.15s"}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:ntColors[k]||"#64748B",flexShrink:0}}/>
              <span style={{flex:1,color:filter===k?"var(--tx-700)":"var(--tx-500)"}}>{v}</span>
              <span style={{color:"var(--tx-200)",fontSize:9,fontFamily:"monospace"}}>{nodeTypeStats[k]||0}</span>
            </div>
          ))}
        </div>

        {/* Node Detail */}
        {selNode ? (
          <div className="m-card" style={{padding:10,borderRadius:12,animation:"fadeIn 0.25s ease"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
              <div style={{fontSize:12,fontWeight:700,color:"var(--tx-900)",wordBreak:"break-all",flex:1}}>{selNode.label}</div>
              <FiX size={12} style={{cursor:"pointer",color:"var(--tx-200)",flexShrink:0}} onClick={()=>setSelNode(null)}/>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:ntColors[selNode.group||selNode.nodeType]||"#64748B"}}/>
              <span style={{fontSize:9,padding:"1px 6px",borderRadius:4,background:"var(--bg-hover)",color:"var(--tx-300)"}}>{ntLabels[selNode.group||selNode.nodeType]||selNode.group||selNode.nodeType||"其他"}</span>
              {selNode.weight>0&&<span style={{fontSize:9,color:"var(--tx-200)"}}>{selNode.weight}关联</span>}
            </div>
            {selNode.description&&<div style={{fontSize:9,color:"var(--tx-300)",lineHeight:1.6,marginBottom:8,padding:"6px 8px",borderRadius:6,background:"var(--bg-base)"}}>{selNode.description}</div>}
            <div style={{marginTop:4}}>
              <div style={{fontSize:9,fontWeight:700,color:"var(--tx-400)",marginBottom:4}}>关联关系</div>
              {edges.filter((e:any)=>String(e.source)===String(selNode.id)||String(e.target)===String(selNode.id)).slice(0,15).map((e:any,i:number)=>{
                const oid=String(e.source)===String(selNode.id)?e.target:e.source;
                const on=nodes.find((n:any)=>String(n.id)===String(oid));
                return(
                  <div key={i} onClick={()=>{const n=nodes.find((x:any)=>String(x.id)===String(oid));if(n)setSelNode(n);}} style={{fontSize:9,padding:"3px 6px",borderRadius:5,background:"var(--bg-elevated)",marginBottom:2,display:"flex",alignItems:"center",gap:4,cursor:"pointer"}} title={on?.label||""}>
                    <span style={{color:"var(--m-cyan)",flexShrink:0,fontSize:8,fontWeight:600}}>{rtLabels[e.relationType]||e.relationType||"关联"}</span>
                    <span style={{color:"var(--tx-300)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{on?.label||`#${String(oid).slice(0,8)}`}</span>
                  </div>
                );
              })}
              {edges.filter((e:any)=>String(e.source)===String(selNode.id)||String(e.target)===String(selNode.id)).length===0&&<div style={{fontSize:9,color:"var(--tx-200)",textAlign:"center",padding:8}}>暂无关联</div>}
            </div>
          </div>
        ) : (
          <div className="m-card" style={{padding:14,textAlign:"center",color:"var(--tx-200)",fontSize:10,borderRadius:12}}>
            <div style={{width:36,height:36,borderRadius:10,background:"var(--bg-elevated)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 10"}}><FiInfo size={16} style={{opacity:0.4}}/></div>
            <p style={{lineHeight:1.6}}>点击节点查看详情<br/><span style={{color:"var(--tx-100)",fontSize:9}}>按 <b style={{color:"var(--m-cyan)"}}>F</b> 重置视图</span></p>
          </div>
        )}
      </div>
    </div>
  );
}
