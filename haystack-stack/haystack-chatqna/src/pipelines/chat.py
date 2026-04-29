from haystack import Pipeline
from haystack.components.routers import ConditionalRouter
from haystack.components.builders import ChatPromptBuilder
# ── OLD: Gemini LLM (commented out) ──
#from haystack_integrations.components.generators.google_genai import GoogleGenAIChatGenerator
# ── NEW: OpenAI LLM (voice-gateway logic) ──
from haystack.components.generators.chat import OpenAIChatGenerator
#from haystack.components.retrievers import InMemoryBM25Retriever # Simple start
from haystack.components.embedders import SentenceTransformersTextEmbedder
from haystack.components.rankers import SentenceTransformersSimilarityRanker
from haystack.dataclasses import ChatMessage
from haystack.utils import ComponentDevice

from haystack.components.converters import OutputAdapter
from haystack.components.joiners import DocumentJoiner

# Prompt Factory
from src.utils.intent_classifier import IntentClassifier
from src.prompts.prompt_builders import PROMPT_BUILDERS

#from src.utils.vector_store import get_document_store
from src.utils.arcade_vector_retriever import ArcadeDBVectorRetriever
from src.utils.arcade_keyword_retriever import ArcadeDBKeywordRetriever

from src.components.spacy_extractor import SpacySlotExtractor
from src.utils.arcade_graph_enricher import ArcadeDBGraphEnricher

from src.config import settings
import os


def create_chat_pipeline():
    #document_store = get_document_store()
    classifier = IntentClassifier()
    
    text_embedder = SentenceTransformersTextEmbedder(
        model="sentence-transformers/all-MiniLM-L6-v2",
        device=ComponentDevice.from_str("cpu")
    )
    
    slot_extractor = SpacySlotExtractor()
    
    vector_retriever = ArcadeDBVectorRetriever(top_k=10)
    keyword_retriever = ArcadeDBKeywordRetriever(top_k=10)
    graph_enricher = ArcadeDBGraphEnricher()
    document_joiner = DocumentJoiner()
    
    ranker = SentenceTransformersSimilarityRanker(
        model='cross-encoder/ms-marco-MiniLM-L-6-v2',
        top_k=3,
        device=ComponentDevice.from_str("cpu")
    )
    
    # TWO ROUTERS INITIALIZATION
    # Router 1: Decides if we skip the database
    bypass_routes = [
        {"condition": "{{ intent == 'smalltalk' }}", "output": "{{ query }}", "output_name": "go_to_smalltalk", "output_type": str},
        {"condition": "{{ intent != 'smalltalk' }}", "output": "{{ query }}", "output_name": "go_to_rag", "output_type": str}
    ]
    bypass_router = ConditionalRouter(bypass_routes)
    
    # Router 2: Decides which RAG template to use
    template_routes = [
        {"condition": "{{ intent == 'triage' }}", "output": "{{ query }}", "output_name": "go_to_triage", "output_type": str},
        {"condition": "{{ intent == 'assistant' }}", "output": "{{ query }}", "output_name": "go_to_assistant", "output_type": str}
    ]
    template_router = ConditionalRouter(template_routes)

    """
    Builds the RAG pipeline.
    """    
    # OLD: Gemini LLM connection (commented out)
    #os.environ["GOOGLE_API_KEY"] = settings.GOOGLE_API_KEY
    #llm = GoogleGenAIChatGenerator(model=settings.LLM_MODEL_NAME)

    # NEW: OpenAI LLM connection (same model as voice-gateway: GPT-4o-mini)
    # ── NEW: OpenAI LLM connection (same model as voice-gateway: GPT-4o-mini) ──
    os.environ["OPENAI_API_KEY"] = settings.OPENAI_API_KEY
    llm = OpenAIChatGenerator(
        model=settings.OPENAI_MODEL,
        generation_kwargs={"temperature": 0.3},
    )
    
    # Build Pipeline
    pipeline = Pipeline()
    pipeline.add_component("classifier", classifier)
    pipeline.add_component("bypass_router", bypass_router)
    pipeline.add_component("template_router", template_router)
    pipeline.add_component("text_embedder", text_embedder)
    pipeline.add_component("slot_extractor", slot_extractor)
    pipeline.add_component("vector_retriever", vector_retriever)
    pipeline.add_component("keyword_retriever", keyword_retriever)
    pipeline.add_component("graph_enricher", graph_enricher)
    pipeline.add_component("joiner", document_joiner)
    pipeline.add_component("ranker",ranker)
    
    # Pre-build prompt builder component
    pipeline.add_component("prompt_builder_assistant", PROMPT_BUILDERS["builder_assistant"])
    pipeline.add_component("prompt_builder_triage", PROMPT_BUILDERS["builder_triage"])
    pipeline.add_component("prompt_builder_smalltalk", PROMPT_BUILDERS["builder_smalltalk"])
    
    pipeline.add_component("llm", llm)
    

    # Connections (Embedder -> Retriever -> Ranker -> Prompt)
    pipeline.connect("classifier.intent", "bypass_router.intent")
    pipeline.connect("classifier.intent", "template_router.intent")
    
    # -- TRACK A - SMALL TALK PATH --
    pipeline.connect("bypass_router.go_to_smalltalk","prompt_builder_smalltalk.query")
    
    # -- TRACK B - RAG PATH --
    pipeline.connect("bypass_router.go_to_rag", "slot_extractor.query")
    #pipeline.connect("bypass_router.go_to_rag", "text_embedder.text")
    #pipeline.connect("bypass_router.go_to_rag", "keyword_retriever.query")
    pipeline.connect("bypass_router.go_to_rag", "ranker.query")
    pipeline.connect("bypass_router.go_to_rag", "template_router.query")
    
    pipeline.connect("slot_extractor.query", "text_embedder.text")
    pipeline.connect("text_embedder.embedding", "vector_retriever.query_embedding")
    pipeline.connect("slot_extractor.extracted_labels", "vector_retriever.extracted_labels")
    #pipeline.connect("vector_retriever.documents", "joiner.documents")
    pipeline.connect("vector_retriever.documents", "graph_enricher.documents")
    pipeline.connect("graph_enricher.documents", "joiner.documents")
    
    pipeline.connect("slot_extractor.query", "keyword_retriever.query")
    pipeline.connect("slot_extractor.extracted_labels", "keyword_retriever.extracted_labels")
    pipeline.connect("keyword_retriever.documents", "joiner.documents")
    
    pipeline.connect("joiner.documents", "ranker.documents")
    
    # Router feeds original text to the correct prompt builder
    pipeline.connect("template_router.go_to_assistant", "prompt_builder_assistant.query")
    pipeline.connect("template_router.go_to_triage", "prompt_builder_triage.query")
    
    # Ranker feeds documents to BOTH builders
    #pipeline.connect("ranker.documents", "prompt_builder.documents")
    pipeline.connect("ranker.documents", "prompt_builder_assistant.documents")
    pipeline.connect("ranker.documents", "prompt_builder_triage.documents")
    
    #pipeline.connect("prompt_builder.prompt", "llm.messages")
    pipeline.connect("prompt_builder_assistant.prompt", "llm.messages")
    pipeline.connect("prompt_builder_triage.prompt", "llm.messages")
    pipeline.connect("prompt_builder_smalltalk.prompt", "llm.messages")
    
    return pipeline

# Create the instance to be imported
chat_pipeline = create_chat_pipeline()