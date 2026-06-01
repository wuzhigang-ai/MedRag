/**
 * G6GraphView — 多类型配色 + 双主题自适应 + 稳定单 useEffect 架构
 */
import { useEffect, useRef, useState } from "react";
import { Graph } from "@antv/g6";

const GROUP_COLORS: Record<string,[string,string]> = {
  disease:["#E84D4D","#FF6B6B"],drug:["#3B82F6","#60A5FA"],symptom:["#F07850","#FF9A76"],
  treatment:["#10B981","#34D399"],check:["#8B5CF6","#A78BFA"],exam:["#8B5CF6","#A78BFA"],
  clinical_indicator:["#8B5CF6","#A78BFA"],anatomy:["#06B6D4","#22D3EE"],
  procedure:["#EC4899","#F472B6"],gene:["#7C3AED","#9B6BFF"],pathogen:["#DC2626","#FF4040"],
  guideline:["#D4A853","#F0D080"],metric:["#3B82F6","#60A5FA"],other:["#64748B","#94A3B8"],
};
function nc(g:string):[string,string]{return GROUP_COLORS[g]||GROUP_COLORS.other}

interface GNode {id:number|string;label:string;group?:string;weight?:number;description?:string}
interface GEdge {id?:number;source:number|string;target:number|string;weight?:number;relationType?:string}

function isDark():boolean{
  try{const a=document.documentElement.getAttribute("data-theme");return a==="dark"||(!a&&window.matchMedia("(prefers-color-scheme:dark)").matches)}catch{return true}
}

function buildData(nodes:GNode[],edges:GEdge[]){
  const dark=isDark();
  return{
    nodes:nodes.map(n=>{
      const[fill,glow]=nc(n.group||"other");const r=Math.min(30,10+(n.weight||1)*2);
      const lbl=(n.label||"").length>20?(n.label||"").slice(0,18)+"…":(n.label||"");
      return{
        id:String(n.id),data:{label:n.label,group:n.group||"other",weight:n.weight||1,description:n.description||""},
        style:{size:r*2,fill,stroke:dark?glow+"88":fill+"44",lineWidth:1.5,labelText:lbl,labelFill:dark?"#cbd5e1":"#334155",labelFontSize:10,labelPlacement:"bottom",labelOffsetY:r/2+6,cursor:"pointer"},
        states:["active","inactive","selected"],
      };
    }),
    edges:edges.map((e,i)=>({
      id:String(e.id||`e${i}`),source:String(e.source),target:String(e.target),
      style:{stroke:dark?"rgba(148,163,184,0.20)":"rgba(71,85,105,0.25)",lineWidth:0.6+(e.weight||1)*0.12,endArrow:false},
      states:["active","inactive"],
    })),
  };
}

function applyHL(g:Graph,search:string,filter:string){
  try{const s=search.trim().toLowerCase(),f=filter,nd=g.getNodeData();
    if(!s&&!f){nd.forEach(n=>g.setElementState({[n.id]:{}}));return}
    nd.forEach(n=>{const l=((n.data?.label as string)||"").toLowerCase(),gr=(n.data?.group as string)||"";g.setElementState({[n.id]:(!s||l.includes(s))&&(!f||gr===f)?"active":"inactive"})});
    g.getEdgeData().forEach(e=>{const sa=g.getElementState(String(e.source)),ta=g.getElementState(String(e.target));g.setElementState({[e.id!]:(!sa?.inactive&&!ta?.inactive)?{}:"inactive"})});
  }catch{}
}

export default function G6GraphView({nodes,edges,search,filter,onNodeClick,onReady}:{
  nodes:GNode[];edges:GEdge[];search:string;filter:string;onNodeClick?:(n:GNode)=>void;onReady?:(g:Graph)=>void
}){
  const containerRef=useRef<HTMLDivElement>(null);
  const graphRef=useRef<Graph|null>(null);
  const [theme,setTheme]=useState(isDark()?"dark":"light");

  useEffect(()=>{
    const check=()=>setTheme(isDark()?"dark":"light");
    const obs=new MutationObserver(check);
    obs.observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
    window.matchMedia("(prefers-color-scheme:dark)").addEventListener("change",check);
    return()=>{obs.disconnect();window.matchMedia("(prefers-color-scheme:dark)").removeEventListener("change",check)};
  },[]);

  // Single useEffect — init + data — no race condition
  useEffect(()=>{
    const c=containerRef.current;if(!c||!nodes.length)return;
    const dark=theme==="dark",W=c.clientWidth||800,H=c.clientHeight||500;

    if(graphRef.current){try{graphRef.current.destroy()}catch{};graphRef.current=null}
    while(c.firstChild)c.removeChild(c.firstChild);

    try{
      const g=new Graph({
        container:c,width:W,height:H,autoFit:"view",padding:[80,80,80,80],animation:true,background:"transparent",
        data:buildData(nodes,edges),
        layout:{type:"d3-force",preventOverlap:true,nodeSize:48,linkDistance:120,animate:true,alphaDecay:0.015,alphaMin:0.001,collideStrength:1.2,forceSimulationIterations:150},
        behaviors:["drag-canvas","zoom-canvas",{type:"drag-element",enableTransient:true},{type:"hover-activate",degree:1,direction:"both"}],
        plugins:[{type:"minimap",size:[150,110],position:"right-bottom",style:{background:dark?"#1e293b":"#f8fafc",border:`1px solid ${dark?"#334155":"#e2e8f0"}`,borderRadius:6}}],
        node:{type:"circle",
          state:{active:{stroke:"#FFD700",lineWidth:3,labelFontSize:12},inactive:{opacity:dark?0.10:0.08},selected:{stroke:"#FFD700",lineWidth:4,labelFontSize:14,labelFill:"#FFD700"}},
        },
        edge:{type:"line",state:{active:{stroke:"#FFD700",lineWidth:2},inactive:{opacity:dark?0.04:0.06}}},
      });
      g.render().then(()=>{graphRef.current=g;if(onReady)onReady(g);applyHL(g,search,filter)});
      g.on("node:click",(evt:any)=>{const nid=evt?.target?.id;if(nid&&onNodeClick){const f=nodes.find(n=>String(n.id)===nid);if(f){g.getNodeData().forEach(nd=>g.setElementState({[nd.id]:nd.id===nid?"selected":{}}));onNodeClick(f)}}});
      g.on("canvas:click",()=>g.getNodeData().forEach(nd=>g.setElementState({[nd.id]:{}})));
      const onKey=(e:KeyboardEvent)=>{if(e.key==="f"&&!e.ctrlKey&&!e.metaKey){e.preventDefault();try{g.fitView({padding:80})}catch{}}};
      window.addEventListener("keydown",onKey);
      return()=>{window.removeEventListener("keydown",onKey);try{g.destroy()}catch{};graphRef.current=null};
    }catch(e){console.error("G6:",e)}
  },[nodes.length,edges.length,theme]);

  useEffect(()=>{const g=graphRef.current;if(g)applyHL(g,search,filter)},[search,filter]);
  useEffect(()=>{const r=()=>{const g=graphRef.current,c=containerRef.current;if(g&&c)g.setSize(c.clientWidth,c.clientHeight)};window.addEventListener("resize",r);return()=>window.removeEventListener("resize",r)},[]);

  return <div ref={containerRef} style={{width:"100%",height:"100%",minHeight:500}}/>;
}
