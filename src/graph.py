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
        cids = info.get("chunk_ids", [])
        if cids and "-" in cids[0]:
            doc_hash = cids[0].rsplit("-", 1)[-1][:8]
            return f"文献-{doc_hash}"
        return "其他文献"

    def get_graph(self) -> dict:
        groups = sorted(set(n.get("group", "其他") for n in self.nodes.values()))
        return {
            "nodes": list(self.nodes.values()),
            "edges": self.edges,
            "stats": {
                "total_nodes": len(self.nodes),
                "total_edges": len(self.edges),
                "total_docs": len(groups),
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
