# Ingested Test Document

This **markdown** fixture carries the ingest chain's own upload: the spec
uploads it through the dashboard, triggers the batch ingest on its row and
waits for the dataprep status to land `Ingested`.

Its name is its own, distinct from the upload group's `test-document.md`:
the dashboard's table lists the rows by name, so a name shared with another
group's fixture would leave the batch action free to target that group's
leftover row instead of this run's.

The extension is part of the subject: the dataprep routes the
docling-supported extensions to docling, and docling does not accept plain
text — a `.txt` fixture fails at chunking with `File format not allowed` and
its status never reaches `Ingested`.

## Section 1

One chunk of text for the dataprep to label and index.
