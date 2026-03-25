# GENIE.AI – Document Translation Utilities

## Overview

The GENIE.AI backend (including dataprep and downstream RAG components) is primarily configured for **English-language** documents.

This reflects the current state of the ecosystem:
* Embedding models are generally more performant in English
* Vector search tends to be more reliable
* Broader compatibility with supporting tools and libraries

➡️ **As a result, non-English source documents often need to be translated into English before ingestion, depending on the use case.**

This repository provides tooling to support that workflow.

## PDF Translation Pipeline

Public sector documents (e.g. policies, laws, guidelines) are often distributed as PDFs.

The script: ``` genieai_pdf_translator.py ``` supports an end-to-end pipeline:

1. Convert source PDFs → Markdown (MD)
2.	Translate Markdown → English Markdown

### Translation Backends

The script supports:
* GENIE.AI translation service: ``` vllm-vllm-translation-guardrail ```
* Local / on-device translation: ``` via Ollama ```

### Recommended Model

It is recommended to use ``` vllm-vllm-translation-guardrail ``` with ``` Infomaniak-AI/vllm-translategemma-4b-it``` (This model is optimized for vLLM serving.)

To do this, update your .env to assign the ```VLLM_TRANSLATION_MODEL_ID``` is assigned the correct name.


### Setup Instructions

When using this alongside a GENIE.AI deployment:

1. Create a working directory
    * [Example] From the GENIE.AI project root: ```mkdir translations/```

2. Create a virtual environment
    * [Example] ```python3 -m venv translation_venv```
    * [Example] ```source translation_venv/bin/activate```
    * [Example] ```pip install docling easyocr```

3. Create required subdirectories
    * [Example] ```source_documents/        # Original PDFs```
    * [Example] ```intermediate_md_files/   # Extracted Markdown```
    * [Example] ```translated_documents/    # Final translated Markdown```   

### Configuration

Before running the script, configure:
* ```OCR_LANGUAGES```
* ```SOURCE_LANG```
* ```TARGET_LANG```
* ```SYSTEM_PROMPT```

### Example Usage

* Run in background (recommended): ```nohup python3 genieai_pdf_translator.py ```
* Run with logging: ```nohup python3 genieai_pdf_translator.py > translation.log 2>&1 & ```
* Monitor logs: ```tail -f translation.log ```


###  Notes & Best Practices

Translation quality may vary depending on:
* Source document structure
* OCR quality (especially for scanned PDFs)
* Domain-specific terminology