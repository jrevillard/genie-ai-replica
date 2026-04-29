import os
from pathlib import Path

from haystack import Pipeline
from haystack.components.routers import FileTypeRouter
from haystack.components.converters import TextFileToDocument, PyPDFToDocument
from haystack.components.joiners import DocumentJoiner
from haystack.components.preprocessors import DocumentSplitter, DocumentCleaner
from haystack.components.embedders import SentenceTransformersDocumentEmbedder
from haystack.utils import ComponentDevice
from src.components.arcadedb_writer import ArcadeDBChunkWriter
from src.ingestion.chunk_labeler_BM25 import BM25ChunkLabeler

#from haystack.components.writers import DocumentWriter


def build_ingestion_pipeline():
    '''Constructs the Haystack preprocessing pipeline.'''
    
    
    file_type_router = FileTypeRouter(mime_types=["text/plain", "application/pdf"])

    text_converter = TextFileToDocument()
    pdf_converter = PyPDFToDocument()
    
    # Merges the output of both converters back into a single stream
    document_joiner = DocumentJoiner()
    document_cleaner = DocumentCleaner(
        remove_empty_lines=True, 
        remove_extra_whitespaces=True,
        remove_repeated_substrings=True
    )
    
    # Chunks the documents.
    document_splitter = DocumentSplitter(split_by="word", split_length=150, split_overlap=20,respect_sentence_boundary=True)
    
    chunk_labeler = BM25ChunkLabeler()

    document_embedder = SentenceTransformersDocumentEmbedder(
            model="sentence-transformers/all-MiniLM-L6-v2",
            device=ComponentDevice.from_str("cpu")
            #device="cuda" 
        )

    # The Writer that pushes to DB
    #document_writer = DocumentWriter(document_store=document_store)
    document_writer = ArcadeDBChunkWriter(collection_name="chunks")
    
    
    '''Pipeline Components Addition'''
    preprocessing_pipeline = Pipeline()
    preprocessing_pipeline.add_component(instance=file_type_router, name="file_type_router")
    preprocessing_pipeline.add_component(instance=text_converter, name="text_converter")
    preprocessing_pipeline.add_component(instance=pdf_converter, name="pdf_converter")
    preprocessing_pipeline.add_component(instance=document_joiner, name="document_joiner")
    preprocessing_pipeline.add_component(instance=document_cleaner, name="document_cleaner")
    preprocessing_pipeline.add_component(instance=document_splitter, name="document_splitter")
    preprocessing_pipeline.add_component(instance=chunk_labeler, name="chunk_labeler")
    preprocessing_pipeline.add_component(instance=document_embedder, name="document_embedder")
    preprocessing_pipeline.add_component(instance=document_writer, name="document_writer")
    
    '''Component Connections'''
    # Routing files to their specific converters
    preprocessing_pipeline.connect("file_type_router.text/plain", "text_converter.sources")
    preprocessing_pipeline.connect("file_type_router.application/pdf", "pdf_converter.sources")
    
    # Joining them together
    preprocessing_pipeline.connect("text_converter", "document_joiner")
    preprocessing_pipeline.connect("pdf_converter", "document_joiner")
    
    # Passing through the rest of the pipeline
    preprocessing_pipeline.connect("document_joiner", "document_cleaner")
    preprocessing_pipeline.connect("document_cleaner", "document_splitter")
    
    preprocessing_pipeline.connect("document_splitter", "chunk_labeler")
    preprocessing_pipeline.connect("chunk_labeler", "document_embedder")
    #preprocessing_pipeline.connect("document_splitter", "document_embedder")
    
    preprocessing_pipeline.connect("document_embedder", "document_writer")
    
    return preprocessing_pipeline

def run_ingestion_pipeline():
    
    # Builds the pipeline
    preprocessing_pipeline = build_ingestion_pipeline()   
    
    # Get all files from data folder
    data_dir = Path("./data/docs")
    print(os.getcwd())
    file_paths = [str(path) for path in data_dir.glob("**/*") if path.is_file()]
    
    if not file_paths:
        print("No files found in the /data/docs directory.")
        return {"status": "skipped", "message": "No files found."}
    
    # 4. Run the pipeline!
    print(f"Starting ingestion for {len(file_paths)} files...")    
    preprocessing_pipeline.run({"file_type_router": {"sources": file_paths}})
    print("Ingestion complete! Documents and vectors are now in ArcadeDB.")
    
    return {"status": "success", "files_processed": len(file_paths)}

if __name__=='__main__':
    run_ingestion_pipeline()