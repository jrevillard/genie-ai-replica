
from typing import List
from haystack import component, Document, Pipeline
from src.components.graph_extractor import GraphExtractor
from src.components.arcadedb_writer import ArcadeDBGraphWriter
from src.components.chunk_reader import UnenrichedChunkReader


def build_graph_enrichment_pipeline(limit: int = 20):
    """Builds and runs the background Graph Enrichment Pipeline"""
    
    # 1. Initialize Components
    chunk_reader = UnenrichedChunkReader(limit=limit)
    graph_extractor = GraphExtractor()
    graph_updater = ArcadeDBGraphWriter(collection_name="chunks")
    
    # 2. Build Pipeline
    graph_pipeline = Pipeline()
    graph_pipeline.add_component(instance=chunk_reader, name="chunk_reader")
    graph_pipeline.add_component(instance=graph_extractor, name="graph_extractor")
    graph_pipeline.add_component(instance=graph_updater, name="graph_updater")
    
    # 3. Connect Components
    graph_pipeline.connect("chunk_reader.documents", "graph_extractor.documents")
    graph_pipeline.connect("graph_extractor.documents", "graph_updater.documents")
    
    return graph_pipeline
    
def run_graph_pipeline(batch_size: int = 20):
    
    # Builds the pipeline
    grap_enrichment_pipeline = build_graph_enrichment_pipeline(limit=batch_size)   
    
    # Run the pipeline!
    print(f"Starting graph enrichment...")    
    grap_enrichment_pipeline.run({})
    print("Graph enrichment! Documents and vectors are now in ArcadeDB.")
    
    return {"status": "success"}

if __name__=='__main__':
    run_graph_pipeline()