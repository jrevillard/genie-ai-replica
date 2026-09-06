"""
truncate-taxonomy.py

Wipes the taxonomy collections from ArangoDB so the knowledge hierarchy
can be rebuilt cleanly with create-knowledge-hierarchy.js.

Collections cleared:
  - serviceCategories
  - services
  - categoryServices        (edge)
  - serviceCategoryTranslations  (if exists)
  - serviceTranslations          (if exists)

Usage:
    python truncate-taxonomy.py [--url URL] [--db DB] [--user USER] [--password PW]

Defaults are read from environment variables:
    ARANGO_URL       (default: http://localhost:8529)
    ARANGO_DB_NAME   (default: genie-ai)
    ARANGO_USERNAME  (default: root)
    ARANGO_PASSWORD  (default: test)
"""

import argparse
import os
import sys

try:
    from arango import ArangoClient
except ImportError:
    print("ERROR: python-arango is not installed. Run: pip install python-arango")
    sys.exit(1)

COLLECTIONS = [
    "serviceCategories",
    "services",
    "categoryServices",
    "serviceCategoryTranslations",
    "serviceTranslations",
]


def parse_args():
    parser = argparse.ArgumentParser(description="Truncate ArangoDB taxonomy collections.")
    parser.add_argument("--url",      default=os.getenv("ARANGO_URL",      "http://localhost:8529"))
    parser.add_argument("--db",       default=os.getenv("ARANGO_DB_NAME",  "genie-ai"))
    parser.add_argument("--user",     default=os.getenv("ARANGO_USERNAME",  "root"))
    parser.add_argument("--password", default=os.getenv("ARANGO_PASSWORD",  "test"))
    parser.add_argument("--yes", "-y", action="store_true", help="Skip confirmation prompt")
    return parser.parse_args()


def connect(url, db_name, user, password):
    client = ArangoClient(hosts=url)
    db = client.db(db_name, username=user, password=password, verify=True)
    return db


def count(db, name):
    try:
        return db.collection(name).count()
    except Exception:
        return None


def main():
    args = parse_args()

    print("=" * 55)
    print("  Taxonomy Truncation Script")
    print("=" * 55)
    print(f"  URL      : {args.url}")
    print(f"  Database : {args.db}")
    print(f"  User     : {args.user}")
    print()

    try:
        db = connect(args.url, args.db, args.user, args.password)
        print(f"Connected to ArangoDB {db.version()}\n")
    except Exception as e:
        print(f"ERROR: Could not connect to ArangoDB — {e}")
        sys.exit(1)

    # Show what will be deleted
    print("Collections to be cleared:")
    rows = []
    for name in COLLECTIONS:
        n = count(db, name)
        if n is None:
            rows.append((name, "does not exist — will skip"))
        else:
            rows.append((name, f"{n} documents"))

    for name, info in rows:
        print(f"  {name:<35} {info}")

    print()

    if not args.yes:
        answer = input("This is irreversible. Type 'yes' to proceed: ").strip().lower()
        if answer != "yes":
            print("Aborted.")
            sys.exit(0)

    print()
    for name in COLLECTIONS:
        n = count(db, name)
        if n is None:
            print(f"  SKIP    {name} (collection does not exist)")
            continue
        try:
            db.collection(name).truncate()
            print(f"  CLEARED {name} ({n} documents removed)")
        except Exception as e:
            print(f"  ERROR   {name} — {e}")

    print()
    print("Done. Run create-knowledge-hierarchy.js --file mewa-hierarchy.json to reload.")


if __name__ == "__main__":
    main()
