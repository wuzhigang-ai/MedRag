"""GraphManager — LightRAG knowledge graph data layer.

Parses LightRAG KV store JSON files into node/edge lists,
with snapshot-based delta detection for incremental updates.
"""

import json
import logging
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


class GraphManager:
    def __init__(self, storage_dir: str = "./lightrag_storage"):
        self.storage_dir = Path(storage_dir)
        self.nodes: Dict[str, dict] = {}
        self.edges: List[dict] = []
        self._snapshot_time: int = 0
        self._built = False
        self._error: Optional[str] = None

    def build(self) -> dict:
        self._error = None
        self.nodes.clear()
        self.edges.clear()
        try:
            self._parse_entities()
            self._parse_relations()
            self._built = True
        except FileNotFoundError as e:
            self._error = "storage_not_found"
            logger.warning(f"Graph storage not found: {e}")
        except json.JSONDecodeError as e:
            self._error = "parse_error"
            logger.error(f"Graph JSON parse error: {e}")
        return self.get_graph()

    def _parse_entities(self):
        f = self.storage_dir / "kv_store_entity_chunks.json"
        if not f.exists():
            raise FileNotFoundError(f"Entity store not found: {f}")
        data = json.loads(f.read_text(encoding="utf-8"))
        for name, info in data.items():
            if not isinstance(info, dict):
                continue
            info["entity_name"] = name
            group = self._infer_group(info)
            self.nodes[name] = {
                "id": name,
                "label": name,
                "weight": info.get("count", 1),
                "group": group,
                "create_time": info.get("create_time", 0),
                "chunk_ids": info.get("chunk_ids", []),
            }
        logger.info(f"GraphManager: parsed {len(self.nodes)} entities")

    def _parse_relations(self):
        f = self.storage_dir / "kv_store_relation_chunks.json"
        if not f.exists():
            raise FileNotFoundError(f"Relation store not found: {f}")
        data = json.loads(f.read_text(encoding="utf-8"))
        for key, info in data.items():
            if "<SEP>" not in key:
                continue
            parts = key.split("<SEP>", 1)
            self.edges.append({
                "source": parts[0].strip(),
                "target": parts[1].strip(),
                "weight": info.get("count", 1),
                "create_time": info.get("create_time", 0),
            })
        logger.info(f"GraphManager: parsed {len(self.edges)} relations")

    @staticmethod
    def _infer_group(info: dict) -> str:
        """Classify medical entity by name patterns."""
        name = str(info.get("entity_name", ""))
        if not name:
            return "other"
        nl = name.lower()
        if any(k in nl for k in ['disease','dysfunction','failure','stenosis',
            'regurgitation','syndrome','infarction','ischemia','thrombosis','embolism',
            'aneurysm','dissection','atherosclerosis','calcification','endometriosis',
            'adenomyosis','hyperplasia','necrosis','fibrosis','cirrhosis','carcinoma',
            'adenoma','sarcoma','melanoma','lymphoma','病','症','癌','瘤','衰竭',
            '梗死','栓塞','夹层','狭窄','关闭不全']):
            return 'disease'
        if any(k in nl for k in ['drug','medication','inhibitor','blocker',
            'antagonist','agonist','statin','antibiotic','aspirin','heparin',
            'warfarin','metformin','insulin','corticosteroid','opioid','analgesic',
            'diuretic','vasodilator','vasopressor','inotrope','anticoagulant',
            '药','剂','素','洛尔','地平','普利','沙坦','他汀','nitroglycerin',
            'adenosine']):
            return 'drug'
        if any(k in nl for k in ['surgery','repair','replacement','graft',
            'stent','angioplasty','catheter','ablation','resection','transplant',
            'TEVAR','EVAR','CPB','CABG','PCI','ECMO','CRRT','balloon pump',
            'impella','ventricular assist','pacemaker','defibrillator','bypass',
            'embolization','anastomosis','thoracotomy',' laparotomy','endoscopy',
            '手术','治疗','修复','移植','支架','导管','消融','切除','置换','搭桥',
            '介入','管理']):
            return 'treatment'
        if any(k in nl for k in ['CT','MRI','ultrasound','echocardiograph',
            'angiograph','X-ray','PET','SPECT','ECG','EEG','EMG','lab','assay',
            'biomarker','troponin','creatinine','GFR','eGFR','BUN','ALT','AST',
            'HbA1c','glucose','cholesterol','LDL','HDL','biopsy','endoscopy',
            'colonoscopy','bronchoscopy','cystoscopy','检查','检测','超声',
            '造影','图','试验','评分','量表','Cystatin','Equation']):
            return 'check'
        if any(k in nl for k in ['pain','fever','edema','dyspnea','fatigue',
            'nausea','vomiting','bleeding','hemorrhage','hypertension','hypotension',
            'tachycardia','bradycardia','arrhythmia','shock','sepsis','hypoxia',
            'cyanosis','ascites','jaundice',' effusion','晕','痛','发热','水肿',
            '困难','急促','高压','低压','症状','体征']):
            return 'symptom'
        if any(k in nl for k in ['artery','vein','valve','ventricle','atrium',
            'myocardium','endocardium','pericardium','aorta','coronary','pulmonary',
            'mitral','tricuspid','renal','hepatic','cerebral','carotid','femoral',
            'brachial','radial','axillary','popliteal','tibial','mesenteric',
            '血管','心脏','肾脏','肝脏','脑','肺','动脉','静脉','瓣膜','Gene',
            'Cohort']):
            return 'anatomy'
        if any(k in nl for k in ['guideline','consensus','recommendation',
            'trial','RCT','meta-analysis','systematic review','cohort','registry',
            '指南','共识','推荐','试验','研究','证据','ClinicalTrials','NIH','FDA',
            'EMA']):
            return 'guideline'
        if any(k in nl for k in ['score','index','rate','ratio','level',
            'pressure','volume','output','fraction','clearance','survival',
            'mortality','morbidity','incidence','prevalence','率','值','指数',
            '分数','水平','Equation']):
            return 'metric'
        return 'other'

    def get_graph(self) -> dict:
        groups = sorted(set(n.get("group", "other") for n in self.nodes.values()))
        doc_count = 0
        try:
            ds = self.storage_dir / "kv_store_doc_status.json"
            if ds.exists():
                docs = json.loads(ds.read_text(encoding="utf-8"))
                doc_count = len(set(v.get("file_path", k) for k, v in docs.items()))
        except Exception:
            doc_count = 0
        return {
            "nodes": list(self.nodes.values()),
            "edges": self.edges,
            "stats": {
                "total_nodes": len(self.nodes),
                "total_edges": len(self.edges),
                "total_docs": doc_count,
                "total_entity_types": len(groups),
            },
            "groups": groups,
            "error": self._error,
        }

    def snapshot(self):
        times = [n.get("create_time", 0) for n in self.nodes.values()]
        times += [e.get("create_time", 0) for e in self.edges]
        self._snapshot_time = max(times) if times else 0
        logger.info(f"GraphManager: snapshot at t={self._snapshot_time}")

    def get_delta(self) -> dict:
        if self._snapshot_time == 0:
            return {
                "new_nodes": [],
                "new_edges": [],
                "new_node_count": 0,
                "new_edge_count": 0,
                "since": 0,
            }
        new_nodes = [
            v for k, v in self.nodes.items()
            if v["create_time"] > self._snapshot_time
        ]
        new_edges = [
            e for e in self.edges
            if e["create_time"] > self._snapshot_time
        ]
        return {
            "new_nodes": new_nodes,
            "new_edges": new_edges,
            "new_node_count": len(new_nodes),
            "new_edge_count": len(new_edges),
            "since": self._snapshot_time,
        }
