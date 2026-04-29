# src/config.py
import os
  
class Config:
    # API 
    API_HOST = os.getenv("API_HOST", "0.0.0.0")
    API_PORT = int(os.getenv("API_PORT", 8000))
    
    # OpenAI LLM (primary)
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
    OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    
    # Google Gemini (kept as fallback) LLM 
    GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
    LLM_MODEL_NAME = os.getenv("LLM_MODEL_NAME")
 
    # ArcadeDB 
    ARCADEDB_URL = os.getenv("ARCADEDB_URL", "http://arcadedb:2480")
    ARCADEDB_DB = os.getenv("ARCADEDB_DB", "genie")
    ARCADEDB_USER = os.getenv("ARCADEDB_USER", "root")
    ARCADEDB_PASSWORD = os.getenv("ARCADEDB_PASSWORD", "genieRoot123") 
 
settings = Config()
