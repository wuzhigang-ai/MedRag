"""
医疗RAG知识库 — 核心创新模块

包含:
- medical_chunker: 医学语义分块引擎 (PICO + 临床试验结构)
- medical_vlm: 医学VLM多模态理解层 (Kimi-K2.6)
- medical_kg: 医学知识图谱增强 (证据等级 + 关系网络)
- dual_retriever: Vector-Graph双路检索引擎
- resilience: API容错与降级模块
- pipeline: 端到端知识库构建pipeline
"""