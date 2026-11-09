#!/usr/bin/env python3
"""GENIE.AI demo seed — populate a fresh install with the docs-site corpus.

Populates a running GENIE.AI instance with a knowledge hierarchy, a
document corpus (ingested by dataprep), and an aligned quickHelp config,
so the quick-help buttons scope retrieval to real content.

All seed data lives in ``demo-seed-config.json`` next to this script:
hierarchy (categories + FR names + services), corpus (docs path →
category), and the quickHelp button set. Adapt that file per install;
the script itself carries no data.

Phases (each idempotent, re-runnable):

  1. RESET     delete every existing service category.
  2. HIERARCHY create the configured categories (create-if-absent; always
               runs — the taxonomy MUST exist before any ingest, dataprep
               fetches it per ingestion).
  3. UPLOAD    delete previous demo files (matched by author marker) and
               upload the corpus. Each file's ONLY labels are its category
               (+ services with --labels-mode family): dataprep mints
               chunk labels as (LLM ∩ taxonomy) ∩ file_labels, so labels
               outside the hierarchy starve category-scoped retrieval.
  4. INGEST    per-file ingest with 429 backoff (dataprep serves ONE lane
               by default), then poll to terminal states.
  5. CONFIG    write the demo genie-ai-config.json; with --apply-config,
               mount it into the running frontend pod via a ConfigMap +
               subPath volume and ROLL OUT (a subPath ConfigMap mount
               never refreshes inside a running pod — restart is required).

Prerequisites
-------------
Two port-forwards::

    kubectl -n genieai port-forward svc/backend 13000:80 &
    kubectl -n genieai port-forward svc/document-repository 13001:80 &

An admin JWT (``GENIE_TOKEN``) OR self-minting env (``KC_ADMIN_USER``,
``KC_ADMIN_PASS``, ``DEMO_ADMIN_PASS`` — the script performs the
documented temp-ROPC dance and reverts it immediately, per mint).

Usage::

    KC_ADMIN_USER=admin KC_ADMIN_PASS=... DEMO_ADMIN_PASS=... \\
        python3 -I genie-demo-seed.py --apply-config

    python3 -I genie-demo-seed.py --ingest-only          # re-ingest only
    python3 -I genie-demo-seed.py --skip-reset --skip-upload \\
        --skip-ingest --apply-config                     # config only
    python3 -I genie-demo-seed.py --dry-run              # plan only
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(HERE, 'demo-seed-config.json')
# Default corpus root: this repo's docs site (script lives at deploy/demo-seed/).
# Override with DOCS_ROOT when the corpus lives elsewhere.
_DEFAULT_DOCS_ROOT = os.path.normpath(
    os.path.join(HERE, '..', '..', 'site', 'content', 'en', 'docs'))

BACKEND = os.environ.get('BACKEND', 'http://127.0.0.1:13000')
DOCREPO = os.environ.get('DOCREPO', 'http://127.0.0.1:13001')
DOCS_ROOT = os.environ.get('DOCS_ROOT', _DEFAULT_DOCS_ROOT)
KUBE_NS = os.environ.get('KUBE_NS', 'genieai')
KUBE_FE = os.environ.get('KUBE_FE', 'deploy/genieai-genieai-umbrella-frontend')
KUBE_BE = os.environ.get('KUBE_BE', 'deploy/genieai-genieai-umbrella-backend')
FE_CONFIG_PATH = '/app/dist/config/genie-ai-config.json'

# Marker written into every demo file's `author` field (the only free-text
# field the single-upload schema accepts), so a re-run can find and delete
# exactly what a previous run uploaded — nothing else. NEVER put the marker
# in labels: labels belong to the hierarchy contract (see phase_upload).
DEMO_MARKER = 'genie-demo-seed'

with open(CONFIG_FILE, encoding='utf-8') as _fh:
    CFG = json.load(_fh)
HIERARCHY = CFG['hierarchy']
CORPUS = [(e['path'], e['category']) for e in CFG['corpus']]
BUTTONS = CFG['buttons']
WELCOME = CFG['welcomeMessage']

# --- Token handling ---------------------------------------------------------

TOKEN = os.environ.get('GENIE_TOKEN', '')

# Admin JWTs live ~5 minutes; the ingest loop with its 429 backoffs outlives
# that. With KC_* env set the script mints its own token through the
# documented temp-ROPC procedure (enable -> token -> REVERT immediately) and
# re-mints on every 401. Without KC_* env, GENIE_TOKEN must be fresh enough.
KC_URL = os.environ.get('KEYCLOAK_ADMIN_URL', 'http://127.0.0.1:18080')
KC_ADMIN_USER = os.environ.get('KC_ADMIN_USER', '')
KC_ADMIN_PASS = os.environ.get('KC_ADMIN_PASS', '')
KC_REALM = os.environ.get('KC_REALM', 'genie')
KC_WEB_CLIENT = os.environ.get('KC_WEB_CLIENT', 'genie-app')
DEMO_ADMIN_USER = os.environ.get('DEMO_ADMIN_USER', 'genie-admin')
DEMO_ADMIN_PASS = os.environ.get('DEMO_ADMIN_PASS', '')
if not TOKEN and not (KC_ADMIN_USER and KC_ADMIN_PASS and DEMO_ADMIN_PASS):
    sys.exit('GENIE_TOKEN env var is required (admin JWT), or set '
             'KC_ADMIN_USER/KC_ADMIN_PASS/DEMO_ADMIN_PASS for self-minting')


def _kc_admin_token():
    data = urllib.parse.urlencode({
        'client_id': 'admin-cli', 'grant_type': 'password',
        'username': KC_ADMIN_USER, 'password': KC_ADMIN_PASS}).encode()
    req = urllib.request.Request(
        f'{KC_URL}/auth/realms/master/protocol/openid-connect/token', data=data)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())['access_token']


def mint_token():
    """Temp-ROPC dance: enable direct grants on the web client, mint a demo
    admin token, REVERT immediately. The revert runs even if the mint
    fails."""
    import base64 as b64
    admin_tok = _kc_admin_token()
    req = urllib.request.Request(
        f'{KC_URL}/auth/admin/realms/{KC_REALM}/clients?clientId={KC_WEB_CLIENT}',
        headers={'Authorization': 'Bearer ' + admin_tok})
    with urllib.request.urlopen(req, timeout=30) as r:
        cid = json.loads(r.read().decode())[0]['id']
    req = urllib.request.Request(
        f'{KC_URL}/auth/admin/realms/{KC_REALM}/clients/{cid}',
        method='PUT', data=json.dumps({'directAccessGrantsEnabled': True}).encode(),
        headers={'Authorization': 'Bearer ' + admin_tok,
                 'Content-Type': 'application/json'})
    urllib.request.urlopen(req, timeout=30)
    try:
        # secrets travel in the POST body, never the URL query
        data = urllib.parse.urlencode({
            'grant_type': 'password', 'client_id': KC_WEB_CLIENT,
            'username': DEMO_ADMIN_USER, 'password': DEMO_ADMIN_PASS}).encode()
        req = urllib.request.Request(
            f'{KC_URL}/auth/realms/{KC_REALM}/protocol/openid-connect/token',
            data=data)
        with urllib.request.urlopen(req, timeout=30) as r:
            tok = json.loads(r.read().decode())['access_token']
    finally:
        req = urllib.request.Request(
            f'{KC_URL}/auth/admin/realms/{KC_REALM}/clients/{cid}',
            method='PUT', data=json.dumps({'directAccessGrantsEnabled': False}).encode(),
            headers={'Authorization': 'Bearer ' + admin_tok,
                     'Content-Type': 'application/json'})
        urllib.request.urlopen(req, timeout=30)
    claims = json.loads(b64.urlsafe_b64decode(
        tok.split('.')[1] + '=' * (-len(tok.split('.')[1]) % 4)))
    if 'admin' not in (claims.get('realm_access') or {}).get('roles', []):
        sys.exit(f"{DEMO_ADMIN_USER} lacks the realm role 'admin' — cannot drive the API")
    return tok


def fresh_token():
    global TOKEN
    if KC_ADMIN_USER and KC_ADMIN_PASS and DEMO_ADMIN_PASS:
        TOKEN = mint_token()
        print('   [token] re-minted (temp ROPC, reverted)')
    elif not TOKEN:
        sys.exit('token expired and no KC_* env for self-minting — '
                 're-run with a fresh GENIE_TOKEN')
    return TOKEN


# --- HTTP helpers -----------------------------------------------------------

def http_json(base, path, method='GET', payload=None, token=None, timeout=60):
    if token is None:
        token = TOKEN
    req = urllib.request.Request(
        base + path, method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode()
            return r.status, (json.loads(body) if body else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def http_multipart(base, path, field, filename, content, fields, token=None):
    if token is None:
        token = TOKEN
    boundary = '----genie-demo-seed-boundary'
    out = []
    for k, v in fields.items():
        out.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n')
    out.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; '
        f'filename="{filename}"\r\nContent-Type: text/markdown\r\n\r\n')
    body = ''.join(out).encode() + content + f'\r\n--{boundary}--\r\n'.encode()
    req = urllib.request.Request(
        base + path, method='POST', data=body,
        headers={'Authorization': 'Bearer ' + token,
                 'Content-Type': f'multipart/form-data; boundary={boundary}'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def unwrap_list(body):
    """GET /api/files returns the list under a few possible keys."""
    if isinstance(body, list):
        return body
    if isinstance(body, dict):
        for k in ('data', 'files', 'results'):
            if isinstance(body.get(k), list):
                return body[k]
    return []


ARANGO_NODE_JS = """
const {Database, aql} = require('arangojs');
const db = new Database({url: process.env.ARANGO_URL || 'http://arangodb-single:8529',
  databaseName: process.env.ARANGO_DB || 'genie-ai',
  auth: {username: process.env.ARANGO_USER || 'root', password: process.env.ARANGO_PASSWORD}});
const MARKER = process.argv[2];
db.query(aql`FOR f IN files FILTER f.author == ${MARKER}
  RETURN {file_id: f.file_id, file_name: f.file_name, dataprep: {status: f.dataprep ? f.dataprep.status : null}}`)
  .then(c => c.all()).then(r => { console.log(JSON.stringify(r)); process.exit(0); })
  .catch(e => { console.error(e.message); process.exit(1); });
"""


def files_via_arango():
    """Token-expiry fallback: read demo file statuses straight from ArangoDB
    through the backend pod (arangojs + its own service credentials). The
    script is written OUTSIDE the pod image, so node must resolve arangojs
    from the backend's own /app."""
    import base64, subprocess
    b64 = base64.b64encode(ARANGO_NODE_JS.encode()).decode()
    cmd = (f"echo {b64} | base64 -d > /tmp/demo-files.js && "
           f"cd /app && node /tmp/demo-files.js {DEMO_MARKER}")
    out = subprocess.run(['kubectl', 'exec', '-n', KUBE_NS, KUBE_BE, '--',
                          'sh', '-c', cmd], capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f'arango fallback failed: {out.stderr.strip()[:200]}')
    return json.loads(out.stdout.strip().splitlines()[-1])


def list_demo_files():
    """All demo files, PAGINATED — GET /api/files defaults to page size 10,
    which silently hides everything past the first page."""
    out = []
    page = 1
    while True:
        st, body = http_json(DOCREPO, f'/api/files?page={page}&limit=50')
        if st == 401 or st == 403:
            if page == 1:
                return files_via_arango()
            break
        if st != 200:
            sys.exit(f'cannot list files: HTTP {st} {str(body)[:200]}')
        items = [f for f in unwrap_list(body)
                 if str(f.get('author') or '') == DEMO_MARKER]
        out.extend(items)
        if len(unwrap_list(body)) < 50:
            break
        page += 1
    return out


# --- Phase 1: reset the hierarchy -------------------------------------------

def phase_reset(dry):
    print('== Phase 1: reset hierarchy')
    st, body = http_json(BACKEND, '/api/service-categories/categories')
    if st != 200:
        sys.exit(f'cannot list categories: HTTP {st} {str(body)[:200]}')
    cats = unwrap_list(body)
    print(f'   {len(cats)} existing categories')
    for c in cats:
        key = c.get('catKey') or c.get('_key') or c.get('id')
        if not dry:
            st, _ = http_json(BACKEND, f'/api/service-categories/{key}', method='DELETE')
            if st not in (200, 204):
                sys.exit('category delete failed — aborting (hierarchy is now partial)')
        print(f"   - {c.get('nameEN')}" + (' [dry]' if dry else ' deleted'))


# --- Phase 2: create the hierarchy (create-if-absent) -----------------------

def phase_hierarchy(dry):
    print('== Phase 2: create docs hierarchy')
    st, body = http_json(BACKEND, '/api/service-categories/categories')
    existing = set()
    if st == 200:
        existing = {c.get('nameEN') for c in unwrap_list(body)}
    created = 0
    for cat in HIERARCHY:
        if cat['nameEN'] in existing:
            print(f"   = {cat['nameEN']} (already present)")
            continue
        if dry:
            print(f"   + {cat['nameEN']} [dry]")
            created += 1
            continue
        st, body = http_json(BACKEND, '/api/service-categories/', method='POST', payload={
            'nameEN': cat['nameEN'],
            'translations': [{'languageCode': 'FR', 'translation': cat['nameFR']}],
        })
        if st not in (200, 201):
            sys.exit(f"create category {cat['nameEN']}: HTTP {st} {str(body)[:200]}")
        key = (body.get('category', {}) or {}).get('_key') if isinstance(body, dict) else None
        if not key and isinstance(body, dict):
            key = body.get('_key') or body.get('catKey') or (body.get('data', {}) or {}).get('_key')
        print(f"   + {cat['nameEN']} (key={key})")
        for sen, sfr in cat['services']:
            sst, sbody = http_json(
                BACKEND, f'/api/service-categories/{key}/services', method='POST', payload={
                    'nameEN': sen,
                    'translations': [{'languageCode': 'FR', 'translation': sfr}],
                })
            if sst not in (200, 201):
                print(f"     ! service {sen}: HTTP {sst} {str(sbody)[:150]}")
            created += 1
    print(f'   hierarchy complete ({created} writes)')
    if not dry:
        st, body = http_json(BACKEND, '/api/service-categories/categories')
        print(f'   verification: {len(unwrap_list(body))} categories now in the DB')


# --- Phase 3: upload the corpus ---------------------------------------------

def phase_upload(dry, labels_mode):
    print('== Phase 3: upload corpus')
    old = list_demo_files()
    for f in old:
        fid = f.get('file_id')
        if dry:
            print(f"   - purge {f.get('file_name')} [dry]")
            continue
        # Contract (fileService delete guard): an INGESTED file serves the
        # corpus and refuses DELETE with 409 — retract FIRST, then delete.
        # An in-flight ingest instead needs kill-ingest before the retract.
        st, _ = http_json(DOCREPO, f'/api/files/{fid}/retract', method='POST', payload={})
        if st not in (200, 204, 409):
            http_json(DOCREPO, f'/api/files/{fid}/kill-ingest', method='POST', payload={})
            st, _ = http_json(DOCREPO, f'/api/files/{fid}/retract', method='POST', payload={})
        st, _ = http_json(DOCREPO, f'/api/files/{fid}', method='DELETE')
        print(f"   - purge {f.get('file_name')}: {'ok' if st in (200, 204, 404) else 'HTTP ' + str(st)}")

    # category -> its services, for --labels-mode family
    family = {c['nameEN']: [s[0] for s in c['services']] for c in HIERARCHY}
    uploaded = []
    for rel, category in CORPUS:
        if dry:
            print(f'   + {rel} (category={category}, mode={labels_mode}) [dry]')
            uploaded.append('dry-' + rel)
            continue
        path = os.path.join(DOCS_ROOT, rel)
        with open(path, 'rb') as fh:
            content = fh.read()
        name = os.path.basename(rel)
        if labels_mode == 'family':
            # category + its own services — makes the service hierarchy
            # level retrievable (serviceLabels scopes are otherwise dead:
            # the intersection never yields a service label)
            labels = [category] + family.get(category, [])
        else:
            labels = [category]
        st, body = http_multipart(
            DOCREPO, '/api/files/upload', 'file', name, content,
            fields={
                'author': DEMO_MARKER,
                'labels': ','.join(labels),
                'language': 'en',
            })
        fid = None
        if isinstance(body, dict):
            data = body.get('data') or {}
            fid = data.get('file_id') or data.get('id')
        if st not in (200, 201) or not fid:
            print(f'   ! {rel}: HTTP {st} {str(body)[:200]}')
            continue
        print(f'   + {rel} -> {fid}')
        uploaded.append(fid)
    if not uploaded:
        sys.exit('nothing uploaded — aborting before ingest')
    return uploaded


# --- Phase 4: ingest + poll --------------------------------------------------

INGEST_TERMINAL = {'ingested', 'ingested with warnings', 'ingestion error', 'retracted', 'killed'}
INGEST_FAILED = {'ingestion error', 'retracted', 'killed'}


def phase_ingest(file_ids, poll_minutes, dry):
    if dry:
        print(f'== Phase 4: ingest {len(file_ids)} files [dry]')
        return
    print(f'== Phase 4: ingest {len(file_ids)} files')
    # dataprep serves ONE ingest lane by default: firing a bulk ingest
    # 429s everything past the first file. Fire one file at a time and
    # retry the 429s with backoff until each file is accepted or gives up.
    accepted, rejected = [], {}
    for fid in file_ids:
        for attempt in range(40):
            st, body = http_json(DOCREPO, f'/api/files/{fid}/ingest',
                                 method='POST', payload={})
            if st in (200, 201, 202, 409):  # 409 = already ingesting: fine
                accepted.append(fid)
                break
            if st in (401, 403):
                fresh_token()
                continue
            if st == 429:
                time.sleep(min(30, 5 + attempt * 5))
                continue
            rejected[fid] = (st, str(body)[:150])
            break
        else:
            rejected[fid] = (429, 'gave up after 40 backoff rounds')
    print(f'   accepted: {len(accepted)}/{len(file_ids)}')
    for fid, err in rejected.items():
        print(f'   ! {fid}: {err}')
    if not accepted:
        sys.exit('nothing accepted for ingest')

    deadline = time.time() + poll_minutes * 60
    while True:
        time.sleep(20)
        files = {f.get('file_id'): f for f in list_demo_files()}
        states = {}
        for fid in accepted:
            f = files.get(fid) or {}
            s = (f.get('dataprep') or {}).get('status') or '?'
            states.setdefault(s, []).append(f.get('file_name'))
        running = sum(len(v) for k, v in states.items() if k not in INGEST_TERMINAL)
        print(f'   poll: {{k: len(v) for k, v in states.items()}} running={running}'
              .replace('{k: len(v) for k, v in states.items()}',
                       str({k: len(v) for k, v in states.items()})))
        if running == 0:
            for k, v in states.items():
                if k in INGEST_FAILED:
                    print(f'   FAILED ({k}): {v}')
            break
        if time.time() > deadline:
            print(f'   TIMEOUT after {poll_minutes} min — remaining: '
                  f'{ {k: v for k, v in states.items() if k not in INGEST_TERMINAL} }')
            break
    files = {f.get('file_id'): f for f in list_demo_files()}
    done = sum(1 for fid in accepted
               if (files.get(fid, {}).get('dataprep') or {}).get('status') in INGEST_TERMINAL)
    failed = [files[fid]['file_name'] for fid in accepted
              if (files.get(fid, {}).get('dataprep') or {}).get('status') in INGEST_FAILED]
    print(f'   ingested: {done}/{len(accepted)}; failed: {len(failed)}')


# --- Phase 5: config swap -----------------------------------------------------

def build_config(base_config_path):
    with open(base_config_path) as fh:
        cfg = json.load(fh)
    cfg.setdefault('features', {}).setdefault('chat', {})['quickHelp'] = {
        'buttons': BUTTONS}
    # The baked-in base may carry a country-flavoured welcome message; the
    # docs corpus speaks about the framework itself.
    cfg['features']['chat']['welcomeMessage'] = WELCOME
    return cfg


def phase_config(base_config_path, apply):
    print('== Phase 5: quickHelp config')
    cfg = build_config(base_config_path)
    out = os.path.join(HERE, 'genie-ai-config.json')
    with open(out, 'w') as fh:
        json.dump(cfg, fh, indent=2, ensure_ascii=False)
        fh.write('\n')
    print(f'   written: {out}')
    if not apply:
        return
    import subprocess
    cm = 'genie-demo-config'  # single well-known name
    subprocess.run(['kubectl', 'create', 'configmap', cm, '-n', KUBE_NS,
                    f'--from-file=genie-ai-config.json={out}',
                    '--dry-run=client', '-o', 'yaml'], check=True,
                   stdout=open('/tmp/demo-cm.yaml', 'w'))
    subprocess.run(['kubectl', 'apply', '-f', '/tmp/demo-cm.yaml'], check=True)
    patch = json.dumps({'spec': {'template': {'spec': {
        'volumes': [{'name': 'demo-config', 'configMap': {'name': cm}}],
        'containers': [{'name': 'frontend', 'volumeMounts': [
            {'name': 'demo-config',
             'mountPath': FE_CONFIG_PATH,
             'subPath': 'genie-ai-config.json',
             'readOnly': True}]}]}}}})
    subprocess.run(['kubectl', 'patch', '-n', KUBE_NS, KUBE_FE,
                    '--type=strategic', '-p', patch], check=True)
    subprocess.run(['kubectl', '-n', KUBE_NS, 'rollout', 'status', KUBE_FE,
                    '--timeout=300s'], check=True)
    # A ConfigMap mounted via subPath NEVER refreshes inside a running pod:
    # a content-only update needs a restart to remount the bytes.
    subprocess.run(['kubectl', '-n', KUBE_NS, 'rollout', 'restart', KUBE_FE],
                   check=True)
    subprocess.run(['kubectl', '-n', KUBE_NS, 'rollout', 'status', KUBE_FE,
                    '--timeout=300s'], check=True)
    print(f'   applied + restarted: ConfigMap {cm} at {FE_CONFIG_PATH}')
    print(f'   restore baseline: kubectl -n {KUBE_NS} rollout undo {KUBE_FE} '
          f'&& kubectl -n {KUBE_NS} delete configmap {cm}')


# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply-config', action='store_true')
    ap.add_argument('--skip-reset', action='store_true',
                    help='skip the hierarchy wipe (create-if-absent still runs)')
    ap.add_argument('--skip-upload', action='store_true')
    ap.add_argument('--skip-ingest', action='store_true')
    ap.add_argument('--ingest-only', action='store_true',
                    help='ingest+poll the files already uploaded (marker match); '
                         'no hierarchy reset, no upload, no config write')
    ap.add_argument('--labels-mode', choices=['category', 'family'], default='category',
                    help='category: file labels = its category only (service '
                         'scoping stays inert). family: category + its services '
                         '(service-level retrieval works; costs a re-ingest).')
    ap.add_argument('--dry-run', action='store_true',
                    help='print the plan; no writes anywhere')
    ap.add_argument('--poll-minutes', type=int, default=30)
    ap.add_argument('--base-config', default='/tmp/k3s-config.json',
                    help='current genie-ai-config.json to surgically update')
    args = ap.parse_args()

    if KC_ADMIN_USER and KC_ADMIN_PASS and DEMO_ADMIN_PASS:
        fresh_token()
    if not TOKEN:
        sys.exit('no usable admin token')

    if args.ingest_only:
        file_ids = [f['file_id'] for f in list_demo_files()]
        if not file_ids:
            sys.exit('no demo files found (author marker miss)')
        phase_ingest(file_ids, args.poll_minutes, args.dry_run)
        return
    if not args.skip_reset:
        phase_reset(args.dry_run)
    phase_hierarchy(args.dry_run)
    file_ids = []
    if not args.skip_upload:
        file_ids = phase_upload(args.dry_run, args.labels_mode)
    if file_ids and not args.skip_ingest:
        phase_ingest(file_ids, args.poll_minutes, args.dry_run)
    phase_config(args.base_config, args.apply_config)
    print('== done')


if __name__ == '__main__':
    main()
