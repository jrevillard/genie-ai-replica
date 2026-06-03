# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0


import asyncio
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import cv2
import easyocr
import numpy as np
import pymupdf
from comps import CustomLogger

# Might need to check the path
from comps.dataprep.src.utils import document_loader as origin_document_loader
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import (
    AcceleratorDevice,
    AcceleratorOptions,
    EasyOcrOptions,
    PdfPipelineOptions,
)
from docling.document_converter import (
    DocumentConverter,
    PdfFormatOption,
)

logger = CustomLogger("genie-ai_prepare_doc_util")
logflag = os.getenv("LOGFLAG", False)

# Remote docling-serve endpoint (when set, document processing is delegated to remote GPU node)
DOCLING_ENDPOINT = os.getenv("DOCLING_ENDPOINT", "")
DOCLING_ENDPOINT_TIMEOUT = int(os.getenv("DOCLING_ENDPOINT_TIMEOUT", 120))

reader = easyocr.Reader(["en"])  # Can add more languages later

try:
    # configuring Docling to use easyocr (more lightweight than OPEA default library)
    ocr_options = EasyOcrOptions(lang=["en"])

    # FIX: Configurable Accelerator Device (Default: CUDA)
    # Reads 'DOCLING_DEVICE' env var: 'cpu' forces CPU, otherwise defaults to CUDA
    env_device = os.getenv("DOCLING_DEVICE", "cuda").lower()

    if env_device == "cpu":
        logger.info("Docling configured to use CPU.")
        device_selection = AcceleratorDevice.CPU
    else:
        logger.info("Docling configured to use CUDA (GPU).")
        device_selection = AcceleratorDevice.CUDA

    accelerator_options = AcceleratorOptions(num_threads=4, device=device_selection)

    # Pipeline for PDFs and Images (for layout analysis and OCR)
    pdf_and_image_pipeline_config = PdfPipelineOptions(
        do_ocr=True, ocr_options=ocr_options, accelerator_options=accelerator_options
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


async def _load_with_docling_remote(doc_path: str) -> str:
    """
    Asynchronously sends a document to a remote docling-serve endpoint
    and returns the extracted Markdown content.

    Requires DOCLING_ENDPOINT env var to be set (e.g. https://gpu-host/docling).
    Uses the docling-serve v1alpha API: POST /v1alpha/convert/file.
    """
    import aiohttp

    logger.info(f"Processing document via remote docling-serve: {doc_path}")

    # Read file bytes before entering async context to avoid handle leak
    with open(doc_path, "rb") as f:
        file_bytes = f.read()

    _skip_ssl = os.getenv("OPEA_SSL_SKIP_VERIFY", "") == "1"
    connector = aiohttp.TCPConnector(ssl=not _skip_ssl)
    timeout = aiohttp.ClientTimeout(total=DOCLING_ENDPOINT_TIMEOUT)
    headers = {}
    api_key = os.getenv("OPEA_API_KEY", "")
    if api_key:
        headers["X-API-Key"] = api_key
    async with aiohttp.ClientSession(timeout=timeout, connector=connector, headers=headers) as session:
        data = aiohttp.FormData()
        data.add_field("files", file_bytes, filename=Path(doc_path).name)

        async with session.post(
            f"{DOCLING_ENDPOINT}/v1alpha/convert/file",
            data=data,
        ) as resp:
            resp.raise_for_status()
            result = await resp.text()
            return result


async def load_with_docling(doc_path: str) -> str:
    """
    Asynchronously processes any Docling-supported file (PDF, DOCX, PPTX,
    HTML, images, etc.) and returns its content as RAG-ready Markdown.

    When DOCLING_ENDPOINT is set, delegates to a remote docling-serve instance.
    Otherwise, uses the in-process converter.
    """
    if DOCLING_ENDPOINT:
        return await _load_with_docling_remote(doc_path)

    def process_doc():
        # .convert() handles parsing, layout analysis, table extraction, and OCR
        result = docling_converter.convert(doc_path)
        # Exporting to Markdown for enhanced readability.
        return result.document.export_to_markdown()

    loop = asyncio.get_running_loop()
    content = await loop.run_in_executor(None, process_doc)
    return content


async def docling_document_loader(doc_path):
    # Support for PDF, DOCX, PPTX, XLSX, HTML, Markdown, and Text
    supported_extensions = (".pdf", ".docx", ".pptx", ".xlsx", ".html", ".txt", ".md", ".asciidoc")

    if doc_path.endswith(supported_extensions):
        return await load_with_docling(doc_path)
    else:
        print(f"File type {doc_path} not supported by Docling")


def genieai_process_page(doc, idx):
    page = doc.load_page(idx)
    pagetext = page.get_text().strip()
    result = pagetext if pagetext.endswith(("!", "?", ".")) else pagetext + "."

    page_images = doc.get_page_images(idx)
    if page_images:
        for _img_index, img in enumerate(page_images):
            xref = img[0]
            img_data = doc.extract_image(xref)
            img_bytes = img_data["image"]

            # process images
            img_array = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)
            # img_result = pytesseract.image_to_string(img_array, lang="eng", config="--psm 6")
            img_result = "".join(reader.readtext(img_array, detail=0))

            # add results
            pageimg = img_result.strip()
            pageimg += "" if pageimg.endswith(("!", "?", ".")) else "."
            result += pageimg

    return result


def genieai_load_pdf(pdf_path):
    # doc = fitz.open(pdf_path)
    doc = pymupdf.open(pdf_path)
    results = {}

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(genieai_process_page, doc, i): i for i in range(doc.page_count)}
        for future in as_completed(futures):
            page_idx = futures[future]
            results[page_idx] = future.result()

    combined_result = "".join(results[i] for i in sorted(results))
    return combined_result


async def document_loader(doc_path):
    if doc_path.endswith(".pdf"):
        # return await load_pdf_async(doc_path) # to be tested later
        return genieai_load_pdf(doc_path)
    else:
        return await origin_document_loader(doc_path)


def is_valid_content(chunk):
    """Check if chunk content is suitable for LLM, rather than web archive content or base64 encoded content."""
    if not chunk:
        return False

    # Check if content is predominantly base64/web archive
    lines = chunk.split("\n")

    # Count problematic lines
    problematic_lines = 0
    for line in lines:
        line = line.strip()
        if (
            line.startswith("//")
            or "base64" in line.lower()
            or "MIME-Version" in line
            or "Content-Type:" in line
            or "Content-Transfer-Encoding" in line
            or line.startswith("------=_NextPart_")
            or
            # Base64 pattern: long strings of alphanumeric chars with + and /
            (len(line) > 50 and line.replace("+", "").replace("/", "").replace("=", "").isalnum())
        ):
            problematic_lines += 1

    # If more than 50% of lines are problematic, consider it invalid
    if len(lines) > 0 and problematic_lines / len(lines) > 0.5:
        return False

    # Also check for readable text content
    readable_chars = sum(1 for char in chunk if char.isalnum() or char.isspace())
    return not (len(chunk) > 0 and readable_chars / len(chunk) < 0.7)
