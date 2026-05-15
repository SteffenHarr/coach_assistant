"""Typed application settings, loaded from environment variables."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # API
    api_env: str = Field(default="development")
    api_secret_key: SecretStr = Field(...)
    api_jwt_access_ttl_seconds: int = 900
    api_jwt_refresh_ttl_seconds: int = 60 * 60 * 24 * 14
    api_cors_origins: str = "https://localhost"
    api_rate_limit_per_minute: int = 60

    # DB
    database_url: str = Field(...)

    # Redis
    redis_url: str = "redis://redis:6379/0"

    # LLM
    ollama_base_url: str = "http://ollama:11434"
    ollama_model: str = "llama3.1:8b-instruct-q4_K_M"
    agent_max_tool_calls: int = 10
    agent_require_confirmation: bool = True

    # Solver
    solver_time_limit_seconds: float = 30.0
    solver_num_solutions: int = 3

    @property
    def is_production(self) -> bool:
        return self.api_env.lower() == "production"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.api_cors_origins.split(",") if o.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
