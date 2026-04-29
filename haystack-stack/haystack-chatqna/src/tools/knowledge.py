from typing import Dict, Any
from src.tools.base import BaseTool
import logging

logger = logging.getLogger(__name__)


class KnowledgeTool(BaseTool):
    """Fast document retrieval from the knowledge base.

    Returns only retrieved/ranked documents — no LLM call here.
    The agent's main OpenAI call will synthesize these into the reply,
    so running a second LLM inside this tool is redundant and slow.
    """

    name = "search_knowledge"
    description = "Search NCD health guidelines, treatment information, and medical advice from the knowledge base"
    parameters = ["query"]

    def __init__(self):
        self._retriever = None
        self._keyword_retriever = None
        self._ranker = None
        self._embedder = None

    def _lazy_init(self):
        if self._retriever is not None:
            return
        from src.utils.arcade_vector_retriever import ArcadeDBVectorRetriever
        from src.utils.arcade_keyword_retriever import ArcadeDBKeywordRetriever
        from haystack.components.embedders import SentenceTransformersTextEmbedder
        from haystack.components.rankers import SentenceTransformersSimilarityRanker
        from haystack.utils import ComponentDevice

        self._embedder = SentenceTransformersTextEmbedder(
            model="sentence-transformers/all-MiniLM-L6-v2",
            device=ComponentDevice.from_str("cpu"),
        )
        self._embedder.warm_up()
        self._retriever = ArcadeDBVectorRetriever(top_k=5)
        self._keyword_retriever = ArcadeDBKeywordRetriever(top_k=5)
        self._ranker = SentenceTransformersSimilarityRanker(
            model="cross-encoder/ms-marco-MiniLM-L-6-v2",
            top_k=3,
            device=ComponentDevice.from_str("cpu"),
        )
        self._ranker.warm_up()

    async def execute(self, query: str, **kwargs) -> Dict[str, Any]:
        try:
            self._lazy_init()

            # Embed, retrieve, rank — no LLM call
            emb = self._embedder.run(text=query)
            vec_docs = self._retriever.run(
                query_embedding=emb["embedding"], top_k=5,
            ).get("documents", [])
            kw_docs = self._keyword_retriever.run(query=query, top_k=5).get("documents", [])

            # Combine + dedupe by content
            seen = set()
            combined = []
            for d in vec_docs + kw_docs:
                key = (d.content or "")[:100]
                if key not in seen:
                    seen.add(key)
                    combined.append(d)

            # Rank and take top 3
            if combined:
                ranked = self._ranker.run(query=query, documents=combined).get("documents", [])[:3]
            else:
                ranked = []

            sources = []
            for d in ranked:
                source_entry = {
                    "content": (d.content or "")[:400],
                    "score": getattr(d, "score", None),
                }
                # Include source document metadata when available
                meta = getattr(d, "meta", {}) or {}
                if meta.get("source"):
                    source_entry["document"] = meta["source"]
                if meta.get("category_labels"):
                    source_entry["labels"] = meta["category_labels"]
                sources.append(source_entry)
            return {
                "query": query,
                "sources": sources,
                "snippets": [s["content"] for s in sources],
            }
        except Exception as e:
            logger.error(f"Knowledge search failed: {e}")
            return {
                "query": query,
                "sources": [],
                "snippets": [],
                "error": str(e),
            }
