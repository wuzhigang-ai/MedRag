"""
API容错与降级模块 (Resilience Module)

多层容错保障:
1. 指数退避重试 (3次: 1s→2s→4s)
2. 模型降级链: DeepSeek-V4-Pro → GLM-5.1 → 缓存兜底
3. VLM降级: Kimi-K2.6 → 纯文本LLM描述图表
4. 解析失败自动标记 + 降级处理
"""

import asyncio
import logging
import time
import json
import hashlib
from typing import Any, Callable, Dict, Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class RetryConfig:
    max_retries: int = 3
    base_delay: float = 1.0
    backoff_factor: float = 2.0
    max_delay: float = 30.0


@dataclass
class FallbackConfig:
    text_model_chain: list = field(default_factory=lambda: ["DeepSeek-V4-Pro", "GLM-5.1"])
    vision_model_chain: list = field(default_factory=lambda: ["Kimi-K2.6"])
    enable_cache_fallback: bool = True


@dataclass
class ResilienceResult:
    success: bool
    data: Any = None
    error: Optional[str] = None
    retry_count: int = 0
    model_used: str = ""
    fallback_used: bool = False


class APIResilience:
    """API容错管理器 — 适配OpenAI client"""

    def __init__(
        self,
        client,
        retry_config: Optional[RetryConfig] = None,
        fallback_config: Optional[FallbackConfig] = None,
    ):
        self.client = client
        self.retry_config = retry_config or RetryConfig()
        self.fallback_config = fallback_config or FallbackConfig()
        self.cache: Dict[str, str] = {}

    def _cache_key(self, prompt: str) -> str:
        return hashlib.md5(prompt[:500].encode()).hexdigest()

    async def call_with_retry(
        self,
        model: str,
        messages: list,
        temperature: float = 0.3,
        max_tokens: int = 800,
        max_retries: int = None,
    ) -> ResilienceResult:
        """带指数退避重试的LLM调用"""
        max_retries = max_retries or self.retry_config.max_retries
        last_error = None

        for attempt in range(max_retries + 1):
            try:
                response = await asyncio.to_thread(
                    lambda: self.client.chat.completions.create(
                        model=model,
                        messages=messages,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        timeout=30.0,
                    )
                )
                return ResilienceResult(
                    success=True,
                    data=response.choices[0].message.content,
                    retry_count=attempt,
                    model_used=model,
                )
            except Exception as e:
                last_error = str(e)
                if attempt < max_retries:
                    delay = min(
                        self.retry_config.base_delay * (self.retry_config.backoff_factor ** attempt),
                        self.retry_config.max_delay,
                    )
                    logger.warning(
                        f"LLM call failed ({model}, attempt {attempt + 1}/{max_retries + 1}), "
                        f"retrying in {delay:.1f}s: {last_error[:150]}"
                    )
                    await asyncio.sleep(delay)

        return ResilienceResult(
            success=False, error=last_error, retry_count=max_retries, model_used=model
        )

    async def call_text_with_fallback(
        self,
        prompt: str,
        system_prompt: str = None,
        model: str = None,
    ) -> ResilienceResult:
        """文本模型调用 + 降级链"""
        chain = [model] if model else self.fallback_config.text_model_chain
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        for i, model_name in enumerate(chain):
            result = await self.call_with_retry(model_name, messages)
            if result.success:
                result.fallback_used = (i > 0)
                return result
            logger.warning(f"Model {model_name} failed: {result.error}")

        # Cache fallback
        if self.fallback_config.enable_cache_fallback:
            key = self._cache_key(prompt)
            if key in self.cache:
                logger.info("Using cached response as final fallback")
                return ResilienceResult(success=True, data=self.cache[key], model_used="cache", fallback_used=True)

        return ResilienceResult(
            success=False,
            error=f"All models ({', '.join(chain)}) failed",
            fallback_used=True,
        )

    def set_cache(self, prompt: str, response: str):
        self.cache[self._cache_key(prompt)] = response

    def call_text_sync(self, prompt: str, system_prompt: str = None, model: str = None) -> ResilienceResult:
        """同步版本（简单重试，无降级链）"""
        model = model or self.fallback_config.text_model_chain[0]
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        for attempt in range(self.retry_config.max_retries + 1):
            try:
                response = self.client.chat.completions.create(
                    model=model, messages=messages, temperature=0.3, max_tokens=800,
                    timeout=30.0,
                )
                return ResilienceResult(
                    success=True,
                    data=response.choices[0].message.content,
                    retry_count=attempt,
                    model_used=model,
                )
            except Exception as e:
                if attempt < self.retry_config.max_retries:
                    delay = min(
                        self.retry_config.base_delay * (self.retry_config.backoff_factor ** attempt),
                        self.retry_config.max_delay,
                    )
                    logger.warning(f"Retry {attempt + 1} in {delay:.1f}s: {str(e)[:100]}")
                    time.sleep(delay)
                else:
                    key = self._cache_key(prompt)
                    if key in self.cache:
                        return ResilienceResult(success=True, data=self.cache[key], model_used="cache", fallback_used=True)
                    return ResilienceResult(success=False, error=str(e), retry_count=attempt)

        return ResilienceResult(success=False, error="Max retries exhausted")


class ParsingErrorHandler:
    """解析错误处理器"""

    @staticmethod
    def handle_parse_failure(file_path: str, error: str, output_dir: str = "./output") -> Dict[str, Any]:
        import os
        from pathlib import Path

        error_report = {
            "file": file_path,
            "error": str(error),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "fallback_strategy": "manual_review",
        }

        os.makedirs(output_dir, exist_ok=True)
        error_log = os.path.join(output_dir, "parse_errors.jsonl")
        try:
            with open(error_log, "a", encoding="utf-8") as f:
                f.write(json.dumps(error_report, ensure_ascii=False) + "\n")
        except Exception:
            pass

        return {
            "type": "text",
            "text": f"[解析失败] {Path(file_path).name}: {str(error)[:200]}",
            "page_idx": 0,
            "_error": error_report,
        }
