
# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0


import easyocr 
import os

from docling.document_converter import (
    DocumentConverter,
    PdfFormatOption,
    WordFormatOption,
    )
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import (
    PdfPipelineOptions, 
    EasyOcrOptions, 
    )

from comps import CustomLogger

logger = CustomLogger("genie-ai_prepare_doc_util")
logflag = os.getenv("LOGFLAG", False)

try:
    # configuring Docling to use easyocr (more lightweight than OPEA default library)
    ocr_options = EasyOcrOptions(lang=['en']) 
    
    # Pipeline for PDFs and Images (for layout analysis and OCR)
    pdf_and_image_pipeline_config = PdfPipelineOptions(
        do_ocr=True,  
        ocr_options=ocr_options
    )

    # Map PDF file type to relevant pipeline
    format_options = {
        InputFormat.PDF: PdfFormatOption(pipeline_options=pdf_and_image_pipeline_config),
        # Later can add pipelines for other file formats
        }

    # 5. Initialize the converter once, passing the format_options dict
    docling_converter = DocumentConverter(format_options=format_options)

except ImportError:
    print("Please install docling and its dependencies: pip install docling easyocr")
    raise
    

### Docling document loader ############################################################
# Serves as a more heavy and robust tool for extracting content from more complex PDF files
async def load_with_docling(doc_path: str) -> str:
    """
    Asynchronously processes any Docling-supported file (PDF, DOCX, PPTX,
    HTML, images, etc.) and returns its content as RAG-ready Markdown.
    """
    def process_doc():
        # .convert() handles parsing, layout analysis, table extraction, and OCR
        result = docling_converter.convert(doc_path)
        # Exporting to Markdown for enhanced readability.
        return result.document.export_to_markdown()

    loop = asyncio.get_running_loop()
    content = await loop.run_in_executor(None, process_doc)
    return content

async def docling_document_loader(doc_path):
    # other file formats to be added later (docx, csv, html, ...)
    if (
        doc_path.endswith(".pdf")
        or doc_path.endswith(".xlsx") # Docling handles XLSX
        ):

        return await load_with_docling(doc_path)

    else:
        print(f'File type {doc_path} not supported by Docling')
