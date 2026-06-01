/**
 * G6GraphView — Nebula Data 视觉体系 v1.0
 * Kimi 设计协作 · 深空星云(暗) / 白昼水晶(亮) 双主题
 */
import { useEffect, useRef, useState } from "react";
import { Graph } from "@antv/g6";

// ── Nebula Data 色板 ──
const DARK={
  bg:"#0B0E17",bgCenter:"#0F1525",
  L0:"#E8E4DD",L1:"#A8C4E0",L2:"#6B8FA8",L3:"#3D5266",L4:"#1E2A36",
  edgeStrong:"rgba(168,196,224,0.5)",edgeMid:"rgba(107,143,168,0.3)",edgeWeak:"rgba(61,82,102,0.15)",
  label:"rgba(232,228,221,0.88)",labelSub:"rgba(168,196,224,0.6)",
  active:"#F0D78C",activeStroke:"rgba(240,215,140,0.7)",
  minimapBg:"#1e293b",minimapBorder:"#334155",
};
const LIGHT={
  bg:"#F7F5F0",bgCenter:"#FAF8F4",
  L0:"rgba(44,62,80,0.85)",L1:"rgba(91,123,163,0.75)",L2:"rgba(138,163,193,0.65)",L3:"rgba(181,196,212,0.5)",L4:"rgba(213,221,229,0.35)",
  edgeStrong:"rgba(91,123,163,0.38)",edgeMid:"rgba(138,163,193,0.24)",edgeWeak:"rgba(181,196,212,0.12)",
  label:"rgba(44,62,80,0.9)",labelSub:"rgba(91,123,163,0.7)",
  active:"rgba(212,168,67,0.9)",activeStroke:"rgba(212,168,67,0.6)",
  minimapBg:"#ffffff",minimapBorder:"#cbd5e1",
};

interface GNode {id:number|string;label:string;group?:string;weight?:number;description?:string}
interface GEdge {id?:number;source:number|string;target:number|string;weight?:number;relationType?:string}

function isDark():boolean{
  try{const a=document.documentElement.getAttribute("data-theme");return a==="dark"||(!a&&window.matchMedia("(prefers-color-scheme:dark)").matches)}catch{return true}
}

// L0-L4 层级判定：按节点关联数（weight）分档
function nodeLevel(w:number):number{
  if(w>=8)return 0;if(w>=5)return 1;if(w>=3)return 2;if(w>=1)return 3;return 4;
}
function levelColor(level:number,p:typeof DARK):string{
  const map=[p.L0,p.L1,p.L2,p.L3,p.L4];return map[level]||p.L4;
}
function levelSize(level:number):number{
  const map=[26,20,16,12,8];return map[level]||8;
}

function buildData(nodes:GNode[],edges:GEdge[],p:typeof DARK){
  return{
    nodes:nodes.map(n=>{
      const lv=nodeLevel(n.weight||0);
      const fill=levelColor(lv,p);const r=levelSize(lv);
      const lbl=(n.label||"").length>18?(n.label||"").slice(0,16)+"…":(n.label||"");
      return{
        id:String(n.id),
        data:{label:n.label,group:n.group||"other",weight:n.weight||0,description:n.description||"",level:lv},
        style:{
          size:r*2,fill,stroke:p.L2+"44",lineWidth:lv<=2?1.5:1,
          labelText:lv<=2?lbl:"",labelFill:p.label,labelFontSize:10,labelPlacement:"bottom",labelOffsetY:r/2+6,
          cursor:"pointer",
        },
        states:["active","inactive","selected"],
      };
    }),
    edges:edges.map((e,i)=>{
      const ew=e.weight||1;const stroke=ew>=4?p.edgeStrong:ew>=2?p.edgeMid:p.edgeWeak;
      return{
        id:String(e.id||`e${i}`),source:String(e.source),target:String(e.target),
        style:{stroke,lineWidth:0.6+ew*0.1,endArrow:false},
        states:["active","inactive"],
      };
    }),
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

  useEffect(()=>{
    const c=containerRef.current;if(!c||!nodes.length)return;
    const dark=theme==="dark",p=dark?DARK:LIGHT,W=c.clientWidth||800,H=c.clientHeight||500;

    if(graphRef.current){try{graphRef.current.destroy()}catch{};graphRef.current=null}
    while(c.firstChild)c.removeChild(c.firstChild);

    try{
      const g=new Graph({
        container:c,width:W,height:H,autoFit:"view",padding:[80,80,80,80],
        animation:true,
        background:dark
          ?`radial-gradient(ellipse 70% 70% at 50% 45%,${p.bgCenter} 0%,${p.bg} 40%,#080A10 100%)`
          :`radial-gradient(ellipse 70% 70% at 50% 45%,${p.bgCenter} 0%,${p.bg} 40%,#F0EDE6 100%)`,
        data:buildData(nodes,edges,p),
        layout:{type:"d3-force",preventOverlap:true,nodeSize:48,linkDistance:120,animate:true,alphaDecay:0.015,alphaMin:0.001,collideStrength:1.2,forceSimulationIterations:150},
        behaviors:["drag-canvas","zoom-canvas",{type:"drag-element",enableTransient:true}],
        plugins:[{type:"minimap",size:[150,110],position:"right-bottom",style:{background:p.minimapBg,border:`1px solid ${p.minimapBorder}`,borderRadius:6}}],
        node:{type:"circle",
          state:{
            active:{stroke:p.active,lineWidth:3,labelFontSize:12},
            inactive:{opacity:dark?0.12:0.10},
            selected:{stroke:p.active,lineWidth:4,labelFontSize:14,labelFill:p.active},
          },
        },
        edge:{type:"line",
          state:{active:{stroke:p.active,lineWidth:2},inactive:{opacity:dark?0.04:0.06}},
        },
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
