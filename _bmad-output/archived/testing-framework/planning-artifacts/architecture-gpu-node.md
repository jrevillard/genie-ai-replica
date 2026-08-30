---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments: ['brainstorming-session-2026-05-29.md', 'issue-758-gitlab', 'project-context.md']
workflowType: 'architecture'
project_name: 'genie-ai'
user_name: 'Jerome Revillard'
date: '2026-05-29'
lastStep: 8
status: 'complete'
completedAt: '2026-05-29'
---

# Architecture Decision Document — Remote GPU Node

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Input Documents

- **Issue #758** — "Remote GPU Node: Dedicated Docker Compose + Ansible Playbook for Distributed Inference" (GitLab)
- **Brainstorming Session 2026-05-29** — KISS review and simplification of original 8-issue plan
- **project-context.md** — AI agent rules for the GENIE.AI codebase

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**

| # | Exigence | Implication architecturale |
|---|----------|---------------------------|
| F1 | Déployer 5 services GPU sur un nœud dédié | Docker Compose séparé, gestion GPU mémoire |
| F2 | Endpoints accessibles à distance via HTTPS | nginx reverse proxy avec TLS (Let's Encrypt) |
| F3 | Authentification par API keys (1 par instance GENIE.AI) | nginx `map` + fichier de clés externe |
| F4 | Support multi-clés sans redémarrer les services | `nginx -s reload` (zero downtime) |
| F5 | Intégrer docling-serve (officiel IBM) comme 5ème service | Image officielle, pas de fallback in-process |
| F6 | Dataprep appelle docling via `DOCLING_ENDPOINT` | Pas de fallback — si GPU node distant, l'endpoint est configuré |
| F7 | Playbook Ansible séparé pour le déploiement GPU | Inventaire dédié `[gpu_nodes]` |
| F8 | Template `.env` avec section "Remote GPU Endpoints" | Ports 9400-9404, URLs HTTPS |

**Non-Functional Requirements:**

| NFR | Détail | Impact |
|-----|--------|--------|
| Sécurité | Réseau non isolé entre app et GPU | nginx TLS + API keys obligatoire |
| Mutualisation | GPU node shared par N instances GENIE.AI | Stateless, idempotent, 1 clé partagée par client |
| Disponibilité | `nginx -s reload` sans coupure GPU | Reload gracieux, services continus |
| Rétrocompatibilité | Single-node sans override = inchangé | Defaults existants préservés |

### Scale & Complexity

- **Complexité** : Moyenne — principalement de l'infrastructure (Docker Compose + nginx + Ansible), 1 seule modification de code applicatif (dataprep `DOCLING_ENDPOINT`)
- **Domaine** : Infrastructure / DevOps
- **Composants architecturaux** : ~3 (nginx config, Docker Compose GPU, Ansible playbook)

### Technical Constraints & Dependencies

- **vLLM** : 1 modèle par instance (pas de multi-model serving)
- **TEI** : 1 modèle par instance (embedding ≠ reranker)
- **docling-serve** : Image officielle IBM, MIT license — pas de custom microservice
- **GPU** : RTX 6000 Ada (48GB VRAM) — 5 services doivent tenir
- **TLS** : Let's Encrypt via certbot one-shot — même pattern que l'app node
- **DNS** : 1 IP publique = 1 hostname pour le GPU node

### Cross-Cutting Concerns Identified

- **Sécurité** : API keys et TLS appliqués uniformément sur tous les 5 services via nginx
- **Observabilité** : Healthchecks `/health` obligatoires sur chaque service ; smoke tests post-deploy Ansible
- **Monitoring** : Cert expiry alerts requis sur le GPU node

### Party Mode Contributions (2026-05-29)

**Agents consultés :** Winston (Architect), Amelia (Dev), Murat (Test Architect)

| Décision | Source | Détail |
|----------|--------|--------|
| TLS décentralisé | 🏗️ Winston | Chaque node gère ses propres certs via certbot one-shot, même pattern |
| DNS dédié | 🏗️ Winston | 1 IP publique = 1 hostname pour le GPU node, pas de round-robin |
| Fichier compose | 💻 Amelia | `docker-compose.gpu.yaml` à la racine du projet |
| Ansible séparé | 💻 Amelia | `deploy/ansible/deploy-gpu.yml` + inventaire `[gpu_nodes]` |
| Healthchecks | 🧪 Murat | `/health` obligatoire sur les 5 services, vérification post-deploy |
| Smoke tests | 🧪 Murat | Ansible post-deploy < 30s, fail fast si KO |
| Pas de double proxy | 👤 Jerome | Backend rejoint le GPU node directement, pas via nginx app node |
| Pas de fallback docling | 👤 Jerome | `DOCLING_ENDPOINT` configuré = remote, sinon single-node local |
| 1 clé partagée par client | 👤 Jerome | Même API key pour les 5 services, 1 clé par instance GENIE.AI |

## Core Architectural Decisions

### Decision 1: File Structure

**Décision :** Le GPU node utilise les mêmes conventions que le projet existant, avec un Docker Compose séparé et un playbook Ansible dédié.

```
genie-ai/
├── docker-compose.yaml              # App node (existant, inchangé)
├── docker-compose.gpu.yaml          # GPU node (nouveau)
├── env.t4 / env.rtx6000             # GPU config (réutilisés par GPU compose)
├── deploy/
│   └── ansible/
│       ├── deploy.yml               # App node (existant)
│       ├── deploy-gpu.yml           # GPU node (nouveau)
│       ├── inventory/
│       │   └── gpu.ini.example      # Inventaire GPU node (template)
│       ├── group_vars/
│       │   ├── gpu.yml               # Variables GPU node
│       │   └── gpu.vault.example     # Vault secrets GPU (template)
│       └── templates/
│           ├── docker-compose.gpu.yaml.j2
│           ├── gpu-proxy.conf.j2      # nginx config GPU (Jinja2)
│           └── api_keys.map.j2        # Clés API GPU (Jinja2)
├── secrets/
│   └── ssl/                         # Certs Let's Encrypt (existant, gitignored)
└── genie-ai-overlay/
    └── dataprep/
        └── genieai_dataprep_utils.py  # Modification: DOCLING_ENDPOINT
```

**Rationale :**
- `docker-compose.gpu.yaml` à la racine = cohérent avec `env.t4`/`env.rtx6000` déjà existants
- Templates Jinja2 dans `deploy/ansible/templates/` = emplacement dédié Ansible, pas de duplication
- Ansible suit le pattern existant : `deploy-gpu.yml` + inventaire dédié + `group_vars/gpu.yml`
- Les fichiers GPU sont committés (configs, templates) ; les secrets ne sont jamais committés (`secrets/` gitignored)

### Decision 2: Image Versions

**Décision :** Réutiliser les mêmes images et tags que l'app node, avec version pinée pour la stabilité.

| Service | Image | Tag | Source actuelle |
|---------|-------|-----|-----------------|
| vLLM (Llama 3.1-8B) | `vllm/vllm-openai` | `latest` | `docker-compose.yaml` |
| vLLM Translation (Gemma 3-4B) | `vllm/vllm-openai` | `v0.10.0` | `docker-compose.yaml` |
| TEI Embedding | `ghcr.io/huggingface/text-embeddings-inference` | `1.9.3` | `docker-compose.yaml` |
| TEI Reranker | `ghcr.io/huggingface/text-embeddings-inference` | `1.9.3` | `docker-compose.yaml` |
| docling-serve | `ghcr.io/institute-of-data-science/docling-serve` | `latest` | Officiel IBM |
| nginx GPU | `nginx` | `1.28-alpine` | Même base que nginx app node |
| certbot | `certbot/certbot` | `latest` | Même que app node |

**Rationale :**
- Pas de nouvelle image à maintenir sauf docling-serve (officiel)
- Les images vLLM/TEI sont les mêmes que l'app node — mise à jour synchronisée
- `v0.10.0` pinée pour le service translation (déjà en production)
- Variables GPU (`VLLM_GPU_UTILIZATION`, etc.) réutilisées depuis `env.t4`/`env.rtx6000`

### Decision 3: Secrets Management

**Décision :** Chaque node gère ses propres secrets localement. Pas de synchronisation entre nodes.

| Secret | App Node | GPU Node | Source |
|--------|----------|----------|--------|
| SSL certs (Let's Encrypt) | `secrets/ssl/server.crt + server.key` | Générés sur le GPU node par certbot | certbot one-shot |
| API keys | N/A | Généré par Ansible depuis template | `templates/api_keys.map.j2` + `gpu.vault` |
| Ansible vault | `group_vars/test.vault` | `group_vars/gpu.vault` | Chaque playbook, chaque vault |

**API keys management :**
```yaml
# group_vars/gpu.yml
gpu_api_keys:
  - name: instance-genie-a
    key: "generated-secure-key-here"
  - name: instance-genie-b
    key: "generated-secure-key-here"
```

Ansible génère le fichier `api_keys.map` à partir de cette liste :
```nginx
# api_keys.map (généré par Ansible)
instance-genie-a  1;
instance-genie-b  1;
```

**Rationale :**
- Pattern existant : `secrets/` gitignored, certs en `secrets/ssl/`
- Chaque node est autonome — pas de coupling entre les secrets
- Ansible vault protège les clés en transit et en repos
- `nginx -s reload` après modification = pas de redémarrage des services GPU

### Decision 4: Monitoring & Observabilité

**Décision :** Healthchecks intégrés au docker-compose + smoke tests Ansible post-deploy. Pas d'observabilité dédiée sur le GPU node pour le moment (monitoring différé).

**Healthchecks (docker-compose.gpu.yaml) :**
```yaml
vllm-llm:
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 120s  # vLLM est lent au démarrage
tei-embedding:
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:80/health"]
    interval: 30s
    timeout: 10s
    retries: 3
docling-serve:
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
    interval: 30s
    timeout: 10s
    retries: 3
```

**Smoke tests Ansible (post-deploy, < 30s) :**
```yaml
# deploy/ansible/deploy-gpu.yml — post-deploy tasks
- name: Verify nginx is running and TLS is valid
  uri:
    url: "https://{{ inventory_hostname }}:9400/health"
    validate_certs: no
    headers:
      X-API-Key: "{{ gpu_api_keys[0].key }}"
  register: nginx_health
  retries: 5
  delay: 10
  until: nginx_health.status == 200

- name: Verify all 5 GPU services are healthy
  uri:
    url: "https://{{ inventory_hostname }}:{{ item }}/health"
    validate_certs: no
    headers:
      X-API-Key: "{{ gpu_api_keys[0].key }}"
  loop: ["9400", "9401", "9402", "9403", "9404"]
  register: service_health

- name: Verify API key rejection (no key = 401)
  uri:
    url: "https://{{ inventory_hostname }}:9400/health"
    validate_certs: no
  register: auth_check
  failed_when: auth_check.status != 401
```

**Rationale :**
- `start_period: 120s` pour vLLM — le chargement du modèle prend du temps
- Smoke tests couvrent : nginx TLS, 5 services, auth (rejet sans clé)
- Fail fast : Ansible s'arrête immédiatement si un check échoue
- Monitoring/observabilité = futur (intégration avec OTel Collector existant possible)

## Decision Impact Analysis

**Implementation Sequence:**
1. Docker Compose GPU (`docker-compose.gpu.yaml`) — foundation
2. nginx GPU config (`deploy/ansible/templates/gpu-proxy.conf.j2`) — security + routing
3. Ansible playbook (`deploy/ansible/deploy-gpu.yml`) — deployment automation
4. Dataprep code change (`genieai_dataprep_utils.py`) — DOCLING_ENDPOINT
5. Template `.env` — section Remote GPU Endpoints

**Cross-Component Dependencies:**
- Ansible playbook dépend du docker-compose + nginx config (doit déployer les deux)
- Dataprep code change indépendant — peut être testé en local avant le déploiement GPU
- Template `.env` modifié sur l'app node uniquement — le GPU node a ses propres vars

## Implementation Patterns & Consistency Rules

### Naming Patterns

| Item | Convention | Exemple |
|------|-----------|---------|
| Docker Compose GPU | `docker-compose.gpu.yaml` | Racine, parallèle avec `env.t4`/`env.rtx6000` |
| nginx GPU config | `gpu-proxy.conf` | Préfix `gpu-` pour distinguer de l'app node |
| API keys template | `api_keys.map.j2` | Template Jinja2, généré par Ansible |
| Ansible playbook | `deploy-gpu.yml` | Même pattern que `deploy.yml` |
| Ansible variables | `gpu.yml` | `group_vars/gpu.yml` |
| Ansible vault | `gpu.vault` | Secrets chiffrés, clé API keys |
| Port public HTTPS | `9400-9404` | Plage GPU dédiée, séquentiel |
| Template nginx | `gpu-proxy.conf.j2` | Template Jinja2 pour Ansible |

### Structure Patterns

**Nouvelles ressources GPU :**
```
deploy/ansible/
    ├── deploy-gpu.yml         # Playbook GPU node (committé)
    ├── inventory/
    │   └── gpu.ini.example    # Inventaire GPU node (template, committé)
    ├── group_vars/
    │   ├── gpu.yml            # Variables GPU (committé)
    │   └── gpu.vault.example  # Vault secrets template (committé)
    └── templates/
        ├── docker-compose.gpu.yaml.j2  # Compose template (committé)
        ├── gpu-proxy.conf.j2           # nginx template (committé)
        └── api_keys.map.j2             # API keys template (committé)
docker-compose.gpu.yaml        # Compose GPU (committé)
```

**Emplacement des ressources :**
- `deploy/ansible/templates/` — tous les templates Jinja2 GPU (nginx, api_keys, compose)
- `deploy/ansible/` — même structure que l'app node, fichiers séparés

### Format Patterns

**api_keys.map.j2 (template committé) :**
```nginx
# API keys map for GPU node nginx
# Managed by Ansible deploy-gpu.yml - do not edit manually
{% for client in gpu_api_keys %}
{{ client.key }}  1;
{% endfor %}
```

**gpu.yml (variables committées) :**
```yaml
gpu_api_keys:
  - name: instance-genie-a
    key: ""
```

**api_keys.map (généré par Ansible, non committé) :**
```nginx
instance-genie-a  1;
```

### Process Patterns

**Déploiement GPU :**
1. `ansible-playbook -i inventory/gpu.ini deploy-gpu.yml --vault-id gpu@prompt`
2. Ansible génère `docker-compose.gpu.yaml` et `gpu-proxy.conf` depuis templates
3. Ansible génère `api_keys.map` depuis `gpu_api_keys` vault variable
4. Ansible lance `docker compose -f docker-compose.gpu.yaml up -d`
5. Smoke tests Ansible vérifient nginx TLS, health des 5 services, rejet sans clé

**Single-node (inchangé) :**
- Aucune modification requise sur l'app node si `docker-compose.gpu.yaml` n'est pas déployé
- Les env vars GPU (`VLLM_ENDPOINT`, etc.) gardent leurs defaults Docker DNS locaux

**Rollback :**
- `docker compose -f docker-compose.gpu.yaml down` sur le GPU node
- App node inchangé

### Enforcement Guidelines

**Tous les agents IA DOIVENT :**
- Utiliser les noms de services et ports définis dans ce document (9400-9404)
- Ne jamais modifier directement les fichiers générés par Ansible (`api_keys.map`, configs déployées)
- Toujours utiliser les templates Jinja2 pour les configurations GPU
- Ne pas introduire de nouvelles variables env sans les ajouter au template `.env`

**Vérification :**
- `docker compose -f docker-compose.gpu.yaml config` doit passer sans erreur
- `nginx -t` sur le GPU node doit valider la config avant reload
- Smoke tests Ansible doivent tous passer avant de considérer le déploiement réussi

## Project Structure & Boundaries

### Complete Project Directory Structure

```
genie-ai/                              # Project root (existant)
├── docker-compose.yaml                # App node — single source of truth (existant, inchangé)
├── docker-compose.gpu.yaml           # GPU node — dedicated compose (NOUVEAU)
├── env                                # Config template (existant — ajout section Remote GPU Endpoints)
├── env.t4                             # GPU memory config T4 (existant, réutilisé)
├── env.rtx6000                        # GPU memory config RTX 6000 (existant, réutilisé)
│
├── deploy/
│   └── ansible/
│       ├── deploy.yml                 # App node playbook (existant, inchangé)
│       ├── deploy-gpu.yml             # NOUVEAU — GPU node playbook
│       ├── requirements.yml           # Ansible Galaxy (existant, inchangé)
│       ├── inventory/
│       │   ├── test.ini               # App node inventory (existant)
│       │   └── gpu.ini.example       # NOUVEAU — GPU node inventory template
│       ├── group_vars/
│       │   ├── test.yml               # App node vars (existant)
│       │   ├── gpu.yml                # NOUVEAU — GPU node variables
│       │   ├── test.vault.example     # App node vault template (existant)
│       │   └── gpu.vault.example      # NOUVEAU — GPU node vault template
│       └── templates/
│           ├── docker-compose.gpu.yaml.j2  # NOUVEAU — GPU compose template
│           ├── gpu-proxy.conf.j2            # NOUVEAU — GPU nginx template
│           └── api_keys.map.j2              # NOUVEAU — GPU API keys template
│
├── genie-ai-overlay/
│   └── dataprep/
│       └── genieai_dataprep_utils.py  # EXISTANT — ajout DOCLING_ENDPOINT
│
└── secrets/
    └── ssl/                           # SSL certs (existant, gitignored)
```

### Architectural Boundaries

**API Boundaries:**

| Boundary | App Node | GPU Node | Protocol |
|----------|----------|----------|----------|
| Public HTTPS | nginx `:443` | nginx GPU `:9400-9404` | TLS 1.2+ |
| Inter-service | Docker DNS (`http://service:port`) | nginx reverse proxy (`https://gpu-host:940x`) | HTTPS + API key |
| GPU node internal | N/A | Docker DNS (`http://service:port`) | HTTP (non exposé) |

**Component Boundaries:**

```
┌──────────────────────────────────────────────────────────────────────┐
│  APP NODE (existing)                                                 │
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                   │
│  │ Dataprep    │  │ ChatQnA     │  │ Retriever   │  ──┐               │
│  │ (DOCLING_   │  │ (VLLM_      │  │ (EMBEDDING_ │    │ env vars     │
│  │  ENDPOINT)  │  │  ENDPOINT)  │  │  ENDPOINT)  │  ──┘ point here  │
│  └─────────────┘  └─────────────┘  └─────────────┘                   │
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                   │
│  │ Reranker    │  │ Backend    │  │ Frontend    │                   │
│  │ (RERANKER_  │  │             │  │             │                   │
│  │  ENDPOINT)  │  │             │  │             │                   │
│  └─────────────┘  └─────────────┘  └─────────────┘                   │
│                                                                      │
│  Kong ─── NGINX ─────────────────────────────────── Public :443     │
└──────────────────────────────────────────────────────────────────────┘
                              │ HTTPS + API key header
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  GPU NODE (new)                                                      │
│                                                                      │
│  NGINX (TLS termination + API key auth)                             │
│    │:9400 ─── vLLM Llama 3.1-8B        (:8000 internal)              │
│    │:9401 ─── vLLM Gemma 3-4B trans.   (:8000 internal)              │
│    │:9402 ─── TEI Embedding             (:80 internal)                │
│    │:9403 ─── TEI Reranker              (:80 internal)                │
│    │:9404 ─── docling-serve             (:8000 internal)              │
│                                                                      │
│  certbot (one-shot) ─── Let's Encrypt                               │
└──────────────────────────────────────────────────────────────────────┘
```

**Data Boundaries:**

| Boundary | Détail |
|----------|--------|
| Config | App node `env` / `.env` — GPU node vars dans `group_vars/gpu.yml` |
| Secrets | App node vault `test.vault` — GPU node vault `gpu.vault` |
| API keys | GPU node only — `api_keys.map` généré par Ansible depuis vault |
| SSL | App node certs dans `secrets/ssl/` — GPU node certs générés par certbot on-node |

### Requirements to Structure Mapping

| # | Exigence | Emplacement |
|---|----------|-------------|
| F1 | 5 services GPU dédiés | `docker-compose.gpu.yaml` |
| F2 | Endpoints HTTPS distants | `deploy/ansible/templates/gpu-proxy.conf.j2` |
| F3 | Auth API keys (1/instance) | `deploy/ansible/templates/api_keys.map.j2` + `group_vars/gpu.yml` |
| F4 | Multi-clés sans restart | `nginx -s reload` dans `deploy-gpu.yml` |
| F5 | docling-serve (IBM) | Service dans `docker-compose.gpu.yaml` |
| F6 | Dataprep `DOCLING_ENDPOINT` | `genie-ai-overlay/dataprep/genieai_dataprep_utils.py` |
| F7 | Playbook Ansible séparé | `deploy/ansible/deploy-gpu.yml` |
| F8 | Template `.env` section GPU | `env` (section ajoutée) |

### Integration Points

**Internal Communication (GPU node):**
- Docker Compose internal network — services communiquent via Docker DNS sur ports internes
- nginx reverse proxy est le seul point d'entrée public

**External Communication (app → GPU):**
- App node services utilisent env vars pour pointer vers GPU node HTTPS endpoints
- Exemple : `VLLM_ENDPOINT=https://gpu-host:9400/v1` au lieu de `http://vllm-llm:8000/v1`
- Header `X-API-Key` ajouté par chaque service client

**Data Flow:**
```
User Query
  → Backend → ChatQnA → vLLM (app node ou GPU node selon config)
  → Retriever → TEI Embedding (app node ou GPU node selon config)
  → Reranker → TEI Reranker (app node ou GPU node selon config)
  → Dataprep → docling-serve (app node ou GPU node selon config)
```

### File Organization Patterns

**Configuration Files:**
- `deploy/ansible/templates/` — tous les templates Jinja2 committés (`.j2`)
- `group_vars/gpu.yml` — variables committées (pas de secrets)
- `group_vars/gpu.vault` — secrets chiffrés Ansible Vault

**Templates (Jinja2, committés):**
- `templates/docker-compose.gpu.yaml.j2` — compose généré avec vars Ansible
- `templates/gpu-proxy.conf.j2` — nginx config généré avec vars Ansible
- `templates/api_keys.map.j2` — clés API généré depuis `gpu_api_keys` vault

**Secrets (jamais committés):**
- Certificats SSL GPU node — générés par certbot one-shot sur le node
- `group_vars/gpu.vault` — chiffré Ansible Vault
- `inventory/gpu.ini` — inventaire spécifique au déploiement (copié depuis `.example`)

### Development Workflow Integration

**Development (single-node, unchanged):**
```bash
docker compose up -d                    # App node only — defaults Docker DNS
docker compose --profile opea up -d     # Full stack — GPU services local
```

**Deployment (GPU node):**
```bash
cd deploy/ansible
ansible-playbook -i inventory/gpu.ini deploy-gpu.yml --vault-id gpu@prompt
```

**App node avec GPU distant:**
```bash
# .env overrides — point vers GPU node
VLLM_ENDPOINT=https://gpu.example.com:9400/v1
TRANSLATION_VLLM_ENDPOINT=https://gpu.example.com:9401/v1
EMBEDDING_SERVICE_URL=https://gpu.example.com:9402
RERANKER_SERVICE_URL=https://gpu.example.com:9403
DOCLING_ENDPOINT=https://gpu.example.com:9404
VLLM_API_KEY=shared-api-key-for-this-instance
```

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:**
- Les 4 décisions sont cohérentes : Docker Compose séparé (D1) + images app node (D2) + secrets autonomes (D3) + healthchecks/smoke tests (D4) forment un ensemble sans contradiction.
- Aucune incompatibilité de version entre les images sélectionnées (toutes issues du même `docker-compose.yaml` existant).
- Le pattern nginx + certbot (D2) est compatible avec les secrets locaux (D3) — certbot génère sur le node, pas de synchronisation nécessaire.

**Pattern Consistency:**
- Conventions de nommage uniformes (`gpu-` prefix, `.j2` templates, `deploy-gpu.yml`).
- Structure Ansible suit exactement le pattern `deploy.yml` existant.
- Process patterns (déploiement, rollback, single-node) sont complets et non contradictoires.

**Structure Alignment:**
- Le directory tree est sans duplication — un seul emplacement pour chaque fichier.
- Les boundaries API, component, et data sont clairement définies et alignées avec les décisions.

### Requirements Coverage Validation ✅

| Exigence | Couvert | Par |
|----------|---------|-----|
| F1 — 5 services GPU | ✅ | `docker-compose.gpu.yaml` |
| F2 — Endpoints HTTPS | ✅ | `gpu-proxy.conf.j2` (nginx TLS) |
| F3 — API keys auth | ✅ | `api_keys.map.j2` + nginx `map` |
| F4 — Multi-clés sans restart | ✅ | `nginx -s reload` |
| F5 — docling-serve (IBM) | ✅ | Service dans compose, image officielle |
| F6 — DOCLING_ENDPOINT | ✅ | `genieai_dataprep_utils.py` |
| F7 — Ansible séparé | ✅ | `deploy-gpu.yml` |
| F8 — Template `.env` | ✅ | Section Remote GPU Endpoints |

**NFR Coverage:**

| NFR | Couvert | Par |
|-----|---------|-----|
| Sécurité (réseau non isolé) | ✅ | nginx TLS + API keys sur tous les 5 services |
| Mutualisation (N instances) | ✅ | Stateless, 1 clé par client, nginx map |
| Disponibilité (zero downtime reload) | ✅ | `nginx -s reload` |
| Rétrocompatibilité | ✅ | Defaults existants préservés, env vars inchangés |

### Implementation Readiness Validation ✅

**Decision Completeness:** Toutes les décisions incluent versions, rationale, et exemples concrets.

**Structure Completeness:** Arbre complet avec emplacements précis, pas de placeholders génériques.

**Pattern Completeness:** Naming, structure, format, process, et enforcement guidelines documentés.

### Gap Analysis Results

**Aucun gap critique.**

**Gaps mineurs (non bloquants) :**
- `site/content/en/docs/architecture/architecture.md` devrait être mis à jour pour documenter le GPU node (documentation, pas architecture)
- Le schéma de ports dans `env` template (F8) devra être détaillé lors de l'implémentation

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**Architectural Decisions**
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed

**Implementation Patterns**
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths:**
- Approche KISS validée par brainstorming + Party Mode
- Zéro duplication de templates
- Patterns existants réutilisés (Ansible, certbot, nginx)
- Rétrocompatibilité totale — single-node inchangé

**Areas for Future Enhancement:**
- Monitoring OTel sur le GPU node
- Cert expiry alerts
- Scaling multi-GPU nodes

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect project structure and boundaries
- Refer to this document for all architectural questions

**First Implementation Priority:**
1. `docker-compose.gpu.yaml` — 5 services + nginx + certbot
2. `deploy/ansible/templates/gpu-proxy.conf.j2` — nginx reverse proxy with API key auth
