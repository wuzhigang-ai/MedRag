"""Upload task queue — serialized async worker with MySQL state machine.

Eliminates FAISS concurrent read/write, LightRAG rebuild races, and GPU model
contention by serializing all uploads through a single asyncio.Queue consumer.
"""

import asyncio
import hashlib
import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)


class UploadTaskManager:
    """Single-worker upload queue backed by MySQL upload_tasks table."""

    def __init__(self, pipeline=None):
        self._queue = asyncio.Queue()
        self._pipeline = pipeline
        self._running = False
        self._worker_task = None

    @property
    def pipeline(self):
        return self._pipeline

    @pipeline.setter
    def pipeline(self, p):
        self._pipeline = p

    def set_pipeline(self, p):
        """Lazy-set pipeline after FastAPI starts (breaks import cycle)."""
        self._pipeline = p

    async def start(self):
        """Launch the background worker."""
        if self._running:
            return
        self._running = True
        # On startup, mark all interrupted tasks as failed
        from src.auth import get_pending_tasks, mark_task_failed
        try:
            pending = get_pending_tasks()
            for task in pending:
                mark_task_failed(task["task_uuid"],
                                 "Server restarted while task was in progress")
                logger.info(f"Marked interrupted task {task['task_uuid'][:8]} as failed")
        except Exception as e:
            logger.warning(f"Failed to recover pending tasks: {e}")

        self._worker_task = asyncio.create_task(self._worker())
        logger.info("Upload task worker started")

    async def stop(self):
        """Graceful shutdown."""
        self._running = False
        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
        logger.info("Upload task worker stopped")

    async def enqueue(self, task_uuid: str):
        """Add a task to the upload queue. Returns immediately."""
        await self._queue.put(task_uuid)
        logger.info(f"Task {task_uuid[:8]} enqueued (qsize={self._queue.qsize()})")

    async def _worker(self):
        """Single consumer — serializes all upload processing."""
        from src.auth import (get_task, update_task_status, mark_task_completed,
                              mark_task_failed, create_upload_task)

        while self._running:
            task_uuid = None
            try:
                task_uuid = await self._queue.get()

                task = get_task(task_uuid)
                if not task:
                    logger.warning(f"Task {task_uuid[:8]} not found in DB, skipping")
                    self._queue.task_done()
                    continue

                filename = task["filename"]
                logger.info(f"Worker processing: {filename} ({task_uuid[:8]})")

                # Step 1: Parse
                update_task_status(task_uuid, "parsing")
                t0 = time.time()
                content_list_path = await asyncio.to_thread(
                    self._pipeline.parse_remote_pdf,
                    task["original_pdf_path"] or f"uploads/{filename}"
                )
                parsing_ms = int((time.time() - t0) * 1000)

                if not content_list_path:
                    mark_task_failed(task_uuid, "All 3 parsers failed (Docling + MinerU + PaddleOCR)")
                    self._queue.task_done()
                    continue

                # Collect parse stats from pipeline's upload state
                up_state = getattr(self._pipeline, '_upload_state', {})
                update_task_status(task_uuid, "cross_validating",
                    parsing_duration_ms=parsing_ms,
                    engine_selected=up_state.get("engine", "unknown"),
                    engine_reason=up_state.get("engine_reason", ""),
                    cross_validation_scores=json.dumps(up_state.get("cross_validation_scores", {})) if up_state.get("cross_validation_scores") else None,
                    quality_warning=up_state.get("quality_warning", "") or None,
                )

                # Step 2: Index into FAISS
                update_task_status(task_uuid, "indexing_faiss",
                    faiss_status="processing",
                    faiss_started_at=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"))
                t0 = time.time()
                chunks_before = len(self._pipeline.all_chunks)
                docs_before = self._pipeline.doc_count

                chunks_added = await asyncio.to_thread(
                    self._pipeline.add_parsed_document, content_list_path
                )
                faiss_ms = int((time.time() - t0) * 1000)

                chunks_after = len(self._pipeline.all_chunks)
                update_task_status(task_uuid, "indexing_faiss",
                    faiss_status="success" if chunks_added >= 0 else "failed",
                    faiss_duration_ms=faiss_ms,
                    faiss_chunks_before=chunks_before,
                    faiss_chunks_added=chunks_added if chunks_added > 0 else 0,
                    faiss_is_update=up_state.get("is_update", False),
                    faiss_error=None if chunks_added >= 0 else "FAISS add returned 0 chunks",
                    faiss_images_total=up_state.get("images_total", 0),
                    faiss_images_vlm=up_state.get("images_vlm", 0),
                )

                # Step 3: LightRAG sync
                update_task_status(task_uuid, "indexing_lightrag",
                    lightrag_status="processing",
                    lightrag_started_at=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"))
                t0 = time.time()

                lightrag_ok = True
                lightrag_error = None
                if self._pipeline._lightrag_ready:
                    try:
                        if self._pipeline._lightrag_dirty:
                            lightrag_mode = "reset_rebuild"
                            await asyncio.wait_for(
                                self._pipeline._lightrag_reset_and_rebuild(), timeout=120.0
                            )
                        else:
                            lightrag_mode = "insert"
                            await asyncio.wait_for(
                                self._pipeline._lightrag_insert_documents(), timeout=60.0
                            )
                    except asyncio.TimeoutError:
                        lightrag_ok = False
                        lightrag_error = "LightRAG update timed out"
                    except Exception as e:
                        lightrag_ok = False
                        lightrag_error = f"LightRAG update failed: {str(e)[:300]}"
                else:
                    lightrag_mode = "skipped"
                    lightrag_error = "LightRAG not initialized"

                lightrag_ms = int((time.time() - t0) * 1000)
                self._pipeline.graph_manager.build()

                # Get LightRAG stats
                graph = self._pipeline.graph_manager.get_graph()
                stats = graph.get("stats", {})

                final_status = "done" if lightrag_ok else "partial"
                update_task_status(task_uuid, final_status,
                    lightrag_status="success" if lightrag_ok else "failed",
                    lightrag_duration_ms=lightrag_ms,
                    lightrag_mode=lightrag_mode,
                    lightrag_entities=stats.get("total_nodes", 0),
                    lightrag_relations=stats.get("total_edges", 0),
                    lightrag_error=lightrag_error,
                )
                if final_status == "done":
                    mark_task_completed(task_uuid)
                else:
                    mark_task_failed(task_uuid, lightrag_error or "LightRAG update failed")
                logger.info(f"Task {task_uuid[:8]} completed: {chunks_added} chunks, "
                            f"{stats.get('total_nodes', 0)} entities")

            except asyncio.CancelledError:
                if task_uuid:
                    try:
                        mark_task_failed(task_uuid, "Worker shutdown during processing")
                    except Exception:
                        pass
                break
            except Exception as e:
                logger.error(f"Task {task_uuid or '?'} failed: {e}")
                if task_uuid:
                    try:
                        mark_task_failed(task_uuid, str(e)[:500])
                    except Exception:
                        pass
            finally:
                if task_uuid:
                    self._queue.task_done()


# ── Singleton ──

_task_manager: UploadTaskManager | None = None


def get_task_manager() -> UploadTaskManager:
    global _task_manager
    if _task_manager is None:
        _task_manager = UploadTaskManager()
    return _task_manager
