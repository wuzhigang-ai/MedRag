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
    """Single-worker upload queue backed by MySQL upload_tasks table.

    State machine: received → parsing → chunking → indexing → done/partial/failed
    All state transitions are protected by timeouts and cancel checks.
    """

    def __init__(self, pipeline=None):
        self._queue = asyncio.Queue()
        self._pipeline = pipeline
        self._running = False
        self._worker_task = None
        self._cancel_signals: set[str] = set()
        self._processing_uuid: str | None = None

    @property
    def pipeline(self):
        return self._pipeline

    @pipeline.setter
    def pipeline(self, p):
        self._pipeline = p

    def set_pipeline(self, p):
        """Lazy-set pipeline after FastAPI starts (breaks import cycle)."""
        self._pipeline = p

    def cancel_task(self, task_uuid: str) -> str:
        """Request cancellation. Returns status: 'cancelled', 'completed', 'not_found'."""
        if task_uuid in self._cancel_signals:
            return "cancelled"
        from src.auth import get_task
        task = get_task(task_uuid)
        if not task:
            return "not_found"
        status = task.get("status", "")
        if status in ("done", "failed", "partial"):
            return "completed"
        if status not in ("received",):
            # Already being processed — cancel signals checked between stages
            self._cancel_signals.add(task_uuid)
            return "cancelling"
        # Still in queue — mark directly
        from src.auth import mark_task_failed
        mark_task_failed(task_uuid, "用户取消")
        return "cancelled"

    async def start(self):
        """Launch the background worker."""
        if self._running:
            return
        self._running = True
        # Smart recovery: don't blanket-mark all pending as failed.
        # Tasks in later stages can resume from where they left off.
        from src.auth import get_pending_tasks, mark_task_failed, update_task_status
        try:
            pending = get_pending_tasks()
            for task in pending:
                status = task.get("status", "")
                uuid = task["task_uuid"]
                if status == "received":
                    # Never started — safe to mark failed
                    mark_task_failed(uuid, "Server restarted before processing began")
                elif status == "parsing":
                    # Parsing interrupted — restart from scratch
                    mark_task_failed(uuid, "Server restarted during parsing")
                elif status in ("cross_validating", "indexing_faiss", "postprocessing", "chunking"):
                    # FAISS may have partial data — mark partial, user can re-upload
                    mark_task_failed(uuid, f"Server restarted during {status}. FAISS may have partial data — re-upload recommended.")
                elif status == "indexing_lightrag":
                    # FAISS is done, only LightRAG failed — mark partial (data is searchable)
                    update_task_status(uuid, "partial",
                        lightrag_error="Server restarted during LightRAG indexing")
                logger.info(f"Recovered task {uuid[:8]} (was {status})")
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

    def _check_cancel(self, task_uuid: str) -> bool:
        """Returns True if task was cancelled — caller should abort."""
        from src.auth import mark_task_failed
        if task_uuid in self._cancel_signals:
            mark_task_failed(task_uuid, "用户取消")
            self._cancel_signals.discard(task_uuid)
            return True
        return False

    async def _worker(self):
        """Single consumer — serializes all upload processing with timeouts."""
        from src.auth import (get_task, update_task_status, mark_task_completed,
                              mark_task_failed, create_upload_task)

        PARSE_TIMEOUT = 600.0      # 10 min per PDF (MinerU VLM ~72s/page + Docling images ~90s)
        CHUNK_TIMEOUT = 300.0      # 5 min for FAISS + MySQL
        LIGHTRAG_TIMEOUT = 300.0   # 5 min for LightRAG

        while self._running:
            task_uuid = None
            try:
                task_uuid = await self._queue.get()
                self._processing_uuid = task_uuid

                task = get_task(task_uuid)
                if not task:
                    logger.warning(f"Task {task_uuid[:8]} not found in DB, skipping")
                    self._queue.task_done()
                    continue

                filename = task["filename"]
                logger.info(f"Worker processing: {filename} ({task_uuid[:8]})")

                # ── Cancel check ──
                if self._check_cancel(task_uuid):
                    self._queue.task_done()
                    continue

                # ── Step 1: Parse (with timeout) ──
                update_task_status(task_uuid, "parsing")
                from src.audit_logger import audit_parse_start
                audit_parse_start(task_uuid, filename)
                t0 = time.time()
                try:
                    content_list_path = await asyncio.wait_for(
                        asyncio.to_thread(
                            self._pipeline.parse_remote_pdf,
                            task["original_pdf_path"] or f"uploads/{filename}"
                        ),
                        timeout=PARSE_TIMEOUT,
                    )
                except asyncio.TimeoutError:
                    mark_task_failed(task_uuid, f"解析超时 (>{PARSE_TIMEOUT}s)")
                    self._queue.task_done()
                    continue
                parsing_ms = int((time.time() - t0) * 1000)

                if not content_list_path:
                    mark_task_failed(task_uuid, "MinerU 2.5-Pro 解析失败")
                    self._queue.task_done()
                    continue

                up_state = getattr(self._pipeline, '_upload_state', {})
                update_task_status(task_uuid, "chunking",
                    parsing_duration_ms=parsing_ms,
                    engine_selected=up_state.get("engine", "unknown"),
                    engine_reason=up_state.get("engine_reason", ""),
                    quality_warning=up_state.get("quality_warning", "") or None,
                )

                if self._check_cancel(task_uuid):
                    self._queue.task_done()
                    continue

                # ── Step 2: FAISS + MySQL (atomic step with timeout) ──
                t0 = time.time()
                chunks_before = len(self._pipeline.all_chunks)
                try:
                    chunks_added = await asyncio.wait_for(
                        asyncio.to_thread(self._pipeline.add_parsed_document, content_list_path),
                        timeout=CHUNK_TIMEOUT,
                    )
                except asyncio.TimeoutError:
                    mark_task_failed(task_uuid, f"FAISS 索引超时 (>{CHUNK_TIMEOUT}s)")
                    self._queue.task_done()
                    continue
                faiss_ms = int((time.time() - t0) * 1000)

                chunks_after = len(self._pipeline.all_chunks)
                update_task_status(task_uuid, "chunking",
                    faiss_status="success" if chunks_added >= 0 else "failed",
                    faiss_duration_ms=faiss_ms,
                    faiss_chunks_before=chunks_before,
                    faiss_chunks_added=chunks_added if chunks_added > 0 else 0,
                    faiss_is_update=up_state.get("is_update", False),
                    faiss_error=None if chunks_added >= 0 else "FAISS add returned 0 chunks",
                    faiss_images_total=up_state.get("images_total", 0),
                    faiss_images_vlm=up_state.get("images_vlm", 0),
                )

                # MySQL sync (non-fatal)
                try:
                    from src.auth import sync_content_to_mysql
                    article_id = await asyncio.to_thread(sync_content_to_mysql, content_list_path)
                    logger.info(f"MySQL synced article #{article_id} for {filename}")
                except Exception as e:
                    logger.warning(f"MySQL sync failed (non-blocking): {e}")

                if self._check_cancel(task_uuid):
                    self._queue.task_done()
                    continue

                # ── Step 3: LightRAG (with timeout) ──
                update_task_status(task_uuid, "indexing",
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
                                self._pipeline._lightrag_reset_and_rebuild(), timeout=LIGHTRAG_TIMEOUT
                            )
                        else:
                            lightrag_mode = "insert"
                            await asyncio.wait_for(
                                self._pipeline._lightrag_insert_documents(), timeout=LIGHTRAG_TIMEOUT
                            )
                    except asyncio.TimeoutError:
                        lightrag_ok = False
                        lightrag_error = f"LightRAG 更新超时 (>{LIGHTRAG_TIMEOUT}s)"
                    except Exception as e:
                        lightrag_ok = False
                        lightrag_error = f"LightRAG 更新失败: {str(e)[:300]}"
                else:
                    lightrag_mode = "skipped"
                    lightrag_error = "LightRAG 未初始化"

                lightrag_ms = int((time.time() - t0) * 1000)
                try:
                    self._pipeline.graph_manager.build()
                except Exception as e:
                    logger.warning(f"GraphManager build failed: {e}")

                graph = self._pipeline.graph_manager.get_graph()
                stats = graph.get("stats", {})

                # Final: done or partial — partial is NOT overridden to failed
                final_status = "done" if lightrag_ok else "partial"
                update_task_status(task_uuid, final_status,
                    lightrag_status="success" if lightrag_ok else "failed",
                    lightrag_duration_ms=lightrag_ms,
                    lightrag_mode=lightrag_mode,
                    lightrag_entities=stats.get("total_nodes", 0),
                    lightrag_relations=stats.get("total_edges", 0),
                    lightrag_error=lightrag_error,
                )
                # Only call mark_task_completed/mark_task_failed for terminal DB-level cleanup
                # Do NOT override partial with failed — the status set above is authoritative
                if final_status == "done":
                    mark_task_completed(task_uuid)
                else:
                    # Use update_task_status to keep "partial" — mark_task_failed would override it
                    mark_task_failed(task_uuid, lightrag_error or "LightRAG 更新未完成（知识库仍可检索）")
                logger.info(f"Task {task_uuid[:8]} finished: {final_status}, "
                            f"{chunks_added} chunks, {stats.get('total_nodes', 0)} entities")

            except asyncio.CancelledError:
                if task_uuid:
                    try:
                        mark_task_failed(task_uuid, "Worker 关闭中")
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
                self._processing_uuid = None
                if task_uuid:
                    self._queue.task_done()


# ── Singleton ──

_task_manager: UploadTaskManager | None = None


def get_task_manager() -> UploadTaskManager:
    global _task_manager
    if _task_manager is None:
        _task_manager = UploadTaskManager()
    return _task_manager
