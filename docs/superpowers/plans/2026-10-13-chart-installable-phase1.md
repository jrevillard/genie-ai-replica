# Plan: rendre le chart installable — Phase 1 (contrat app), Phase 2 (ingress Gateway API)

> Ce plan a été relu de manière adversariale. Les corrections issues de cette review sont intégrées et marquées **[corrigé]**. Quatre claims de la review se sont révélés **fausses** après vérification contre le code et l'upstream — elles sont consignées en fin de plan pour ne pas être réintroduites.

## Context

Le chart `charts/genieai-umbrella/` rend et lint clean, mais **ne peut pas produire une install qui fonctionne**. Un `/code-review` a remonté 15 findings ; l'investigation a montré que ce ne sont pas 15 bugs indépendants mais **une seule cause systémique** : le chart a été construit tier par tier (foundation → data tier → service tier) et **le tier qui rend la stack accessible n'a jamais été construit**. Chaque tier porte donc des hypothèses qui pendent sur lui.

Faits vérifiés sur le worktree :

- **Zéro ingress rendu.** Aucun `Ingress`, `Gateway` ou `HTTPRoute`. Le chart diffère vers « Plan 6 » via des `podSelector: {}` en placeholder dans plusieurs NetworkPolicy, et `templates/gateway/` n'existe pas — le plan `2026-10-08-genie-ai-helm-charts-per-env-ingress.md` n'a jamais été exécuté au-delà de sa Task 1.
- **Le mécanisme d'injection de secrets est auto-contradictoire.** `_service-factory.tpl:68-76` câble `services.<svc>.secrets` en `envFrom: secretRef`, qui exporte chaque clé **sous son propre nom**. Or `arangodb-deployment.yaml:53-59` documente que `arango-root-secret` porte `username`/`password` (contrat kube-arangodb), alors que `index.js:969-982` exige `ARANGO_USER`/`ARANGO_PASSWORD`. `envFrom` ne sait pas renommer une clé.
- **Le backend ne démarre pas.** Il rend `KEYCLOAK_URL, ARANGO_URL, OTEL_…, TRANSLATION_CACHE*` seulement ; il exige 7 variables et lève une exception si une manque. `ARANGO_DB`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID` n'ont aucune source. Pire : `values.yaml:276-277` liste `huggingface-hub-token` et `email-password` sous `services.backend.secrets` — le code ne les lit **pas** du tout (ce sont des variables du tier AI/ML), et `envFrom` sur un Secret inexistant est un `CreateContainerConfigError`.
- **L'issuer OIDC est instable.** Le CR met `hostname.strict: false` sans hostname, donc Keycloak dérive sa base de l'en-tête `Host` : l'issuer diffère selon qui demande. La valeur `KC_PUBLIC_ORIGIN` que le chart exporte pour le realm n'est **jamais communiquée à Keycloak**.
- **Le non-root est un override global qui casse tout.** `_service-factory.tpl:48-52` force `runAsUser: 65534`. L'image backend déclare `USER node` (1000) et chown `/app/logs`, `/app/Uploads`, `/app/data` — 65534 ne peut plus y écrire. nginx, frontend et doc-repo n'ont **aucune** directive `USER` (donc root) et doivent écrire dans leur propre système de fichiers ; PSA `enforce: restricted` (v1.33, `templates/namespace.yaml:47`) refuse `runAsUser: 0`.

**Résultat voulu :** la Phase 1 rend le chart installable et vérifiable en-cluster sur minikube via `kubectl port-forward`, sans contrôleur d'ingress. La Phase 2 construit le tier d'ingress en **Gateway API (`gateway.networking.k8s.io/v1`, contrôleur-agnostic)** avec cert-manager.

## Branchement

MR !520 (`feat/k8s-migration`) est vert et constitue une unité cohérente à part entière (convergence du realm). **Le merger d'abord**, puis ouvrir une branche dédiée pour la Phase 1 depuis `main`.

---

## Global Constraints

- The chart stays **secret-mechanism agnostic**: it references Secrets by name and never renders a secret value.
- Reuse the existing `{envVar, secretName, secretKey}` row shape; no third syntax.
- `envFrom` is banned in rendered output (P1.11 asserts it).
- All comments and docs in English.
- Never edit `configs/keycloak/`, `docker-compose.yaml` or any `Dockerfile` — the compose path is frozen.

## Tasks

## Phase 1 — le contrat applicatif

### Couverture des 15 findings du `/code-review`

| Finding | Traitement |
|---|---|
| backend : 7 variables requises absentes | **P1.2** |
| `ARANGO_PASSWORD` via `envFrom` au lieu de `secretKeyRef` | **P1.1** (le mécanisme, pas le cas particulier) |
| `KEYCLOAK_URL` in-cluster vs publique | **P1.9** (via hostname fixe, pas via l'URL) |
| `VUE_APP_API_URL` = DNS in-cluster | **P1.7** |
| `/auth/` non routé par nginx | **P1.7** |
| `helm test` ne peut pas atteindre clamav/redis | **différé** — voir la note NetworkPolicy ci-dessous |
| doc-repo : pas de règle egress 8080 | **P1.7** (la règle `/auth/` s'accompagne de l'egress) |
| nginx uid 65534 ne peut écrire `/etc/nginx/certs` | **P1.4** |
| frontend uid 65534 ne peut écrire `config.js` | **P1.4** |
| backend : pas de PVC ni job de migrations | **P1.4** (volumes) + **P1.5** (job) |
| Event pre-upgrade écrit dans `/tmp` read-only | **P1.8** |
| `keycloakrealmimports` laissé en RBAC | déjà fait (branche courante) |
| nom du Secret CNPG codé en dur | **P1.8** |
| `env` doc-repo remplacé au lieu de concaténé | **P1.2** |
| image du Job : registre non conditionnel | **P1.6** |
| clamav/redis ignorent `global.imageRegistry` | **P1.6** |

**Imprécis et hors périmètre, assumés :** « doc-repo n'a pas de PVC » est faux (le chart rend `document-repository-uploads`) ; « `helm test` échoue toujours » est vrai en prod mais faux sur le CNI par défaut de minikube (kubenet n'applique pas les NetworkPolicy). Voir la note ci-dessous.

### Ordre et couplages [corrigé]

Le seul couplage **dur** est **P1.1 → P1.2** : retirer `envFrom` sans fournir les variables manquantes laisse le backend en crash-loop (`index.js:970-985`).

**P1.3 + P1.4 sont un couplage souple** [corrigé] — la review a raison : garder le `uid` blanket en place laisse le chart installable. Ils forment un second gate, pas le premier. Deux gates : `{P1.1, P1.2}` puis `{P1.3, P1.4}`.

Indépendants entre eux et parallélisables : P1.6, P1.7, P1.8, P1.9, P1.10. Tous rejoignent P1.11.

### Note NetworkPolicy — un vrai trou prod, assumé

Les `podSelector: {}` en placeholder (backend, frontend, nginx, documentRepository) et les `ipBlock: 0.0.0.0/0` ne sont pas validés par la Phase 1, parce que le CNI par défaut de minikube ne les applique pas. Ne pas ajouter Calico à la recette minikube. À la place : une variante du job `chart:install` sur kind **avec** Calico (`--networking=calico`), qui est la couverture réelle. **Suivi à créer en Phase 2** (P2.5), qui est l'endroit où les labels du gateway et des pods opérateurs sont enfin connus.

### Task 1: Surface de mapping de secrets, et retrait de `envFrom`

**Files:**
- Create: `charts/genieai-umbrella/templates/_lib/_secrets.tpl`
- Modify: `charts/genieai-umbrella/templates/_lib/_service-factory.tpl`
- Modify: `charts/genieai-umbrella/templates/data/keycloak-convergence-job.yaml`
- Modify: `charts/genieai-umbrella/values.yaml`

**Interfaces:**
- Produces: `genieai-umbrella.envFromSecretRows`, a helper taking a list of `{envVar, secretName, secretKey}` rows and returning YAML `- name:` / `valueFrom.secretKeyRef` lines. Task 2 consumes it for the backend's four secret-backed variables.

- [ ] **Step 1: Capture the reference render BEFORE touching anything**

```bash
rm -rf /tmp/p1-before && helm template t charts/genieai-umbrella/ -n genieai \
  --set data.keycloak.failOnPlaceholderSecrets=false \
  --set data.keycloak.clientSecrets.proxyClient=t \
  --set data.keycloak.clientSecrets.dataprep=t \
  --set data.keycloak.clientSecrets.grafana=t \
  --output-dir /tmp/p1-before >/dev/null && echo "BASELINE_OK"
```

Expected: `BASELINE_OK`. Without this file the byte-identical gate in Step 5 has nothing to compare against and passes vacuously.

- [ ] **Step 2: Write the helper**

New `templates/_lib/_secrets.tpl`, one definition, no side effects:

```gotemplate
{{/*
Render secret-mapped env rows. The single renderer for the
{envVar, secretName, secretKey} row shape — used by the service factory
and by the convergence Job's data.keycloak.convergence.envSecrets.

Secret-mechanism agnostic by construction: the template emits a
secretKeyRef and nothing else. A SealedSecret, an ExternalSecret, a
SOPS-managed Secret and a hand-`kubectl create`'d one satisfy it
identically, and no value is ever read or rendered.

`envVar` is the consumer's contract, `secretKey` is the provider's, and
`secretName` is the join. That row shape is the whole reason this
surface exists: `envFrom` exports each Secret key under its own name and
cannot bridge two vocabularies (kube-arangodb's `username`/`password`
against the backend's ARANGO_USER/ARANGO_PASSWORD).
*/}}
{{- define "genieai-umbrella.envFromSecretRows" -}}
{{- range $i, $row := . }}
- name: {{ required (printf "envSecrets[%d].envVar is required" $i) $row.envVar }}
  valueFrom:
    secretKeyRef:
      name: {{ required (printf "envSecrets[%d].secretName is required" $i) $row.secretName | quote }}
      key: {{ required (printf "envSecrets[%d].secretKey is required" $i) $row.secretKey | quote }}
{{- end }}
{{- end -}}
```

- [ ] **Step 3: Replace `envFrom` in the factory**

In `_service-factory.tpl`, delete the `envFrom` block emitted from `$svc.secrets` and merge the helper output into `env:` instead, concatenating (not replacing) the operator's `$svc.env`.

- [ ] **Step 4: Use the same helper in the convergence Job**

In `keycloak-convergence-job.yaml`, replace the inline `range` over `.Values.data.keycloak.convergence.envSecrets` with the same include. **This must be a pure extraction** — the rendered output is asserted byte-identical in Step 5.

- [ ] **Step 5: Prove the Job render is byte-identical, and prove the guard still bites**

```bash
rm -rf /tmp/p1-after && helm template t charts/genieai-umbrella/ -n genieai \
  --set data.keycloak.failOnPlaceholderSecrets=false \
  --set data.keycloak.clientSecrets.proxyClient=t \
  --set data.keycloak.clientSecrets.dataprep=t \
  --set data.keycloak.clientSecrets.grafana=t \
  --output-dir /tmp/p1-after >/dev/null
cmp -s /tmp/p1-before/genieai-umbrella/templates/data/keycloak-convergence-job.yaml \
       /tmp/p1-after/genieai-umbrella/templates/data/keycloak-convergence-job.yaml \
  && echo "JOB_RENDER_IDENTICAL" || echo "JOB_RENDER_CHANGED"
```

Expected: `JOB_RENDER_IDENTICAL`. If it changed, the helper is not a pure extraction — fix it before committing.

- [ ] **Step 6: Delete `services.backend.secrets` and the two unread rows**

Remove the `secrets:` list from `services.backend` in `values.yaml`, including `huggingface-hub-token` and `email-password`. `envFrom` on a Secret the chart does not create is a `CreateContainerConfigError`, and the backend reads neither variable — `HUGGING_FACE_HUB_TOKEN` belongs to the OPEA tier, which will wire its own when it exists.

- [ ] **Step 7: Commit**

Stage only the four files above.

### Task 2: Compléter les variables requises

Le backend reçoit en lignes `envSecrets` explicites :

```yaml
envSecrets:
  - { envVar: ARANGO_USER,     secretName: arango-root-secret, secretKey: username }
  - { envVar: ARANGO_PASSWORD, secretName: arango-root-secret, secretKey: password }
  - { envVar: TRANSLATION_CACHE_PASSWORD, secretName: translation-cache-password, secretKey: TRANSLATION_CACHE_PASSWORD }
  - { envVar: KEYCLOAK_PROXY_CLIENT_SECRET, secretName: keycloak-proxy-client-secret, secretKey: KEYCLOAK_PROXY_CLIENT_SECRET }
```

C'est là que se tranche la contradiction `username`/`ARANGO_USER` : ce ne sont pas deux contrats en conflit, ce sont **deux vocabulaires distincts qu'une ligne réconcilie**. `envVar` est le contrat du consommateur, `secretKey` celui du fournisseur, `secretName` la jointure. `envFrom` n'a pas de primitive de renommage — c'est tout le motif de la surface.

`ARANGO_DB`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID` sont des valeurs de déploiement, pas des secrets : aller dans `env`, pas `envSecrets`.

Corriger au passage le `env` **remplacé** au lieu d'être concaténé dans `documentRepository.yaml:30` (`$existing` est calculé puis jamais appendu). Faire le même correctif partout plutôt que seulement là.

`KC_REALM: genie` / `KC_CLIENT_ID: dataprep-service-client` du doc-repo sont **corrects** — vérifié, `dataprep-service-client` est bien un client du realm (`files/genie-realm.yaml:149`). Ne pas y toucher.

### Task 3: `securityContext` par image, suppression du `uid` blanket

`_service-factory.tpl` ne doit plus defaulted `runAsUser`. Chaque image garde son utilisateur ; les services qui en ont besoin déclarent `services.<svc>.podSecurityContext` (niveau pod) contre le `securityContext` conteneur existant.

| Service | `USER` image | Décision |
|---|---|---|
| backend | `node` (1000) | garder, `fsGroup: 1000` |
| documentRepository | aucun → root | `runAsUser: 1000` explicite |
| frontend | aucun → root | `runAsUser: 101` explicite |
| nginx | aucun → root | `runAsUser: 101` explicite |
| clamav | 100 | déjà correct (`clamav.yaml:20-26`) |
| redis | 999 | déjà correct (`redis-cache.yaml:20-26`) |

**Vérifier 101 avant de l'écrire** : `docker run --rm --entrypoint sh <image> -c 'id nginx'` sur les deux images nginx. Le commenter dans `values.yaml` avec la commande, pour qu'un uid différent dans une base-derived soit détecté.

`fsGroup` est **obligatoire** dès qu'un volume masque un répertoire pré-chowné par l'image : kubelet crée la racine du volume en `root:root 0755`, donc uid 1000 ne peut pas y écrire. Précedent déjà dans le chart : `redis-cache.yaml:24`, `clamav.yaml:24`.

### Task 4: Chemins inscriptibles

- backend : `/app/data` (emptyDir), `/app/Uploads` (PVC), `/app/database_backups` (PVC) — les trois montés par Compose (`docker-compose.yaml:518-520`) et absents du chart. Tous avec `fsGroup: 1000`.
- `/app/logs`, `/app/geo-data`, le cache Xenova : **aucun montage**, l'image les chown déjà (`Dockerfile:92-93`).
- doc-repo `/app/uploads` : PVC existante + `fsGroup: 1000`.

**Le cas nginx/frontend.** Les deux images écrivent dans leur propre système de fichiers au démarrage. Un `emptyDir` sur `/etc/nginx` perd `mime.types` ; sur `/app/dist` ça cache le SPA ; run-as-root est refusé par PSA. Mécanisme retenu : **`emptyDir` amorcé par un initContainer**.

Deux corrections [corrigé] sur le mécanisme, les deuxpies-Trap :

1. **L'initContainer doit surcharger `command`** pour ne pas déclencher l'ENTRYPOINT de l'image — sinon il lance nginx au lieu de copier. C'est le piège principal de cette approche.
2. **`cp -R` et non `cp -Rp`** : `-p` tente de préserver l'ownership, ce qu'un copieur non-root ne peut pas faire et qui échoue bruyamment. Le résultat doit être possédé par l'uid de l'initContainer.

Ordre de montage : l'initContainer amorce l'`emptyDir`, puis le `subPath` de ConfigMap se superpose par-dessus (kubelet crée les répertoires parents), puis le conteneur principal écrit dans le volume.

Deux clés orthogonales et purement mécaniques dans `values.yaml` :

```yaml
stageWritablePaths: ["/etc/nginx"]   # emptyDir + initContainer qui amorce depuis l'image
scratchPaths:       ["/var/run", "/var/cache/nginx"]   # emptyDir nu
```

**Coût assumé, pas une inevitabilité** [corrigé] : la review a raison de noter que reconstruire l'image nginx pour écrire dans `/tmp` supprimerait toute la mise en scène. Le plan choisit l'amorçage **parce que cela découple le chart de l'image `:main` déjà publiée, pour un cycle de build**. C'est un arbitrage de coût, à reconsidérer quand le tier AI/ML imposera de rebâtir les images de toute façon. Ne pas le présenter comme la seule voie.

### Task 5: Job `db-migrations`

Nouveau `templates/migrate/db-migrations-job.yaml`, hook `post-install,post-upgrade`, `hook-weight: "0"`, image **`genie-ai-db-migrations`** — qui existe bien (construite en CI, `.gitlab-ci.yml:984`, et utilisée par compose `docker-compose.yaml:475`).

**Réutiliser la conception déjà spécifiée** dans `2026-10-08-genie-ai-helm-charts-per-env-ingress.md:846` (Task 5) au lieu d'en inventer une — y compris sa rationale : pre-install est impossible car le DNS de la base n'existe pas sur une fresh install.

### Task 6: Hygiène de la factory

Préfixe `global.imageRegistry` conditionnel pour `clamav.yaml:42` et `redis-cache.yaml:54`, les deux seuls templates qui l'ignorent. Garde anti-doublon de nom d'env : `fail()` si une ligne template et une ligne `envSecrets` définissent le même nom — transforme « le dernier gagne » en erreur de render. Faire consommer `services.<svc>.pvc` par la factory, aujourd'hui déclaré mais jamais lu.

### Task 7: nginx `/auth/` + frontend same-origin

`components/gov-chat-frontend/src/config/oidcConfig.js:17-21` retombe sur `${origin}/auth` quand `VUE_APP_KEYCLOAK_URL` est vide — ce qui est le cas. La SPA n'a donc aujourd'hui **aucun** chemin vers Keycloak.

Ajouter `location /auth/` proxyant vers `keycloak-service:8080`, plus la règle egress nginx correspondante (elle n'existe pas : l'egress de `nginx.yaml:49-89` couvre DNS, frontend, backend, doc-repo, OTLP — pas 8080). `VUE_APP_API_URL=/api` comme Compose.

Une fois `/auth/` en place, `VUE_APP_KEYCLOAK_URL` peut rester non défini — OIDC same-origin, la bonne topologie de production.

**Ne pas** modifier `location /api/` → `location /api` : la forme actuelle matche déjà `/api/users` correctement [corrigé]. Le vrai défaut est la valeur de `VUE_APP_API_URL`, pas le nginx.

Noter aussi que `cspConnectSrc` par défaut **ne contient pas** l'origine locale — si l'implémenteur oublie le proxy `/auth/`, le symptôme sera un blocage CSP, visible seulement dans les devtools du navigateur.

### Task 8: Défauts mineurs

`cnpg-keycloak-db.yaml:56` lit `keycloak-db-credentials` en dur alors que `keycloak-instance.yaml:37-42` lit `.Values.data.keycloak.db.secretName` — changer la valeur désynchronise silencieusement le bootstrap CNPG de l'auth Keycloak.

`pre-upgrade-clusterprofile-detect.yaml` : le conteneur a `readOnlyRootFilesystem: true` (ligne 71) et son seul `emptyDir` est monté sur `/tools` (ligne 44), mais la ligne 155 redirige stderr vers `/tmp/event.err`. `/tmp` est sur le rootfs read-only → la redirection échoue, `kubectl create` n'est jamais atteint, et `|| echo WARN` avale le tout. Le canal Event de drift est mort.

### Task 9: Issuer Keycloak

Le champ est **`spec.hostname.hostname`** et il prend une **URL complète incluant le chemin de contexte `/auth`** [confirmé contre `docs/guides/server/hostname.adoc@26.8.0` : « your reverse proxy might expose Keycloak at a different context path. It is possible to configure Keycloak to reflect that **via the `hostname` option** », exemple `--hostname https://my.keycloak.org:123/auth`, et détail « a hostname / a port / **a path (e.g. /auth)** »].

Il n'existe **pas** de `spec.hostname.url` : le CRD `keycloak-k8s-resources@26.8.0` n'expose que `admin, adminUrl, backchannelDynamic, hostname, strict, strictBackchannel`, sans `x-kubernetes-preserve-unknown-fields` — un `url:` serait **pruned silencieusement**, `helm template` paraîtrait correct et l'issuer resterait instable.

`spec.hostname.backchannelDynamic` est bien un champ CR (boolean, vérifié sur le CRD). C'est lui qui fait tenir les deux phases : le frontchannel (issuer) reste figé sur `hostname`, tandis que le backchannel (JWKS, token, userinfo) se résout depuis la requête — donc le backend récupère un `jwks_uri` in-cluster en Phase 1 et public en Phase 2, sans changer de configuration. `keycloak-auth-service.js:118-145` suit bien `doc.jwks_uri` pour récupérer les clés.

```yaml
ingress:
  scheme: https        # knob pour qu'un port-forward laptop produise un issuer utilisable
  host: genieai.local  # alimente le hostname ET KC_PUBLIC_ORIGIN — ils doivent concorder
data.keycloak.hostname.url: ""   # défaut: printf "%s://%s/auth" ingress.scheme ingress.host
```

**[corrigé] `KC_PUBLIC_ORIGIN` doit aussi passer par `ingress.scheme`.** Aujourd'hui `keycloak-convergence-job.yaml:184` est en `printf "https://%s"`, sans le scheme. Avec `ingress.scheme=http` pour le port-forward, le realm produirait `https://localhost:8443/*` alors que le navigateur redirige vers `http://localhost:8443/callback` → `Invalid parameter: redirect_uri`. **C'est le finding critique de la review.**

`KC_PUBLIC_ORIGIN` reste **sans** `/auth` : il alimente `redirectUris`/`webOrigins`, qui sont des URLs de SPA.

`strict` doit être **dérivé**, pas configuré : `true` quand un hostname est présent, `false` sinon — cette dernière étant la seule valeur que Keycloak accepte sans hostname. Upstream : « if hostname is configured, then hostname-strict is ignored ».

**Port-forward : la correspondance d'origine n'est pas une exigence de la librairie** [corrigé]. `oidc-client-ts` valide l'issuer contre son réglage `authority`, pas contre `window.location.origin`. Choisir une origine identique reste la bonne topologie (source unique pour les `redirectUris` du realm), mais ce n'est pas ce qui la rend fonctionnelle. En revanche `kubectl port-forward` ne termine pas TLS : le Phase 1 tourne en `http://localhost:8443`, donc aucun cookie `Secure`, aucun comportement `SameSite=None` — la parité de production est hors de portée en Phase 1, et il ne faut pas le promettre.

### Task 10: Le contrat des Secrets

Rien dans le dépôt ne crée les Secrets requis, donc le job CI `chart:install` ne peut pas passer aujourd'hui. La liste complète : **`arango-root-secret`, `arango-jwt-secret`, `translation-cache-password`, `keycloak-admin-credentials`, `keycloak-db-credentials`**. Noter que `keycloak-admin-credentials` (bootstrap admin, `username`/`password`) est distinct de `keycloak-proxy-client-secret` (secret client OIDC du compte de service proxy).

Nouveau `scripts/genieai-dev-secrets.sh` (bootstrap laptop/CI, valeurs jetables explicites) + `docs/charts/required-secrets.md`. Étendre `test-namespace.yaml` pour que `helm test` couvre **chaque** Secret référencé.

### Task 11: Gate bout-en-bout

Nouveau job `chart:contract` dans `.gitlab-ci.yml` (stage `test`, même déclencheur que `chart:lint`), **sans cluster**, sur le rendu déjà produit par `chart:lint` :

- aucun `envFrom` résiduel dans le rendu ;
- le backend porte les 7 variables de `index.js:969-982` ;
- pas de `runAsUser: 65534` générique ;
- l'initContainer d'amorçage est présent et surcharge bien `command` ;
- le Job de migrations existe avec son hook `post-install` ;
- `spec.hostname.url` n'est **jamais** rendu (garde anti-régression sur le champ pruné — ni linter, ni `helm lint`, ni `apply --dry-run` ne l'attraperont jamais) ;
- `spec.hostname.hostname` et `KC_PUBLIC_ORIGIN` dérivent du **même** couple `ingress.scheme` + `ingress.host`.

Puis le gate cluster sur minikube : `install-prereqs.sh` + `genieai-dev-secrets.sh` + `helm install --wait` + `helm test`, avec le runbook port-forward dans `charts/README.md`.

**L'assertion issuer doit être en trois points, pas un seul** [corrigé] — vérifier que la chaîne est.String est posée ne prouve pas que le `iss` d'un JWT réel concorde avec ce que le backend valide, ce qui est précisément la classe de panne qui a déjà frappé ce projet. Comparer :

1. l'`issuer` du discovery fetché via l'URL in-cluster ;
2. l'`issuer` du discovery fetché via l'URL atteignable par le navigateur ;
3. l'issuer attendu, dérivé de `ingress.scheme` + `ingress.host` + `/auth`.

Les trois doivent être la même chaîne.

---

## Phase 2 — ingress Gateway API (plan séparé, après merge Phase 1)

> **Amendé 2026-10-14** (débat edge) : la Phase 2 originale routait `Gateway → nginx → services`, nginx restant l'agrégateur. Décision amendée : **envoy-gateway est l'edge unique et nginx est retiré du chart** après un test de parité. Le port-forward dev cible le Service Envoy, plus le Service nginx. Motifs : nginx n'était pas un SPOF (il scale), mais un **tier redondant** — chaque path mappé à deux endroits (ConfigMap nginx + HTTPRoutes à venir), un hop de plus, un objet de plus à opérer. Envoy Gateway couvre routing (`HTTPRoute`), réécriture (`URLRewrite`), rate limiting (`BackendTrafficPolicy` — parité Kong), et le `/auth/` devient une HTTPRoute vers `keycloak-service:8080` au lieu d'un bloc `location` nginx.

Séquencement (chaque étape gate la suivante):

- **P2.0 — prérequis envoy-gateway.** Ajout à `scripts/install-prereqs.sh`. Vérification en live que le contrôleur regarde les `Gateway` de tous les namespaces (leçon kube-arangodb du 2026-10-14 : « cluster-scoped by default » se vérifie, ne se suppose pas). Sur minikube, l'EXTERNAL-IP `<pending>` du Service Envoy est attendu (LoadBalancer sans metallb) — le port-forward s'en fiche.
- **P2.1 — Gateway + HTTPRoutes.** `templates/ingress/` : `Gateway` (gatewayClassName en valeur) + `Certificate` cert-manager, et **quatre** `HTTPRoute`s (plus la route unique `/` → nginx du plan d'origine):
  - `/api/`, `/api-docs/` → `backend:80`
  - `/uploads/` → `document-repository:80`
  - `/auth/` → `keycloak-service:8080` (zéro rewrite — Keycloak tourne déjà sous contexte `/auth`; remplace le bloc nginx de P1.7)
  - `/` → `frontend:80` (le nginx embarqué du frontend sert la SPA et son `try_files`; il reste — il **sert**, il ne route pas)
- **P2.2 — rate limiting à la coupe.** `BackendTrafficPolicy` rate-limit sur la route `/auth/` — local d'abord (quelques lignes), global via Redis ensuite. **Condition non négociable**: sans elle, la route `/auth` publique offre un oracle brute-force sur le token endpoint; elle vit dans la même MR que le basculement, pas dans un ticket.
- **P2.3 — parité puis suppression.** Les deux edges montés côte à côte (nginx encore déployé), diff des réponses sur les quatre paths (`/healthz`, `/`, `/api/health`, `/auth/…/openid-configuration`), port-forward sur l'un puis l'autre. Parité verte → suppression du Deployment nginx et du ConfigMap `nginx-override` du chart. La démo port-forward passe définitivement sur le Service Envoy — l'argument « dev sans contrôleur » est absorbé par le prérequis P2.0.
- **P2.4 — NetworkPolicy.** Resserrer les `podSelector: {}` et `ipBlock: 0.0.0.0/0` en placeholders (**le trou NetworkPolicy que la Phase 1 assume explicitement**), le job kind+Calico — les labels des pods Envoy sont enfin connus ici.
- **P2.5 — hygiène.** Overlays par env; rebuilder les images nginx (edge supprimé, reste le frontend) pour écrire dans `/tmp` — ce qui rend `readOnlyRootFilesystem: true` gratuit et permet de retirer l'amorçage.

P1.7 devient partiellement obsolète: le proxy `/auth/` n'est plus un bloc nginx mais une HTTPRoute (P2.1). Si le login doit être testé **avant** que la Phase 2 atterrisse, le bloc nginx `/auth/` reste le stopgap documenté; sinon, sauter directement à P2.0-P2.2.

---

## Vérification

**Sans cluster**, à chaque task : `helm lint --strict`, le job `chart:contract` de P1.11, et le diff byte-identique du Job de convergence pour P1.1.

**Conteneur**, une fois, avant P1.3 : `docker run --rm --entrypoint id` sur les quatre images pour établir les uid réels — trois affirmations du plan deviennent des faits vérifiés pour le prix d'une commande.

**Cluster** : le gate P1.11 sur minikube. Puis les `curl` du runbook port-forward (`/healthz`, `/`, `/api/health`, `/auth/…/openid-configuration`) et un login navigateur.

## Fichiers critiques

- `charts/genieai-umbrella/templates/_lib/_service-factory.tpl` — le point de goulot ; P1.1, P1.3, P1.4, P1.6
- `charts/genieai-umbrella/values.yaml` — P1.1 à P1.10
- `charts/genieai-umbrella/templates/data/keycloak-instance.yaml` — P1.9
- `charts/genieai-umbrella/templates/services/backend.yaml` — P1.2
- `charts/genieai-umbrella/templates/services/nginx-configmap.yaml` — P1.7
- Nouveau : `templates/_lib/_secrets.tpl`, `templates/migrate/db-migrations-job.yaml`, `scripts/genieai-dev-secrets.sh`

---

## Claims de la review écartés après vérification

Consignés pour ne pas être réintroduits par une prochaine passe :

- **« `hostname` ne doit pas inclure `/auth` »** — faux. `docs/guides/server/hostname.adoc@26.8.0` montre explicitement `--hostname https://my.keycloak.org:123/auth` pour un reverse proxy qui expose un contexte.
- **« `backchannelDynamic` n'est pas un champ CR, il faut `additionalOptions` »** — faux. Le CRD `keycloaks.k8s.keycloak.org-v1.yml@26.8.0` expose `spec.hostname.backchannelDynamic` (boolean).
- **« l'image `genie-ai-db-migrations` n'existe pas »** — faux. `.gitlab-ci.yml:984` la construit, `docker-compose.yaml:475` l'utilise.
- **« `KC_CLIENT_ID: dataprep-service-client` ne matche pas le realm »** — faux. `files/genie-realm.yaml:149` définit ce clientId.