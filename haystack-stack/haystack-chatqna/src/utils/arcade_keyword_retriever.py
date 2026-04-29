import requests
from typing import List, Optional
from haystack import component, Document
from src.utils.arcade_client import command_sql, extract_rows

@component
class ArcadeDBKeywordRetriever:
    """
    Haystack Component to retrieve documents using Sparse Keyword Search (Lucene).
    """
    def __init__(self, top_k: int = 3):
        self.top_k = top_k

    @component.output_types(documents=List[Document])
    def run(self, query: str, extracted_labels: Optional[List[str]] = None, top_k: Optional[int] = None):
        k = top_k or self.top_k
        
        params = {}
        
        # Use ArcadeDB's LUCENE keyword search
        sql_query = (
            f"SELECT chunk_id, title, source, text, category_labels "
            f"FROM chunks "
            f"WHERE text CONTAINSTEXT :query "
            #f"LIMIT {k}"
        )
        
        # NEW: Inject the labels filter using AND
        if extracted_labels:
            sql_query += " AND category_labels CONTAINSANY :labels"
            params["labels"] = extracted_labels
            
        sql_query += f" LIMIT {k}"
        
        try:
            print(f"Keyword Search with labels: {extracted_labels}...")
            params = {"query": query}
            response = command_sql(sql=sql_query, params=params)
            rows = extract_rows(response)
            
            documents = []
            for hit in rows:
                content = hit.get("text") or hit.get("chunks.text") or ""
                meta = {
                    "title": hit.get("title") or hit.get("chunks.title"),
                    "source": hit.get("source") or hit.get("chunks.source") or "",
                    "category_labels": hit.get("category_labels") or hit.get("chunks.category_labels") or [],
                }
                
                if content:
                    db_chunk_id = hit.get("chunk_id") or hit.get("chunks.chunk_id")
                    documents.append(Document(id=db_chunk_id, content=content, meta=meta))
                    #documents.append(Document(content=content, meta=meta))
                    
            print(f"Keyword Retriever found {len(documents)} documents.")   
            return {"documents": documents}
            
        except Exception as e:
            error_msg = f"CRITICAL KEYWORD ERROR: {str(e)}"
            print(f" {error_msg}")
            return {"documents": []}