# Metadata Strategy

## Two-Step Metadata Refinement

Extract metadata at **upload time** and update at **ingest time**, allowing for quick user access.

### Metadata List & Default Values (at upload time)

Extracted *immediately after upload* and stored **in ArangoDB files collection**, to support browsing/searching even before ingest.

* `file_id` (unique identifier)
* `file_name` 🔍 ✍️ (e.g. `abc123.pdf`. For webpage, it will automatically extract its title as the name.)
* `file_size`
* `file_type` 🔍 (MIME type)
* `file_hash` (SHA256 hash of the file, for integrity check)
* `storage_path` (local relevant path, e.g. `/uploads/abc123.pdf`)
* `labels` 🔍 ✍️ (No labels at the beginning. Users can add/edit labels.)
* `author` 🔍 ✍️
* `upload_date` 🔍 (timestamp of uploading to the document repository)
* `create_date` 🔍 ✍️ (The file's system-level creation timestamp. While usually aligning with the upload_date, this value is a changeable metadata attribute. For example, a PDF created at 2023-10-01T12:00:00Z; a html webpage published at 2023-10-01T12:00:00Z)
* `crawl_date` ✍️ (if applicable, when the file was crawled)
* `source_url` ✍️ (only if the file is a webpage, e.g. `https://example.com/page`)
* `language` 🔍 ✍️ (default as `unknown`. For webpages, it would be the value of the 'lang')
* `chunk_count` (number of text chunks. Set to `0` at this stage, to be updated after ingestion)
* dataprep
    * `status` 🔍 (initially set to `pending`, updated to `ingested` after successful ingestion, or `retracted` if the file is retracted)
    * `ingest_date` (timestamp of when the file was successfully ingested, initially empty)
    * `retract_date` (timestamp of when the file was retracted, initially empty)

🔍 means the user can search by this metadata field;

✍️ means the user can edit this metadata field.

### Updating Metadata (after successful ingestion/retraction)

Updated only **after successful ingestion/retraction**.

* `chunk_count` (update to the number of chunks after ingestion; turn back to 0 after retraction)
* `ingest_date` (set to current timestamp when the file is successfully ingested)
* `retract_date` (set to current timestamp when the file is retracted)
* `status` (updated to `ingested` after successful ingestion, or `retracted` if the file is retracted)

### Example Metadata Records

```json
{
    "file_id": "6e1d5f3a",
    "file_name": "ExamplePDF.pdf",
    "file_size": "1.2MB",
    "file_type": "application/pdf",
    "storage_path": "/uploads/ExamplePDF.pdf",
    "labels": ["Arts & Culture", "Tourism"],
    "author": "",
    "upload_date": "2025-05-11T10:30:00Z",
    "create_date": "2000-07-01T12:00:00Z",
    "crawl_date": "",
    "source_url": "",
    "language": "en",
    "chunk_count": 10
}
```

---

## Notes

* Users can **search files by metadata** such as file name, type, and labels **at any time**.
* Users can **edit metadata** fields like `file_name`, `labels`, and `author` **at any time**.