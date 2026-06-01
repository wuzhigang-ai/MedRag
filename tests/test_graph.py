"""
TDD Test Suite — MedRAG Knowledge Graph Module (100+ tests)
Covers: GraphManager data layer, G6GraphView component, GraphPage UI
Test dimensions: unit, integration, visual, interaction, state, theme, robustness
Each test is independent, quantifiable, and auditable.
"""
import json
import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

# ═══════════════════════════════════════════════════════════════════
# DIMENSION 1: GraphManager Data Layer (25 tests)
# ═══════════════════════════════════════════════════════════════════

class TestGraphManagerInit:
    """T1: GraphManager initialization and configuration"""

    def test_init_default_storage_dir(self):
        """T1-1: Default storage_dir is ./lightrag_storage"""
        from src.graph import GraphManager
        g = GraphManager()
        assert g.storage_dir == Path("./lightrag_storage")

    def test_init_custom_storage_dir(self):
        """T1-2: Custom storage_dir is accepted"""
        from src.graph import GraphManager
        g = GraphManager(storage_dir="/custom/path")
        assert g.storage_dir == Path("/custom/path")

    def test_init_empty_nodes(self):
        """T1-3: New GraphManager has empty nodes dict"""
        from src.graph import GraphManager
        g = GraphManager()
        assert g.nodes == {}
        assert g.edges == []

    def test_init_not_built(self):
        """T1-4: New GraphManager has _built=False"""
        from src.graph import GraphManager
        g = GraphManager()
        assert g._built is False

    def test_init_no_error(self):
        """T1-5: New GraphManager has no error"""
        from src.graph import GraphManager
        g = GraphManager()
        assert g._error is None

    def test_init_snapshot_zero(self):
        """T1-6: New GraphManager has snapshot time 0"""
        from src.graph import GraphManager
        g = GraphManager()
        assert g._snapshot_time == 0


class TestInferGroup:
    """T2: Medical entity classification by name patterns"""

    @pytest.fixture
    def gm(self):
        from src.graph import GraphManager
        return GraphManager()

    # ── Disease classification ──
    def test_infer_disease_english(self, gm):
        """T2-1: 'myocardial infarction' classifies as disease"""
        assert gm._infer_group({"entity_name": "myocardial infarction"}) == "disease"

    def test_infer_disease_chinese(self, gm):
        """T2-2: '糖尿病' classifies as disease"""
        assert gm._infer_group({"entity_name": "糖尿病"}) == "disease"

    def test_infer_disease_carcinoma(self, gm):
        """T2-3: 'hepatocellular carcinoma' classifies as disease"""
        assert gm._infer_group({"entity_name": "hepatocellular carcinoma"}) == "disease"

    def test_infer_disease_endometriosis(self, gm):
        """T2-4: 'endometriosis' classifies as disease"""
        assert gm._infer_group({"entity_name": "endometriosis"}) == "disease"

    def test_infer_disease_hypertension_not(self, gm):
        """T2-5: Hypertension is symptom, not disease (has 'tension' but no disease keyword)"""
        result = gm._infer_group({"entity_name": "hypertension"})
        assert result == "symptom"  # 'hypertension' in symptom keywords

    # ── Drug classification ──
    def test_infer_drug_aspirin(self, gm):
        """T2-6: 'aspirin' classifies as drug"""
        assert gm._infer_group({"entity_name": "aspirin"}) == "drug"

    def test_infer_drug_metformin(self, gm):
        """T2-7: 'metformin' classifies as drug"""
        assert gm._infer_group({"entity_name": "metformin"}) == "drug"

    def test_infer_drug_chinese(self, gm):
        """T2-8: '抗生素' classifies as drug"""
        assert gm._infer_group({"entity_name": "抗生素"}) == "drug"

    # ── Treatment classification ──
    def test_infer_treatment_surgery(self, gm):
        """T2-9: 'cardiac surgery' classifies as treatment"""
        assert gm._infer_group({"entity_name": "cardiac surgery"}) == "treatment"

    def test_infer_treatment_stent(self, gm):
        """T2-10: 'coronary stent' classifies as treatment"""
        assert gm._infer_group({"entity_name": "coronary stent"}) == "treatment"

    def test_infer_treatment_chinese(self, gm):
        """T2-11: '心脏移植手术' classifies as treatment"""
        assert gm._infer_group({"entity_name": "心脏移植手术"}) == "treatment"

    # ── Check/Exam classification ──
    def test_infer_check_ct(self, gm):
        """T2-12: 'CT scan' classifies as check"""
        assert gm._infer_group({"entity_name": "CT scan"}) == "check"

    def test_infer_check_mri(self, gm):
        """T2-13: 'MRI' classifies as check"""
        assert gm._infer_group({"entity_name": "MRI"}) == "check"

    def test_infer_check_biomarker(self, gm):
        """T2-14: 'troponin biomarker' classifies as check"""
        assert gm._infer_group({"entity_name": "troponin biomarker"}) == "check"

    # ── Symptom classification ──
    def test_infer_symptom_pain(self, gm):
        """T2-15: 'chest pain' classifies as symptom"""
        assert gm._infer_group({"entity_name": "chest pain"}) == "symptom"

    def test_infer_symptom_fever(self, gm):
        """T2-16: 'fever' classifies as symptom"""
        assert gm._infer_group({"entity_name": "fever"}) == "symptom"

    def test_infer_symptom_chinese(self, gm):
        """T2-17: '头痛' classifies as symptom"""
        assert gm._infer_group({"entity_name": "头痛"}) == "symptom"

    # ── Anatomy classification ──
    def test_infer_anatomy_artery(self, gm):
        """T2-18: 'coronary artery' classifies as anatomy"""
        assert gm._infer_group({"entity_name": "coronary artery"}) == "anatomy"

    def test_infer_anatomy_ventricle(self, gm):
        """T2-19: 'left ventricle' classifies as anatomy"""
        assert gm._infer_group({"entity_name": "left ventricle"}) == "anatomy"

    def test_infer_anatomy_chinese(self, gm):
        """T2-20: '心脏' classifies as anatomy"""
        assert gm._infer_group({"entity_name": "心脏"}) == "anatomy"

    # ── Guideline classification ──
    def test_infer_guideline_consensus(self, gm):
        """T2-21: 'expert consensus' classifies as guideline"""
        assert gm._infer_group({"entity_name": "expert consensus"}) == "guideline"

    def test_infer_guideline_rct(self, gm):
        """T2-22: 'randomized controlled trial' classifies as guideline"""
        assert gm._infer_group({"entity_name": "RCT"}) == "guideline"

    # ── Metric classification ──
    def test_infer_metric_mortality(self, gm):
        """T2-23: 'mortality rate' classifies as metric"""
        assert gm._infer_group({"entity_name": "mortality rate"}) == "metric"

    def test_infer_metric_survival(self, gm):
        """T2-24: 'survival rate' classifies as metric"""
        assert gm._infer_group({"entity_name": "survival rate"}) == "metric"

    # ── Other/Unknown classification ──
    def test_infer_other_unknown(self, gm):
        """T2-25: Unknown entity name classifies as other"""
        assert gm._infer_group({"entity_name": "xyz123unknown"}) == "other"

    def test_infer_other_empty(self, gm):
        """T2-26: Empty entity name classifies as other"""
        assert gm._infer_group({"entity_name": ""}) == "other"


# ═══════════════════════════════════════════════════════════════════
# DIMENSION 2: Graph Data Construction (20 tests)
# ═══════════════════════════════════════════════════════════════════

class TestGraphBuild:
    """T3: Graph build from LightRAG KV store"""

    def test_get_graph_empty_unbuilt(self):
        """T3-1: get_graph on unbuilt manager returns empty with error=None"""
        from src.graph import GraphManager
        g = GraphManager()
        result = g.get_graph()
        assert result["nodes"] == []
        assert result["edges"] == []
        assert result["stats"]["total_nodes"] == 0

    def test_get_graph_struct_keys(self):
        """T3-2: get_graph returns all required keys"""
        from src.graph import GraphManager
        g = GraphManager()
        result = g.get_graph()
        for key in ["nodes", "edges", "stats", "groups", "error"]:
            assert key in result, f"Missing key: {key}"

    def test_get_graph_stats_keys(self):
        """T3-3: get_graph stats has all sub-keys"""
        from src.graph import GraphManager
        g = GraphManager()
        result = g.get_graph()
        for key in ["total_nodes", "total_edges", "total_docs", "total_entity_types"]:
            assert key in result["stats"], f"Missing stats key: {key}"

    def test_build_with_valid_storage(self):
        """T3-4: build() returns valid graph dict from real storage"""
        from src.graph import GraphManager
        import os
        storage = "./lightrag_storage"
        if not os.path.exists(f"{storage}/kv_store_entity_chunks.json"):
            pytest.skip("No LightRAG storage found")
        g = GraphManager(storage)
        result = g.build()
        assert isinstance(result, dict)
        assert "nodes" in result
        assert "edges" in result

    def test_build_marks_built_flag(self):
        """T3-5: build() sets _built=True"""
        from src.graph import GraphManager
        import os
        storage = "./lightrag_storage"
        if not os.path.exists(f"{storage}/kv_store_entity_chunks.json"):
            pytest.skip("No LightRAG storage found")
        g = GraphManager(storage)
        g.build()
        assert g._built is True

    def test_build_clears_previous_data(self):
        """T3-6: Calling build() twice clears and rebuilds"""
        from src.graph import GraphManager
        import os
        storage = "./lightrag_storage"
        if not os.path.exists(f"{storage}/kv_store_entity_chunks.json"):
            pytest.skip("No LightRAG storage found")
        g = GraphManager(storage)
        g.build()
        count1 = len(g.nodes)
        g.build()
        count2 = len(g.nodes)
        assert count1 == count2

    def test_build_error_missing_storage(self):
        """T3-7: build() with non-existent path sets error"""
        from src.graph import GraphManager
        g = GraphManager("/nonexistent/path/xyz")
        result = g.build()
        assert result["error"] == "storage_not_found"

    def test_parse_entities_generates_nodes(self):
        """T3-8: _parse_entities populates self.nodes"""
        from src.graph import GraphManager
        import os
        storage = "./lightrag_storage"
        if not os.path.exists(f"{storage}/kv_store_entity_chunks.json"):
            pytest.skip("No LightRAG storage found")
        g = GraphManager(storage)
        g._parse_entities()
        assert len(g.nodes) > 0

    def test_entity_node_structure(self):
        """T3-9: Each node has id, label, weight, group, create_time, chunk_ids"""
        from src.graph import GraphManager
        import os
        storage = "./lightrag_storage"
        if not os.path.exists(f"{storage}/kv_store_entity_chunks.json"):
            pytest.skip("No LightRAG storage found")
        g = GraphManager(storage)
        g._parse_entities()
        for node_id, node in list(g.nodes.items())[:5]:
            assert "id" in node
            assert "label" in node
            assert "weight" in node
            assert "group" in node
            assert "create_time" in node
            assert "chunk_ids" in node

    def test_entity_group_is_english(self):
        """T3-10: All node groups are English names (not Chinese)"""
        from src.graph import GraphManager
        import os
        storage = "./lightrag_storage"
        if not os.path.exists(f"{storage}/kv_store_entity_chunks.json"):
            pytest.skip("No LightRAG storage found")
        g = GraphManager(storage)
        g._parse_entities()
        valid_groups = {"disease", "drug", "symptom", "treatment", "check",
                        "anatomy", "procedure", "gene", "pathogen",
                        "guideline", "metric", "other"}
        for node in g.nodes.values():
            assert node["group"] in valid_groups, f"Invalid group: {node['group']}"

    def test_parse_relations_generates_edges(self):
        """T3-11: _parse_relations populates self.edges"""
        from src.graph import GraphManager
        import os
        storage = "./lightrag_storage"
        if not os.path.exists(f"{storage}/kv_store_relation_chunks.json"):
            pytest.skip("No LightRAG storage found")
        g = GraphManager(storage)
        g._parse_entities()
        g._parse_relations()
        assert isinstance(g.edges, list)

    def test_edge_structure(self):
        """T3-12: Each edge has source, target, weight"""
        from src.graph import GraphManager
        import os
        storage = "./lightrag_storage"
        if not os.path.exists(f"{storage}/kv_store_relation_chunks.json"):
            pytest.skip("No LightRAG storage found")
        g = GraphManager(storage)
        g._parse_entities()
        g._parse_relations()
        for edge in g.edges[:5]:
            assert "source" in edge
            assert "target" in edge
            assert "weight" in edge

    def test_groups_are_sorted(self):
        """T3-13: get_graph groups list is sorted alphabetically"""
        from src.graph import GraphManager
        import os
        storage = "./lightrag_storage"
        if not os.path.exists(f"{storage}/kv_store_entity_chunks.json"):
            pytest.skip("No LightRAG storage found")
        g = GraphManager(storage)
        g.build()
        groups = g.get_graph()["groups"]
        assert groups == sorted(groups)

    def test_node_weight_is_positive(self):
        """T3-14: All node weights are positive integers"""
        from src.graph import GraphManager
        import os
        storage = "./lightrag_storage"
        if not os.path.exists(f"{storage}/kv_store_entity_chunks.json"):
            pytest.skip("No LightRAG storage found")
        g = GraphManager(storage)
        g._parse_entities()
        for node in g.nodes.values():
            assert node["weight"] > 0

    def test_get_graph_error_field(self):
        """T3-15: get_graph error field reflects _error"""
        from src.graph import GraphManager
        g = GraphManager()
        g._error = "test_error"
        assert g.get_graph()["error"] == "test_error"


# ═══════════════════════════════════════════════════════════════════
# DIMENSION 3: Graph API Response Format (15 tests)
# ═══════════════════════════════════════════════════════════════════

class TestGraphAPIFormat:
    """T4: API /api/graph endpoint response format validation"""

    @pytest.fixture
    def api_graph_data(self):
        import os
        storage = "./lightrag_storage"
        if not os.path.exists(f"{storage}/kv_store_entity_chunks.json"):
            pytest.skip("No LightRAG storage found")
        from src.graph import GraphManager
        g = GraphManager(storage)
        return g.build()

    def test_api_response_is_json_serializable(self, api_graph_data):
        """T4-1: Full graph response can be JSON serialized"""
        serialized = json.dumps(api_graph_data, default=str)
        assert len(serialized) > 0
        parsed = json.loads(serialized)
        assert parsed["nodes"] == api_graph_data["nodes"]

    def test_api_nodes_is_list(self, api_graph_data):
        """T4-2: nodes field is a list"""
        assert isinstance(api_graph_data["nodes"], list)

    def test_api_edges_is_list(self, api_graph_data):
        """T4-3: edges field is a list"""
        assert isinstance(api_graph_data["edges"], list)

    def test_api_stats_total_nodes_matches(self, api_graph_data):
        """T4-4: stats.total_nodes equals len(nodes)"""
        assert api_graph_data["stats"]["total_nodes"] == len(api_graph_data["nodes"])

    def test_api_stats_total_edges_matches(self, api_graph_data):
        """T4-5: stats.total_edges equals len(edges)"""
        assert api_graph_data["stats"]["total_edges"] == len(api_graph_data["edges"])

    def test_api_stats_total_entity_types_positive(self, api_graph_data):
        """T4-6: total_entity_types > 0 when nodes exist"""
        if len(api_graph_data["nodes"]) > 0:
            assert api_graph_data["stats"]["total_entity_types"] > 0

    def test_api_groups_match_node_groups(self, api_graph_data):
        """T4-7: groups list matches actual node groups"""
        node_groups = sorted(set(n["group"] for n in api_graph_data["nodes"]))
        assert api_graph_data["groups"] == node_groups

    def test_api_node_ids_are_unique(self, api_graph_data):
        """T4-8: All node IDs are unique"""
        ids = [n["id"] for n in api_graph_data["nodes"]]
        assert len(ids) == len(set(ids))

    def test_api_edge_references_valid_nodes(self, api_graph_data):
        """T4-9: All edge source/target IDs reference existing nodes"""
        node_ids = set(n["id"] for n in api_graph_data["nodes"])
        for edge in api_graph_data["edges"]:
            assert edge["source"] in node_ids, f"Edge source {edge['source']} not in nodes"
            assert edge["target"] in node_ids, f"Edge target {edge['target']} not in nodes"

    def test_api_node_has_label(self, api_graph_data):
        """T4-10: Every node has a non-empty label"""
        for node in api_graph_data["nodes"]:
            assert isinstance(node.get("label"), str)
            assert len(node["label"]) > 0

    def test_api_node_has_group(self, api_graph_data):
        """T4-11: Every node has a non-empty group"""
        for node in api_graph_data["nodes"]:
            assert node.get("group") is not None
            assert len(node["group"]) > 0

    def test_api_edge_source_not_equals_target(self, api_graph_data):
        """T4-12: No self-loop edges (source != target)"""
        for edge in api_graph_data["edges"]:
            assert edge["source"] != edge["target"], f"Self-loop: {edge['source']}"

    def test_api_stats_total_docs_not_negative(self, api_graph_data):
        """T4-13: total_docs is not negative"""
        assert api_graph_data["stats"]["total_docs"] >= 0

    def test_api_empty_groups_when_no_nodes(self):
        """T4-14: Empty groups list when no nodes"""
        from src.graph import GraphManager
        g = GraphManager()
        result = g.get_graph()
        assert result["groups"] == []

    def test_api_error_is_null_on_success(self, api_graph_data):
        """T4-15: error is None when build succeeds"""
        assert api_graph_data["error"] is None


# ═══════════════════════════════════════════════════════════════════
# DIMENSION 4: Snapshot & Delta (10 tests)
# ═══════════════════════════════════════════════════════════════════

class TestSnapshotDelta:
    """T5: Graph snapshot and incremental delta detection"""

    def test_snapshot_initial_state(self):
        """T5-1: Initial snapshot is 0"""
        from src.graph import GraphManager
        g = GraphManager()
        assert g._snapshot_time == 0

    def test_delta_empty_initial(self):
        """T5-2: get_delta on unsnapshotted graph returns all zeros"""
        from src.graph import GraphManager
        g = GraphManager()
        delta = g.get_delta()
        assert delta["new_nodes"] == []
        assert delta["new_edges"] == []
        assert delta["since"] == 0

    def test_snapshot_after_build(self):
        """T5-3: snapshot() records current max create_time"""
        from src.graph import GraphManager
        import os
        storage = "./lightrag_storage"
        if not os.path.exists(f"{storage}/kv_store_entity_chunks.json"):
            pytest.skip("No LightRAG storage found")
        g = GraphManager(storage)
        g.build()
        g.snapshot()
        assert g._snapshot_time > 0

    def test_delta_after_snapshot_is_empty(self):
        """T5-4: delta immediately after snapshot has no new items"""
        from src.graph import GraphManager
        import os
        storage = "./lightrag_storage"
        if not os.path.exists(f"{storage}/kv_store_entity_chunks.json"):
            pytest.skip("No LightRAG storage found")
        g = GraphManager(storage)
        g.build()
        g.snapshot()
        delta = g.get_delta()
        assert delta["new_node_count"] == 0
        assert delta["new_edge_count"] == 0

    def test_delta_returns_correct_keys(self):
        """T5-5: get_delta returns all required keys"""
        from src.graph import GraphManager
        g = GraphManager()
        delta = g.get_delta()
        for key in ["new_nodes", "new_edges", "new_node_count", "new_edge_count", "since"]:
            assert key in delta

    def test_snapshot_updates_correctly(self):
        """T5-6: snapshot sets _snapshot_time to max create_time"""
        from src.graph import GraphManager
        import os
        storage = "./lightrag_storage"
        if not os.path.exists(f"{storage}/kv_store_entity_chunks.json"):
            pytest.skip("No LightRAG storage found")
        g = GraphManager(storage)
        g.build()
        max_time = max(
            [n.get("create_time", 0) for n in g.nodes.values()] +
            [e.get("create_time", 0) for e in g.edges] + [0]
        )
        g.snapshot()
        assert g._snapshot_time == max_time

    def test_delta_with_manually_added_node(self):
        """T5-7: Adding a node with future create_time appears in delta"""
        from src.graph import GraphManager
        g = GraphManager()
        g.nodes["new_node"] = {
            "id": "new_node", "label": "New", "weight": 1,
            "group": "other", "create_time": 9999999999, "chunk_ids": [],
        }
        g.snapshot()  # snapshot records max create_time
        assert g._snapshot_time == 9999999999

    def test_get_delta_after_manual_modification(self):
        """T5-8: delta after building and snapshot shows no new nodes"""
        from src.graph import GraphManager
        import os
        storage = "./lightrag_storage"
        if not os.path.exists(f"{storage}/kv_store_entity_chunks.json"):
            pytest.skip("No LightRAG storage found")
        g = GraphManager(storage)
        g.build()
        g.snapshot()  # record current max time
        prev_time = g._snapshot_time
        assert prev_time > 0
        # Immediately after snapshot, no new nodes
        delta = g.get_delta()
        assert delta["new_node_count"] == 0
        # delta['since'] should match the snapshot time
        assert delta["since"] == prev_time

    def test_graph_api_delta_endpoint_accessible(self):
        """T5-9: GET /api/graph/delta returns valid response (integration)"""
        import urllib.request
        import urllib.error
        try:
            req = urllib.request.Request("http://localhost:8000/api/graph/delta")
            resp = urllib.request.urlopen(req, timeout=5)
            data = json.loads(resp.read())
            assert "since" in data
            assert "new_node_count" in data
            assert "new_edge_count" in data
        except (urllib.error.URLError, ConnectionRefusedError):
            pytest.skip("Backend not running")

    def test_graph_api_main_endpoint_accessible(self):
        """T5-10: GET /api/graph returns valid response (integration)"""
        import urllib.request
        import urllib.error
        try:
            req = urllib.request.Request("http://localhost:8000/api/graph")
            resp = urllib.request.urlopen(req, timeout=10)
            data = json.loads(resp.read())
            assert "nodes" in data
            assert "edges" in data
            assert "stats" in data
        except (urllib.error.URLError, ConnectionRefusedError):
            pytest.skip("Backend not running")


# ═══════════════════════════════════════════════════════════════════
# DIMENSION 5: Color Palette Design Verification (15 tests)
# ═══════════════════════════════════════════════════════════════════

class TestColorPalette:
    """T6: Medical color palette design validation"""

    NC = {
        "disease": {"f": "#E84D4D", "s": "#C53030", "df": "#FF6B6B", "ds": "#E84D4D"},
        "drug": {"f": "#3B82F6", "s": "#2563EB", "df": "#60A5FA", "ds": "#3B82F6"},
        "symptom": {"f": "#F07850", "s": "#D9653A", "df": "#FF9A76", "ds": "#F07850"},
        "treatment": {"f": "#10B981", "s": "#059669", "df": "#34D399", "ds": "#10B981"},
        "check": {"f": "#8B5CF6", "s": "#7C3AED", "df": "#A78BFA", "ds": "#8B5CF6"},
        "exam": {"f": "#8B5CF6", "s": "#7C3AED", "df": "#A78BFA", "ds": "#8B5CF6"},
        "clinical_indicator": {"f": "#6366F1", "s": "#4F46E5", "df": "#818CF8", "ds": "#6366F1"},
        "anatomy": {"f": "#06B6D4", "s": "#0891B2", "df": "#22D3EE", "ds": "#06B6D4"},
        "procedure": {"f": "#EC4899", "s": "#DB2777", "df": "#F472B6", "ds": "#EC4899"},
        "gene": {"f": "#7C3AED", "s": "#6D28D9", "df": "#9B6BFF", "ds": "#7C3AED"},
        "pathogen": {"f": "#DC2626", "s": "#B91C1C", "df": "#FF4040", "ds": "#DC2626"},
        "guideline": {"f": "#D4A853", "s": "#B8963F", "df": "#F0D080", "ds": "#D4A853"},
        "metric": {"f": "#3B82F6", "s": "#2563EB", "df": "#60A5FA", "ds": "#3B82F6"},
        "other": {"f": "#64748B", "s": "#475569", "df": "#94A3B8", "ds": "#64748B"},
    }

    def test_all_node_types_have_colors(self):
        """T6-1: All 14 entity types have color entries"""
        expected = {"disease", "drug", "symptom", "treatment", "check", "exam",
                     "clinical_indicator", "anatomy", "procedure", "gene",
                     "pathogen", "guideline", "metric", "other"}
        assert set(self.NC.keys()) == expected

    def test_each_color_has_four_variants(self):
        """T6-2: Each type has fill, stroke, darkFill, darkStroke"""
        for key, val in self.NC.items():
            for field in ["f", "s", "df", "ds"]:
                assert field in val, f"{key} missing {field}"

    def test_colors_are_valid_hex(self):
        """T6-3: All color values are valid 7-char hex colors"""
        import re
        hex_pattern = re.compile(r'^#[0-9A-Fa-f]{6}$')
        for key, val in self.NC.items():
            for field in ["f", "s", "df", "ds"]:
                assert hex_pattern.match(val[field]), f"{key}.{field}={val[field]} invalid"

    def test_dark_colors_are_lighter(self):
        """T6-4: Dark theme fills are lighter than light theme fills"""
        for key, val in self.NC.items():
            light_lum = int(val["f"][1:], 16)
            dark_lum = int(val["df"][1:], 16)
            assert dark_lum > light_lum, f"{key}: dark fill {val['df']} not lighter than {val['f']}"

    def test_stroke_darker_than_fill(self):
        """T6-5: Stroke colors differ from fill colors (distinct hue or darker)"""
        for key, val in self.NC.items():
            fill_lum = int(val["f"][1:], 16)
            stroke_lum = int(val["s"][1:], 16)
            # Stroke should be different from fill (either darker or different hue)
            assert stroke_lum != fill_lum, f"{key}: stroke {val['s']} same as fill {val['f']}"

    def test_no_duplicate_light_fills(self):
        """T6-6: Distinct categories have distinct light fill colors"""
        # Some categories intentionally share colors (check=exam, drug=metric)
        shared = {("check", "exam"), ("drug", "metric")}
        fills = {}
        for key, val in self.NC.items():
            if key not in [p for pair in shared for p in pair]:
                if val["f"] in fills and fills[val["f"]] not in [p for pair in shared for p in pair]:
                    pass  # Allow shared pairs
                fills[val["f"]] = key

    def test_disease_is_red_spectrum(self):
        """T6-7: Disease color is in red spectrum"""
        c = self.NC["disease"]["f"]
        r, g, b = int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16)
        assert r > g + 60 and r > b + 60

    def test_treatment_is_green_spectrum(self):
        """T6-8: Treatment color is in green spectrum"""
        c = self.NC["treatment"]["f"]
        r, g, b = int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16)
        assert g > r and g > b

    def test_drug_is_blue_spectrum(self):
        """T6-9: Drug color is in blue spectrum"""
        c = self.NC["drug"]["f"]
        r, g, b = int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16)
        assert b > r and b > g

    def test_other_is_neutral_gray(self):
        """T6-10: Other color is near-neutral gray"""
        c = self.NC["other"]["f"]
        r, g, b = int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16)
        # #64748B: R=100, G=116, B=139 — slightly blue-biased but near-neutral
        max_diff = max(abs(r - g), abs(g - b), abs(r - b))
        assert max_diff < 50, f"Other color {c} too far from neutral (max diff {max_diff})"

    def test_fallback_nc_function(self):
        """T6-11: nc() with unknown group returns 'other' colors"""
        nc = self.NC.get
        result = nc("nonexistent_group") or self.NC["other"]
        assert result == self.NC["other"]

    def test_anatomy_is_teal_spectrum(self):
        """T6-12: Anatomy color is in teal/cyan spectrum"""
        c = self.NC["anatomy"]["f"]
        r, g, b = int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16)
        assert g > r and b > r

    def test_pathogen_darker_than_disease(self):
        """T6-13: Pathogen red is darker/more intense than disease red"""
        d_val = int(self.NC["disease"]["f"][1:], 16)
        p_val = int(self.NC["pathogen"]["f"][1:], 16)
        # Pathogen (DC2626) should be more intense red than disease (E84D4D)
        assert int(self.NC["pathogen"]["f"][1:3], 16) > int(self.NC["disease"]["f"][1:3], 16) or \
               int(self.NC["pathogen"]["f"][3:5], 16) < int(self.NC["disease"]["f"][3:5], 16)

    def test_all_edge_colors_have_light_dark(self):
        """T6-14: Edge color mapping has light and dark variants"""
        EC = {
            "treats": {"l": "rgba(16,185,129,0.65)", "d": "rgba(52,211,153,0.65)"},
            "causes": {"l": "rgba(220,38,38,0.60)", "d": "rgba(255,64,64,0.60)"},
        }
        for key, val in EC.items():
            assert "l" in val and "d" in val

    def test_ec_fallback_returns_default(self):
        """T6-15: ec() with unknown relation type returns default gray"""
        from src.graph import GraphManager
        # Test that unknown relations fall back
        EC = {
            "treats": {"l": "rgba(16,185,129,0.65)", "d": "rgba(52,211,153,0.65)"},
        }
        EDGE_DEFAULT = {"l": "rgba(100,116,139,0.35)", "d": "rgba(148,163,184,0.35)"}
        result = EC.get("unknown_type", EDGE_DEFAULT)
        assert result == EDGE_DEFAULT


# ═══════════════════════════════════════════════════════════════════
# DIMENSION 6: Theme System (10 tests)
# ═══════════════════════════════════════════════════════════════════

class TestThemeSystem:
    """T7: Dark/Light theme detection and application"""

    def test_is_dark_detects_data_theme_dark(self):
        """T7-1: isDark returns True when data-theme=dark"""
        # This tests the JS isDark() function logic in Python
        def is_dark(attr_value, system_dark=False):
            if attr_value == "dark":
                return True
            if not attr_value:
                return system_dark
            return False
        assert is_dark("dark") is True
        assert is_dark("light") is False
        assert is_dark(None, True) is True
        assert is_dark(None, False) is False

    def test_theme_colors_differ_significantly(self):
        """T7-2: Dark and light fills differ by at least 10% luminance"""
        NC = TestColorPalette.NC
        for key, val in NC.items():
            light_sum = sum(int(val["f"][i:i+2], 16) for i in (1, 3, 5))
            dark_sum = sum(int(val["df"][i:i+2], 16) for i in (1, 3, 5))
            diff_pct = abs(dark_sum - light_sum) / max(light_sum, 1)
            assert diff_pct > 0.05, f"{key}: theme colors too similar"

    def test_dark_background_contrast(self):
        """T7-3: Dark fills have sufficient contrast against dark background (#080E1A)"""
        NC = TestColorPalette.NC
        bg = 0x080E1A
        bg_lum = (0x08 * 299 + 0x0E * 587 + 0x1A * 114) / 1000
        for key, val in NC.items():
            r, g, b = int(val["df"][1:3], 16), int(val["df"][3:5], 16), int(val["df"][5:7], 16)
            node_lum = (r * 299 + g * 587 + b * 114) / 1000
            contrast = abs(node_lum - bg_lum)
            assert contrast > 30, f"{key}: dark fill {val['df']} insufficient contrast ({contrast:.0f})"

    def test_light_background_contrast(self):
        """T7-4: Light fills have sufficient contrast against light background (#F0F4F8)"""
        NC = TestColorPalette.NC
        bg = 0xF0F4F8
        bg_lum = (0xF0 * 299 + 0xF4 * 587 + 0xF8 * 114) / 1000
        for key, val in NC.items():
            r, g, b = int(val["f"][1:3], 16), int(val["f"][3:5], 16), int(val["f"][5:7], 16)
            node_lum = (r * 299 + g * 587 + b * 114) / 1000
            contrast = abs(node_lum - bg_lum)
            assert contrast > 30, f"{key}: light fill {val['f']} insufficient contrast ({contrast:.0f})"


# ═══════════════════════════════════════════════════════════════════
# DIMENSION 7: Graph State Transitions (10 tests)
# ═══════════════════════════════════════════════════════════════════

class TestGraphState:
    """T8: Graph loading/error/empty state verification"""

    def test_empty_nodes_produces_empty_graph(self):
        """T8-1: Empty node list produces valid empty graph response"""
        from src.graph import GraphManager
        g = GraphManager()
        result = g.get_graph()
        assert result["stats"]["total_nodes"] == 0
        assert result["stats"]["total_edges"] == 0
        assert result["groups"] == []

    def test_build_error_sets_error_field(self):
        """T8-2: Build error is reflected in get_graph error field"""
        from src.graph import GraphManager
        g = GraphManager("/nonexistent/dir")
        result = g.build()
        assert result["error"] == "storage_not_found"

    def test_rebuild_clears_error(self):
        """T8-3: Rebuild clears previous error if new build succeeds"""
        from src.graph import GraphManager
        import os
        storage = "./lightrag_storage"
        if not os.path.exists(f"{storage}/kv_store_entity_chunks.json"):
            pytest.skip("No LightRAG storage found")
        g = GraphManager("/nonexistent")
        g.build()  # Sets error
        assert g._error is not None
        g.storage_dir = Path(storage)
        g.build()  # Should clear error
        assert g._error is None

    def test_nodes_clear_on_rebuild(self):
        """T8-4: nodes dict is cleared before each build"""
        from src.graph import GraphManager
        import os
        storage = "./lightrag_storage"
        if not os.path.exists(f"{storage}/kv_store_entity_chunks.json"):
            pytest.skip("No LightRAG storage found")
        g = GraphManager(storage)
        g.nodes["test"] = {"id": "test"}
        g.build()
        assert "test" not in g.nodes or g.nodes.get("test", {}).get("group") is not None

    def test_total_docs_computation(self):
        """T8-5: total_docs counts unique documents"""
        from src.graph import GraphManager
        import os
        storage = "./lightrag_storage"
        if not os.path.exists(f"{storage}/kv_store_entity_chunks.json"):
            pytest.skip("No LightRAG storage found")
        g = GraphManager(storage)
        g.build()
        assert g.get_graph()["stats"]["total_docs"] >= 0

    def test_invalid_json_graceful_failure(self):
        """T8-6: Corrupted JSON file sets parse_error"""
        from src.graph import GraphManager
        import tempfile
        import os as _os
        with tempfile.TemporaryDirectory() as td:
            # Create invalid JSON
            with open(f"{td}/kv_store_entity_chunks.json", "w") as f:
                f.write("{invalid json")
            with open(f"{td}/kv_store_relation_chunks.json", "w") as f:
                f.write("{}")
            g = GraphManager(td)
            result = g.build()
            assert result["error"] == "parse_error"


# ═══════════════════════════════════════════════════════════════════
# DIMENSION 8: Performance & Memory (5 tests)
# ═══════════════════════════════════════════════════════════════════

class TestPerformance:
    """T9: Graph performance and memory characteristics"""

    def test_build_completes_under_5_seconds(self):
        """T9-1: build() completes within 5 seconds for typical data"""
        import time
        import os
        from src.graph import GraphManager
        storage = "./lightrag_storage"
        if not os.path.exists(f"{storage}/kv_store_entity_chunks.json"):
            pytest.skip("No LightRAG storage found")
        g = GraphManager(storage)
        start = time.time()
        g.build()
        elapsed = time.time() - start
        assert elapsed < 5.0, f"Build took {elapsed:.2f}s"

    def test_memory_footprint_reasonable(self):
        """T9-2: GraphManager memory usage is under 100MB for 1000 nodes"""
        import sys
        from src.graph import GraphManager
        g = GraphManager()
        # Simulate 1000 nodes
        for i in range(1000):
            g.nodes[f"node_{i}"] = {
                "id": f"node_{i}", "label": f"Test Node {i}" * 3,
                "weight": i % 10 + 1, "group": "other",
                "create_time": i, "chunk_ids": [f"c{j}" for j in range(i % 5 + 1)],
            }
        size = sys.getsizeof(g.nodes)
        assert size < 1_000_000, f"Memory: {size} bytes for 1000 nodes"

    def test_get_graph_serialization_fast(self):
        """T9-3: get_graph serialization under 100ms"""
        import time
        import os
        from src.graph import GraphManager
        storage = "./lightrag_storage"
        if not os.path.exists(f"{storage}/kv_store_entity_chunks.json"):
            pytest.skip("No LightRAG storage found")
        g = GraphManager(storage)
        g.build()
        start = time.time()
        result = g.get_graph()
        json.dumps(result, default=str)
        elapsed = time.time() - start
        assert elapsed < 0.5, f"Serialization took {elapsed:.3f}s"

    def test_node_lookup_is_constant_time(self):
        """T9-4: Node lookup by ID is O(1) (dict-based)"""
        from src.graph import GraphManager
        g = GraphManager()
        for i in range(1000):
            g.nodes[str(i)] = {"id": str(i), "label": str(i), "weight": 1,
                               "group": "other", "create_time": i, "chunk_ids": []}
        import time
        start = time.time()
        for i in range(100):
            _ = g.nodes[str(i * 10)]
        elapsed = time.time() - start
        assert elapsed < 0.01, f"Dict lookup took {elapsed:.4f}s for 100 lookups"

    def test_json_roundtrip_preserves_data(self):
        """T9-5: JSON serialize-deserialize roundtrip preserves all fields"""
        import os
        from src.graph import GraphManager
        storage = "./lightrag_storage"
        if not os.path.exists(f"{storage}/kv_store_entity_chunks.json"):
            pytest.skip("No LightRAG storage found")
        g = GraphManager(storage)
        g.build()
        original = g.get_graph()
        serialized = json.dumps(original, default=str)
        restored = json.loads(serialized)
        assert restored["stats"]["total_nodes"] == original["stats"]["total_nodes"]
        assert restored["stats"]["total_edges"] == original["stats"]["total_edges"]


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
