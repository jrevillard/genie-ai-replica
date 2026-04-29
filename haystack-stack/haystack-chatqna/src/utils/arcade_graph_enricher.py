from typing import List
from haystack import component, Document
from src.utils.arcade_client import command_sql, extract_rows

@component
class ArcadeDBGraphEnricher:
    """
    Takes a list of Documents (usually from a Retriever), traverses the 
    Knowledge Graph for each Document's chunk_id, and appends the 
    found medical entities to the Document's content.
    """
    
    @component.output_types(documents=List[Document])
    def run(self, documents: List[Document]):
        if not documents:
            return {"documents": []}
            
        enriched_documents = []
        
        for doc in documents:
            chunk_id = doc.id
            content = doc.content
            meta = doc.meta or {}
            
            direct_entities = []
            related_entities = []
            
            try:
                # Find direct entities connected to this chunk
                sql_entities = f"SELECT expand(in('chunk_entities')) FROM chunks WHERE chunk_id = '{chunk_id}'"
                entities_resp = command_sql(sql=sql_entities)
                entities_rows = extract_rows(entities_resp)
                direct_entities = [e.get("name") for e in entities_rows if e.get("name")]
                
                # Find 2nd degree relationships
                if direct_entities:
                    sql_related = f"SELECT expand(in('chunk_entities').both('relationships')) FROM chunks WHERE chunk_id = '{chunk_id}'"
                    related_resp = command_sql(sql=sql_related)
                    related_rows = extract_rows(related_resp)
                    related_entities = [e.get("name") for e in related_rows if e.get("name")]
            except Exception as e:
                print(f"⚠️ Traversal warning for chunk {chunk_id}: {e}")
            
            # Remove duplicates
            direct_entities = list(set(direct_entities))
            related_entities = list(set(related_entities) - set(direct_entities)) 
            
            if direct_entities or related_entities:
                content += "\n\n------\nRELATED GRAPH INFORMATION:\n------\n"
                if direct_entities:
                    content += f"Entities explicitly mentioned in this text: {', '.join(direct_entities)}\n"
                if related_entities:
                    content += f"Other related medical concepts (Graph): {', '.join(related_entities)}\n"
                    
            meta["graph_entities"] = direct_entities
            
            #print(content)
            
            # Create a new Document object with the enriched content
            enriched_documents.append(Document(
                content=content, 
                meta=meta, 
                id=doc.id, 
                embedding=doc.embedding
            ))
                
        print(f"Graph Enricher processed {len(enriched_documents)} documents.")   
        return {"documents": enriched_documents}