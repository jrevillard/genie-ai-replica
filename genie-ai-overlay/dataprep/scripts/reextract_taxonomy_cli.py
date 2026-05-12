#!/usr/bin/env python3
# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Trigger metadata-only taxonomy re-extraction via document-repository (Admin JWT required)."""

import argparse
import os
import sys

import urllib.error
import urllib.request


def main() -> int:
    p = argparse.ArgumentParser(description="POST /api/files/{id}/reextract-taxonomy")
    p.add_argument("file_id", help="file_id in the files collection")
    p.add_argument(
        "--base-url",
        default=os.getenv("DOCUMENT_REPOSITORY_URL", "http://localhost:3001"),
        help="document-repository base URL",
    )
    p.add_argument("--token", default=os.getenv("ADMIN_BEARER_TOKEN", ""), help="Bearer token (Admin role)")
    args = p.parse_args()
    if not args.token:
        print("Set ADMIN_BEARER_TOKEN or pass --token", file=sys.stderr)
        return 2
    url = f"{args.base_url.rstrip('/')}/api/files/{args.file_id}/reextract-taxonomy"
    req = urllib.request.Request(
        url,
        method="POST",
        headers={"Authorization": f"Bearer {args.token}", "Content-Type": "application/json"},
        data=b"{}",
    )
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            print(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(e.read().decode(), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
