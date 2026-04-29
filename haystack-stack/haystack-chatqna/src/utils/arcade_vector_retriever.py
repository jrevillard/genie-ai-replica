import requests
from typing import List, Optional
from haystack import component, Document
from src.utils.arcade_client import command_sql, extract_rows

@component
class ArcadeDBVectorRetriever:
    """
    Haystack Component to retrieve documents using Vector Search.
    Delegates the hard work to arcadedb_client.
    """
    def __init__(self, top_k: int = 3):
        self.top_k = top_k

    @component.output_types(documents=List[Document])
    def run(self, query_embedding: List[float], extracted_labels: Optional[List[str]] = None, top_k: Optional[int] = None):
        """
        Input: Vector (from Haystack Embedder)
        Output: Documents (for Haystack Prompt)
        """
        k = top_k or self.top_k
        #vector_str = str(query_embedding)
        
        # 1. Build the SQL
        sql_query = (
            f"SELECT chunk_id, title, source, text, category_labels, "
            f"vectorCosineSimilarity(embedding, :query_vector) as score "
            f"FROM chunks "
            #f"ORDER BY score DESC "
            #f"LIMIT {k}"
        )
        
        params = {}
        
        # Injects Label-based filtering
        if extracted_labels:
            sql_query += " WHERE category_labels CONTAINSANY :labels "
            params["labels"] = extracted_labels
        
        sql_query += f" ORDER BY score DESC LIMIT {k}"
        
        # 2. Execute via Client (Pass vector as param!)
        try:
            #response = command_sql(sql_query, params=[query_embedding, k])
            #response = command_sql(sql_query, params=[])
            print(f"🔎 Searching ArcadeDB Vectors with labels: {extracted_labels}...")
            #params = {"query_vector": query_embedding}
            params["query_vector"] = query_embedding
            response = command_sql(sql=sql_query, params=params)
            rows = extract_rows(response)
            
            # 3. Convert to Haystack Documents
            documents = []
            for hit in rows:
                
                content = hit.get("text") or hit.get("chunks.text") or ""
                meta = {
                    "title": hit.get("title") or hit.get("chunks.title"),
                    "source": hit.get("source") or hit.get("chunks.source") or "",
                    "category_labels": hit.get("category_labels") or hit.get("chunks.category_labels") or [],
                    "score": hit.get("score")
                }
                
                # Only add if we actually found text
                if content:
                    db_chunk_id = hit.get("chunk_id") or hit.get("chunks.chunk_id")
                    documents.append(Document(id=db_chunk_id,content=content, meta=meta))
                    #documents.append(Document(content=content, meta=meta))
                    
            print(f"Vector Retriever found {len(documents)} highly relevant chunks.")   
            return {"documents": documents}
            
        except Exception as e:
            # Return empty list so pipeline doesn't crash on DB error
            error_msg = f"CRITICAL RETRIEVER ERROR: {str(e)}"
            print(f" {error_msg}")
            
            # This forces the error to appear in your Chat Output
            return {"documents": [Document(content=error_msg, meta={"title": "Error Log"})]}