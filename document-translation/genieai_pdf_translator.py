# ####################################################################################
# GENIE.AI SOURCE DOC TRANSLATOR SERVICE (PDF)
# ####################################################################################

# ------------------------------------------------------------------------------------
# DEPENDENCIES 
# ------------------------------------------------------------------------------------
import logging
import os
import time
import requests
from pathlib import Path

# import ollama         # use if running on-device
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.pipeline_options import PdfPipelineOptions, EasyOcrOptions
from docling.datamodel.base_models import InputFormat
from docling_core.types.doc.document import ImageRefMode


# ------------------------------------------------------------------------------------
# MACRO_PARAMS 
# ------------------------------------------------------------------------------------
SOURCE_DIR = Path("source_documents")
INTERMEDIATE_DIR = Path("intermediate_md_files")        # For the original lang. MDs
TRANSLATED_DIR = Path("translated_documents")           # For the final English MDs

# OCR settings 
# EasyOCR codes can be checked here: https://www.jaided.ai/easyocr/
OCR_LANGUAGES = ["es", "en"]
USE_GPU = True              
OCR_CONFIDENCE = 0.3        

# LLM backend configuration
# "ollama" | "vllm"
LLM_BACKEND = "vllm"  # "ollama" 

# Translation & chunking settings
# Might need to optimise this later (should leverage Docling methods)
SOURCE_LANG = "es"
TARGET_LANG = "en"
MAX_LINES_PER_CHUNK = 80           # Soft limit for chunking
ABSOLUTE_MAX_LINES = 120           # Hard safety limit to prevent massive chunks

# Resilience Settings
MAX_RETRIES = 3             # How many times to retry a failed chunk
RETRY_DELAY = 5             # Seconds to wait between retries
REQUEST_TIMEOUT = 120       # Seconds before a request times out

# Ollama Specific Settings
OLLAMA_MODEL = "translategemma:4b"
SYSTEM_PROMPT = (
    "You are a professional translator. You translate Spanish agricultural "
    "documents to English. Rules:\n"
    "1. Translate EVERY line. Do NOT summarize, skip, or omit anything.\n"
    "2. Preserve ALL markdown formatting: headings (#), tables (|), "
    "bold (**), italic (*), bullet points (-), numbered lists.\n"
    "3. Keep <!-- image --> placeholders unchanged.\n"
    "4. Output ONLY the translated text. No explanations, no commentary."
)

# vLLM Specific Settings
# This is leveraging vllm-vllm-translation-guardrail service
# These can be overridden via environment variables (e.g. from .env)
VLLM_ENDPOINT = os.getenv("VLLM_TRANSLATION_ENDPOINT", "http://localhost:9031/v1/chat/completions")
VLLM_COMPLETIONS_ENDPOINT = os.getenv("VLLM_TRANSLATION_ENDPOINT", "http://localhost:9031").rstrip("/v1/chat/completions") + "/v1/completions"
VLLM_MODEL = os.getenv("VLLM_TRANSLATION_MODEL_ID", "google/gemma-3-4b-it")
IS_TRANSLATEGEMMA = "translategemma" in VLLM_MODEL.lower()


def build_translategemma_prompt(text: str, source_lang_code: str, target_lang_code: str,
                                 source_lang_name: str = "English", target_lang_name: str = "English") -> str:
    """Build a prompt for TranslateGemma using the completions API.

    vLLM v0.10.0 cannot pass structured content through the chat completions API
    to TranslateGemma's Jinja2 template, so we apply the template manually and
    use the /v1/completions endpoint instead.
    """
    return (
        f"<bos><start_of_turn>user\n"
        f"You are a professional {source_lang_name} ({source_lang_code}) to "
        f"{target_lang_name} ({target_lang_code}) translator. Your goal is to "
        f"accurately convey the meaning and nuances of the original {source_lang_name} "
        f"text while adhering to {target_lang_name} grammar, vocabulary, and cultural "
        f"sensitivities.\n"
        f"CRITICAL: You MUST output ONLY in {target_lang_name} ({target_lang_code}). "
        f"Do NOT output in Nepali, Hindi, Bengali, or any other language. "
        f"Do NOT use Devanagari, Bengali, or any non-Latin script. "
        f"{target_lang_name} uses the LATIN alphabet only.\n"
        f"Produce only the {target_lang_name} translation, without any additional "
        f"explanations or commentary. Please translate the following {source_lang_name} "
        f"text into {target_lang_name}:\n\n\n{text}"
        f"<end_of_turn>\n<start_of_turn>model\n"
    )


# ------------------------------------------------------------------------------------
# SOURCE DOC TRANSLATOR SERVICE LOGGER 
# ------------------------------------------------------------------------------------
logger = logging.getLogger("DocTranslator")
logger.setLevel(logging.INFO)
handler = logging.StreamHandler()
formatter = logging.Formatter('[SRC_DOC_TRANSL_STATUS] %(message)s')
handler.setFormatter(formatter)
if not logger.handlers:
    logger.addHandler(handler)


# ------------------------------------------------------------------------------------
# CORE FUNCTIONS 
# ------------------------------------------------------------------------------------
def setup_directories():
    """Ensure all necessary directories exist."""
    SOURCE_DIR.mkdir(exist_ok=True)
    INTERMEDIATE_DIR.mkdir(exist_ok=True)
    TRANSLATED_DIR.mkdir(exist_ok=True)


def initialize_converter() -> DocumentConverter:
    """Set up and return the Docling DocumentConverter."""
    logger.info("Initializing Docling PDF Converter with OCR...")
    pipeline_options = PdfPipelineOptions(
        do_ocr=True,
        force_ocr=True,
        ocr_options=EasyOcrOptions(
            lang=OCR_LANGUAGES,
            use_gpu=USE_GPU,
            confidence_threshold=OCR_CONFIDENCE,
        ),
    )
    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(
                pipeline_options=pipeline_options,
            ),
        }
    )


def split_at_boundaries(lines: list[str], max_lines: int) -> list[str]:
    """Split lines into chunks with a soft break and a hard fallback."""
    chunks = []
    current = []
    
    for line in lines:
        is_boundary = line.strip() == "" or line.startswith("#")
        
        # Soft Break: Hit max_lines and found a natural boundary
        if len(current) >= max_lines and is_boundary:
            if not line.startswith("#"):
                current.append(line)
            chunks.append("\n".join(current))
            current = []
            if line.startswith("#"):
                current.append(line)
            continue
            
        # Hard Break: Safety net to prevent oversized chunks
        if len(current) >= ABSOLUTE_MAX_LINES:
            logger.warning(f"    [!] Hard split triggered at {ABSOLUTE_MAX_LINES} lines to prevent oversized chunk.")
            chunks.append("\n".join(current))
            current = []

        current.append(line)
        
    if current:
        chunks.append("\n".join(current))
        
    return chunks


def attempt_llm_call(text: str) -> str:
    """Make the actual API call to the selected backend (without retries)."""
    if LLM_BACKEND == "ollama":
        response = ollama.chat(
            model=OLLAMA_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        f"Translate the following {SOURCE_LANG} markdown to {TARGET_LANG}. "
                        f"Translate every single line, preserve all formatting:\n\n"
                        f"{text}"
                    ),
                },
            ],
            options={"temperature": 0, "num_ctx": 16384},
        )
        return response["message"]["content"].strip()
        
    elif LLM_BACKEND == "vllm":
        if IS_TRANSLATEGEMMA:
            prompt = build_translategemma_prompt(
                text=text,
                source_lang_code=SOURCE_LANG,
                target_lang_code=TARGET_LANG,
                source_lang_name=SOURCE_LANG.upper(),
                target_lang_name=TARGET_LANG.upper()
            )
            payload = {
                "model": VLLM_MODEL,
                "prompt": prompt,
                "temperature": 0.0,
                "max_tokens": 2048,
                "repetition_penalty": 1.2
            }
            endpoint = VLLM_COMPLETIONS_ENDPOINT
        else:
            vllm_prompt = f"Translate the following {SOURCE_LANG} markdown to {TARGET_LANG}. Translate every line, preserve all markdown formatting. Output ONLY the translated text.\n\n{text}"
            payload = {
                "model": VLLM_MODEL,
                "messages": [{"role": "user", "content": vllm_prompt}],
                "temperature": 0.1
            }
            endpoint = VLLM_ENDPOINT

        response = requests.post(
            endpoint,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=REQUEST_TIMEOUT
        )
        response.raise_for_status()
        result = response.json()

        if "choices" in result and len(result["choices"]) > 0:
            if IS_TRANSLATEGEMMA:
                return result["choices"][0]["text"].strip()
            else:
                return result["choices"][0]["message"]["content"].strip()
        else:
            raise ValueError(f"Unexpected vLLM payload structure: {result}")
            
    else:
        raise ValueError(f"Unknown LLM_BACKEND specified: '{LLM_BACKEND}'")


def translate_chunk(text: str) -> str:
    """Wrap the LLM call with retry logic and graceful degradation."""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return attempt_llm_call(text)
        except Exception as e:
            logger.warning(f"    [!] Chunk failed (Attempt {attempt}/{MAX_RETRIES}): {e}")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY)
            else:
                logger.error(f"    [!] Chunk completely failed after {MAX_RETRIES} attempts. Skipping chunk.")
                # Return a placeholder so the rest of the document survives
                return (
                    f"\n\n> **[TRANSLATION FAILED]** Could not translate this section after {MAX_RETRIES} attempts.\n"
                    f"> **Original text:**\n> {text}\n\n"
                )


def translate_text(text: str) -> str:
    """Handle the chunking and translation of a full document's text."""
    lines = text.split("\n")

    if len(lines) <= MAX_LINES_PER_CHUNK:
        return translate_chunk(text)

    chunks = split_at_boundaries(lines, MAX_LINES_PER_CHUNK)
    logger.info(f"    Divided into {len(chunks)} chunks for translation.")

    translated = []
    for i, chunk in enumerate(chunks):
        chunk_lines = chunk.count("\n") + 1
        logger.info(f"    Translating chunk [{i+1}/{len(chunks)}] ({chunk_lines} lines)...")
        translated.append(translate_chunk(chunk))

    return "\n\n".join(translated)


def process_document(pdf_path: Path, converter: DocumentConverter) -> bool:
    """Process a single PDF -> Intermediate MD -> Translated MD using temporary files."""
    md_file = INTERMEDIATE_DIR / pdf_path.with_suffix(".md").name
    tmp_md_file = INTERMEDIATE_DIR / pdf_path.with_suffix(".md.tmp").name
    
    en_file = TRANSLATED_DIR / pdf_path.with_suffix(".md").name
    tmp_en_file = TRANSLATED_DIR / pdf_path.with_suffix(".md.tmp").name

    # Check for the final destination file, not the temporary one
    if en_file.exists():
        logger.info(f"SKIP (Already completely translated): {pdf_path.name}")
        return True

    logger.info(f"=== Processing: {pdf_path.name} ===")

    # Step 1: PDF to Intermediate Markdown (Spanish)
    if not md_file.exists():
        logger.info(f"  Step 1/2: Extracting text & OCR...")
        try:
            result = converter.convert(str(pdf_path))
            md_text = result.document.export_to_markdown(
                image_mode=ImageRefMode.PLACEHOLDER,
            )
            # Write to TMP first, then atomically replace
            tmp_md_file.write_text(md_text, encoding="utf-8")
            tmp_md_file.replace(md_file)
            logger.info(f"  Step 1 Complete: Extracted {len(md_text):,} characters.")
        except Exception as e:
            logger.error(f"  FAILED during extraction: {e}")
            # Clean up the tmp file if it crashed during write
            if tmp_md_file.exists():
                tmp_md_file.unlink()
            return False
    else:
        logger.info(f"  Step 1/2: Intermediate Markdown already exists, skipping extraction.")
        md_text = md_file.read_text(encoding="utf-8")

    # Step 2: Intermediate Markdown to Translated Markdown (English)
    logger.info(f"  Step 2/2: Translating text to English (Backend: {LLM_BACKEND})...")
    start_time = time.time()
    try:
        english_text = translate_text(md_text)
        
        # Write to TMP first, then atomically replace
        tmp_en_file.write_text(english_text, encoding="utf-8")
        tmp_en_file.replace(en_file)
        
        elapsed = time.time() - start_time
        src_lines = len(md_text.split("\n"))
        out_lines = len(english_text.split("\n"))
        ratio = out_lines / max(src_lines, 1)
        
        if ratio > 0.5:
            logger.info(f"  Step 2 Complete: Translation OK ({elapsed:.0f}s, {src_lines}→{out_lines} lines)")
        else:
            logger.warning(f"  Step 2 WARNING: Translated output is much shorter than source ({src_lines}→{out_lines} lines)")
            
        return True
        
    except Exception as e:
        logger.error(f"  FAILED during translation: {e}")
        # Clean up the tmp file if it crashed during write
        if tmp_en_file.exists():
            tmp_en_file.unlink()
        return False


# ------------------------------------------------------------------------------------
# RUN TRANSLATION
# ------------------------------------------------------------------------------------
def main():
    setup_directories()
    
    pdfs = sorted(SOURCE_DIR.glob("*.pdf"))
    if not pdfs:
        logger.info(f"No PDFs found in '{SOURCE_DIR.resolve()}'. Please add files and try again.")
        return

    logger.info(f"Found {len(pdfs)} PDF(s) to process.")
    converter = initialize_converter()

    total = len(pdfs)
    success = 0
    failed = 0

    for i, pdf in enumerate(pdfs, 1):
        logger.info("-" * 50)
        logger.info(f"File {i} of {total}")
        
        if process_document(pdf, converter):
            success += 1
        else:
            failed += 1

    logger.info("=" * 50)
    logger.info(f"Pipeline Finished: {success} successful, {failed} failed.")


if __name__ == "__main__":
    main()


