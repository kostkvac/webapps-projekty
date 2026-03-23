from pydantic_settings import BaseSettings
from pydantic import Field
import os


class Settings(BaseSettings):
    DB_HOST: str = "dsm.local"
    DB_PORT: int = 3306
    DB_USER: str = "admin"
    DB_PASSWORD: str = Field(..., env="DB_PASSWORD")
    DB_NAME: str = "projekty"

    CURRENT_USER: str = "me"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    LOG_LEVEL: str = "INFO"

    LOGS_DIR: str = "/opt/webapps/projekty/data/logs"

    model_config = {
        "env_file": "/opt/webapps/projekty/.env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


settings = Settings()
