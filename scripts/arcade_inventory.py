"""One-shot ArcadeDB schema dump used by docs/ARCADEDB_DATASETS.md.

Run inside the haystack-chatqna container so DNS / creds resolve:
    docker exec haystack-chatqna python /tmp/arcade_inventory.py
"""
import os, requests, json, sys

auth=(os.environ['ARCADEDB_USER'], os.environ['ARCADEDB_PASSWORD'])
url=os.environ['ARCADEDB_URL']; db=os.environ['ARCADEDB_DB']

def q(sql):
    r=requests.post(f'{url}/api/v1/query/{db}',
        json={'language':'sql','command':sql}, auth=auth, timeout=20)
    try: return r.json().get('result',[])
    except Exception: return []

types = q('SELECT FROM schema:types')
out = []
for t in types:
    n = t.get('name','')
    kind = t.get('type','')
    if not n: continue
    cnt = 0
    fields = []
    try:
        rows = q(f"SELECT count(*) AS n FROM `{n}`")
        if rows: cnt = rows[0].get('n', 0)
    except Exception:
        pass
    if cnt > 0:
        try:
            sample = q(f"SELECT FROM `{n}` LIMIT 1")
            if sample:
                fields = sorted([k for k in sample[0].keys() if not k.startswith('@')])
        except Exception:
            pass
    out.append({'name': n, 'kind': kind, 'records': cnt, 'fields': fields})

out.sort(key=lambda x: (-x['records'], x['name']))
print(json.dumps(out, indent=2, default=str))
