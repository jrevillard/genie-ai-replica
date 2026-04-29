from typing import List, Dict, Any
from haystack import component, Document
from src.utils.arcade_client import command_sql
import hashlib

@component
class ArcadeDBChunkWriter:
    """
    A custom Haystack component that takes processed documents 
    and writes them to ArcadeDB using the custom SQL client.
    """
    
    def __init__(self, collection_name: str = "chunks"):
        self.collection_name = collection_name
    
    
    @component.output_types(documents_written=int)
    def run(self, documents: List[Document]):
        if not documents:
            return {"documents_written": 0}
            
        written_count = 0
        
        for doc in documents:
            # Extract the data Haystack created
            chunk_id = doc.id
            source_path = doc.meta.get("file_path", "unknown_source")
            title = doc.meta.get("title", source_path)
            doc_id = hashlib.md5(source_path.encode('utf-8')).hexdigest() 
            category_labels = doc.meta.get("category_labels", ["general_ncd"])
            text = doc.content
            embedding = doc.embedding

            # ==========================================
            # TIER 1: The Parent Document Node
            # ==========================================
            # Upsert the main PDF file node
            doc_sql = """
                UPDATE documents SET doc_id = :doc_id, title = :title UPSERT WHERE doc_id = :doc_id
            """
            try:
                command_sql(sql=doc_sql, params={"doc_id": doc_id, "title": title})
            except Exception as e:
                print(f"⚠️ Failed to insert parent Document: {e}")
                continue
            
            # ==========================================
            # TIER 2: The Chunks Node
            # ==========================================
                
            chunk_sql = f"""
                UPDATE {self.collection_name} 
                SET chunk_id = :chunk_id, text = :text, embedding = :embedding, source = :source, title = :title, category_labels = :category_labels, graph_enriched = false 
                UPSERT WHERE chunk_id = :chunk_id
            """
            
            params_chunk = {
                "chunk_id": chunk_id,
                "text": text,
                "embedding": embedding,
                "source": source_path,
                "title": title,
                "category_labels": category_labels
            }

            try:
                command_sql(sql=chunk_sql, params=params_chunk)
            except Exception as e:
                print(f"Failed to insert document chunk: {e}")
                continue
                
            # ==========================================
            # TIER 3: The Document and Chunks Relationship
            # ==========================================
            
            doc_to_chunk_sql = f"""
                CREATE EDGE document_chunks 
                FROM (SELECT FROM documents WHERE doc_id = :doc_id) 
                TO (SELECT FROM {self.collection_name} WHERE chunk_id = :chunk_id)
            """
            
            params_doc = {
                "chunk_id": chunk_id,
                "doc_id": doc_id
            }
            
            try:
                command_sql(sql=doc_to_chunk_sql, params=params_doc)
                written_count += 1
            except Exception as e:
                print(f"Failed to link document chunk: {e}")
                
        return {"documents_written": written_count}
    
    
@component
class ArcadeDBGraphWriter:
    """
    Takes chunks processed by the LLM, writes the graph entities/relationships,
    and updates the chunk's status to graph_enriched = true.
    """
    
    def __init__(self, collection_name: str = "chunks"):
        self.collection_name = collection_name
    
    
    
    @component.output_types(documents_written=int)
    def run(self, documents: List[Document]):
        if not documents:
            return {"documents_written": 0}
            
        written_count = 0
        
        for doc in documents:
            
            chunk_id = doc.id
            graph_data = doc.meta.get("graph_data", {"entities": [], "relationships": []})
            
            # ---------------------------------------------------------
            # Write Entities and Connect to Chunk
            # ---------------------------------------------------------  
            for entity in graph_data.get("entities", []):
                entity_name = entity.get("name")
                entity_type = entity.get("type", "Unknown")
                
                if not entity_name:
                    continue
                
                  
                # Upsert the Entity (creates it if it doesn't exist, updates if it does)
                entity_sql = """
                    UPDATE entities SET name = :name, type = :type UPSERT WHERE name = :name
                """
                
                # Draw the line back to the chunk (Citation tracking)
                has_source_sql = f"""
                    CREATE EDGE chunk_entities 
                    FROM (SELECT FROM entities WHERE name = :name) 
                    TO (SELECT FROM {self.collection_name} WHERE chunk_id = :chunk_id)
                """
                
                try:
                    command_sql(sql=entity_sql, params={"name": entity_name, "type": entity_type})
                    command_sql(sql=has_source_sql, params={"name": entity_name, "chunk_id": chunk_id})
                except Exception as e:
                    print(f"⚠️ Failed to insert entity '{entity_name}': {e}")
                    continue
                
            # ---------------------------------------------------------
            # WRITE THE RELATIONSHIPS (The Edges connecting entities)
            # ---------------------------------------------------------
            for rel in graph_data.get("relationships", []):
                source_name = rel.get("source")
                target_name = rel.get("target")
                rel_type = rel.get("type", "RELATED_TO")
                
                if not source_name or not target_name:
                    continue
                
                ensure_node_sql = "UPDATE entities SET name = :name UPSERT WHERE name = :name"
                try:
                    command_sql(sql=ensure_node_sql, params={"name": source_name})
                    command_sql(sql=ensure_node_sql, params={"name": target_name})
                except Exception:
                    continue
                
                # Connect the two entities
                relationships_sql = """
                    CREATE EDGE relationships 
                    FROM (SELECT FROM entities WHERE name = :source_name) 
                    TO (SELECT FROM entities WHERE name = :target_name) 
                    SET type = :rel_type
                """
                try:
                    command_sql(sql=relationships_sql, params={
                        "source_name": source_name, 
                        "target_name": target_name, 
                        "rel_type": rel_type
                    })
                except Exception as e:
                    print(f"⚠️ Failed to create relationship: {e}")
            
            # ---------------------------------------------------------
            # WRITE THE RELATIONSHIPS (The Edges connecting entities)
            # ---------------------------------------------------------
            
            update_chunk_sql = f"UPDATE {self.collection_name} SET graph_enriched = true WHERE chunk_id = :chunk_id"
            try:
                command_sql(sql=update_chunk_sql, params={"chunk_id": chunk_id})
                written_count += 1
            except Exception as e:
                print(f"⚠️ Failed to update graph_enriched status: {e}")

        return {"documents_written": written_count}