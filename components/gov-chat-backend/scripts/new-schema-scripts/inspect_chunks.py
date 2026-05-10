"""
inspect-chunks.py — Show all RAG chunks stored in ArangoDB for an ingested file.

Usage:
    python inspect-chunks.py <filename_or_partial>
    python inspect-chunks.py --file-id <file_id>
    python inspect-chunks.py --list

Examples:
    python inspect-chunks.py potato_calendar_dhaka.md
    python inspect-chunks.py potato          # partial match, shows all matches
    python inspect-chunks.py --file-id 1777230779535_a5e215b2
    python inspect-chunks.py --list          # show all files in DB
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.parse
import urllib.error
import base64

# ---------------------------------------------------------------------------
# Config — override with env vars if needed
# ---------------------------------------------------------------------------
ARANGO_URL      = os.getenv("ARANGO_URL",      "http://localhost:8529")
ARANGO_DB       = os.getenv("ARANGO_DB_NAME",  "genie-ai")
ARANGO_USER     = os.getenv("ARANGO_USERNAME", "root")
ARANGO_PASSWORD = os.getenv("ARANGO_PASSWORD", "test")
GRAPH_NAME      = os.getenv("ARANGO_GRAPH_NAME", "GRAPH_TEST")


def _auth_header():
    creds = base64.b64encode(f"{ARANGO_USER}:{ARANGO_PASSWORD}".encode()).decode()
    return {"Authorization": f"Basic {creds}", "Content-Type": "application/json"}


def aql(query, bind_vars=None):
    url = f"{ARANGO_URL}/_db/{ARANGO_DB}/_api/cursor"
    payload = {"query": query, "batchSize": 1000}
    if bind_vars:
        payload["bindVars"] = bind_vars

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers=_auth_header(),
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())["result"]
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"ArangoDB error {e.code}: {body}", file=sys.stderr)
        sys.exit(1)


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------

def list_files():
    rows = aql("""
        FOR doc IN files
        SORT doc.upload_date DESC
        RETURN {
            file_id:   doc.file_id,
            name:      doc.file_name,
            status:    doc.dataprep.status,
            chunks:    doc.chunk_count,
            uploaded:  doc.upload_date,
            labels:    doc.labels
        }
    """)
    if not rows:
        print("No files found in the database.")
        return

    print(f"\n{'FILE NAME':<45} {'STATUS':<16} {'CHUNKS':>6}  {'UPLOADED':<22}  FILE ID")
    print("-" * 120)
    for r in rows:
        name     = (r.get("name") or "(unknown)")[:44]
        status   = (r.get("status") or "-")[:15]
        chunks   = r.get("chunks") or 0
        uploaded = (r.get("uploaded") or "")[:19]
        fid      = r.get("file_id") or "-"
        print(f"{name:<45} {status:<16} {chunks:>6}  {uploaded:<22}  {fid}")
    print()


def find_files_by_name(partial):
    rows = aql("""
        FOR doc IN files
        FILTER CONTAINS(LOWER(doc.file_name), LOWER(@name))
        SORT doc.upload_date DESC
        RETURN {
            file_id:  doc.file_id,
            name:     doc.file_name,
            status:   doc.dataprep.status,
            chunks:   doc.chunk_count,
            uploaded: doc.upload_date
        }
    """, {"name": partial})
    return rows


def get_chunks(file_id):
    source_col = f"{GRAPH_NAME}_SOURCE"
    rows = aql(f"""
        FOR doc IN {source_col}
        FILTER doc.file_id == @file_id
        SORT doc.chunk_index ASC
        RETURN {{
            chunk:  doc.chunk_index,
            labels: doc.chunk_labels,
            text:   doc.text
        }}
    """, {"file_id": file_id})
    return rows


# ---------------------------------------------------------------------------
# Display
# ---------------------------------------------------------------------------

def display_chunks(file_meta, chunks):
    name   = file_meta.get("name") or file_meta.get("file_id")
    status = file_meta.get("status", "?")
    fid    = file_meta.get("file_id", "?")

    print()
    print("=" * 70)
    print(f"  File  : {name}")
    print(f"  ID    : {fid}")
    print(f"  Status: {status}   |   Chunks in graph: {len(chunks)}")
    print("=" * 70)

    if not chunks:
        print("\n  No chunks found in ArangoDB for this file.")
        print("  (It may not be ingested yet, or was retracted.)\n")
        return

    for r in chunks:
        idx    = r.get("chunk", "?")
        labels = r.get("labels") or []
        text   = r.get("text", "")
        label_str = ", ".join(labels) if labels else "(no labels)"

        print(f"\nCHUNK {idx}  |  labels: [{label_str}]")
        print("-" * 70)
        print(text)

    print()
    print(f"  Total: {len(chunks)} chunks")
    print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Inspect RAG chunks stored in ArangoDB for an ingested file."
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("name", nargs="?", help="File name or partial match")
    group.add_argument("--file-id", metavar="FILE_ID", help="Exact file_id")
    group.add_argument("--list", action="store_true", help="List all files in DB")

    args = parser.parse_args()

    if args.list:
        list_files()
        return

    if args.file_id:
        # Direct lookup by file_id
        matches = aql("""
            FOR doc IN files
            FILTER doc.file_id == @fid
            RETURN { file_id: doc.file_id, name: doc.file_name, status: doc.dataprep.status, chunks: doc.chunk_count }
        """, {"fid": args.file_id})
        if not matches:
            print(f"No file found with file_id '{args.file_id}'.")
            sys.exit(1)
        meta = matches[0]
        display_chunks(meta, get_chunks(args.file_id))
        return

    # Partial name match
    matches = find_files_by_name(args.name)

    if not matches:
        print(f"\nNo files found matching '{args.name}'.")
        print("Use --list to see all files.\n")
        sys.exit(1)

    if len(matches) == 1:
        meta = matches[0]
        display_chunks(meta, get_chunks(meta["file_id"]))
        return

    # Multiple matches — let user pick
    print(f"\nFound {len(matches)} files matching '{args.name}':\n")
    for i, m in enumerate(matches):
        print(f"  [{i+1}] {m.get('name'):<45}  status={m.get('status'):<12}  chunks={m.get('chunks') or 0:>3}  id={m.get('file_id')}")

    print()
    choice = input("Enter number to inspect (or q to quit): ").strip()
    if choice.lower() == "q":
        return
    try:
        idx = int(choice) - 1
        if not (0 <= idx < len(matches)):
            raise ValueError
    except ValueError:
        print("Invalid selection.")
        sys.exit(1)

    meta = matches[idx]
    display_chunks(meta, get_chunks(meta["file_id"]))


if __name__ == "__main__":
    main()
