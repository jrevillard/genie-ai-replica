
from typing import List
from haystack import component, Document, Pipeline
from src.utils.arcade_client import command_sql

@component
class UnenrichedChunkReader:
    """
    Queries ArcadeDB for chunks that have NOT been processed by the LLM yet.
    Turns them into Haystack Documents to feed into the GraphExtractor.
    """
    def __init__(self, limit: int = 50):
        self.limit = limit
        
    @component.output_types(documents=List[Document])
    def run(self):
        print(f"🔍 Searching ArcadeDB for up to {self.limit} unenriched chunks...")
        
        # Query ArcadeDB for chunks missing the graph extraction
        sql = f"SELECT chunk_id, text, source, title FROM chunks WHERE graph_enriched = false LIMIT {self.limit}"
        
        try:
            results = command_sql(sql=sql)
            # command_sql usually returns a dict with a 'result' key containing the list of records
            records = results.get("result", []) 
        except Exception as e:
            print(f"⚠️ Failed to read from ArcadeDB: {e}")
            return {"documents": []}
            
        if not records:
            print("✅ All chunks are already enriched! Nothing to do.")
            return {"documents": []}
            
        documents = []
        for record in records:
            # Create a Haystack Document for each row
            doc = Document(
                id=record.get("chunk_id"),
                content=record.get("text"),
                meta={
                    "file_path": record.get("source"),
                    "title": record.get("title")
                }
            )
            documents.append(doc)
            
        print(f"📥 Pulled {len(documents)} chunks for graph enrichment.")
        return {"documents": documents}