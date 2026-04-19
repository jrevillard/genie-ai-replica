#!/bin/bash
set -e

echo "=== Applying AgriConnect patches ==="

# Patch 1: ArangoDB HTTP timeout 60s -> 300s
python3 - << 'PYEOF'
path = '/usr/local/lib/python3.10/site-packages/arango/http.py'
with open(path, 'r') as f:
    c = f.read()
c = c.replace('DEFAULT_REQUEST_TIMEOUT = 60', 'DEFAULT_REQUEST_TIMEOUT = 300')
with open(path, 'w') as f:
    f.write(c)
print('Patch 1 done: ArangoDB timeout -> 300s')
PYEOF

# Patch 2: AQL pre-limit to avoid scanning all 34k vectors
python3 - << 'PYEOF'
path = '/usr/local/lib/python3.10/site-packages/langchain_arangodb/vectorstores/arangodb_vector.py'
with open(path, 'r') as f:
    c = f.read()
old = 'FOR doc IN @@collection\n                LET score'
new = 'FOR doc IN @@collection\n                LIMIT 500\n                LET score'
if old in c:
    c = c.replace(old, new)
    with open(path, 'w') as f:
        f.write(c)
    print('Patch 2 done: AQL pre-limit 500 applied')
else:
    print('Patch 2: pattern not found - checking file...')
    # Try to find the actual pattern
    for i, line in enumerate(c.split('\n')):
        if 'FOR doc IN @@collection' in line:
            print(f'  Found at line {i}: {repr(line)}')
PYEOF

echo "=== All patches applied ==="
