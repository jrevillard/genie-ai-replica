# Approches pour Tests d'Intégration — Auth Backend

**Question** : Pour les tests d'intégration, a-t-on besoin d'infrastructures externes (DB, Keycloak) ?

**Réponse** : Ça dépend du niveau d'intégration. Voici 3 approches possibles :

---

## Approche 1 : Tests d'intégration "légers" (sans infrastructure externe)

**Cible** : Intégration entre services SANS dépendances externes

**Ce qu'on teste** :
```
keycloakAuthMiddleware → keycloakAuthService → TokenVerificationError
```

**Ce qu'on mock** :
- `jose` (lib JWT) → on peut générer des vrais JWT tokens pour les tests
- ArangoDB (via dbService) → on mock la DB car on teste pas le provisioning ici

**Avantages** :
- ✅ Rapide à exécuter
- ✅ Pas de Docker nécessaire
- ✅ Tests fiables et déterministes

**Inconvénients** :
- ❌ Ne teste PAS l'intégration avec ArangoDB
- ❌ Ne teste PAS le provisioning réel

**Exemple** :
```javascript
// __tests__/integration/auth-service-integration.test.js
'use strict';

const { generateKeyPair, SignJWT } = require('jose');
const keycloakAuthService = require('../services/keycloak-auth-service');

describe('keycloakAuthService Integration (sans ArangoDB)', () => {
  let privateKey;
  let publicKey;

  beforeAll(async () => {
    // Générer une vraie paire de clés RSA pour signer des JWT
    const keyPair = await generateKeyPair('RS256');
    privateKey = keyPair.privateKey;
    publicKey = keyPair.publicKey;
  });

  it('should verify a real JWT token signed with test key', async () => {
    // Créer un VRAI JWT token (pas un mock)
    const token = await new SignJWT({
      sub: 'test-user-123',
      iss: 'http://localhost:8080/realms/genie',
      aud: 'genie-app',
      email: 'test@example.com'
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

    // Mock fetch pour OIDC discovery
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        issuer: 'http://localhost:8080/realms/genie',
        jwks_uri: 'http://localhost:8080/realms/genie/protocol/openid-connect/certs'
      })
    });

    // Mock jose.createRemoteJWKSet pour retourner notre clé publique
    jest.mock('jose', () => ({
      createRemoteJWKSet: () => async () => publicKey,
      jwtVerify: async (token, key) => {
        // Vérifier le VRAI token avec la VRAIE clé
        const { jwtVerify } = require('jose');
        return jwtVerify(token, key);
      }
    }));

    const result = await keycloakAuthService.verifyToken(token);

    expect(result.iss_sub).toBe('http://localhost:8080/realms/genie#test-user-123');
    expect(result.sub).toBe('test-user-123');
  });
});
```

**Temps d'exécution** : ~100-200ms par test

---

## Approche 2 : Tests d'intégration avec Docker Compose (infrastructure légère)

**Cible** : Intégration complète AVEC ArangoDB

**Ce qu'on teste** :
```
Request → Middleware → keycloakAuthService → userProvisioningService → ArangoDB
```

**Ce qu'on mock** :
- Keycloak (on génère des JWT tokens de test)
- `jose` (on signe avec nos clés de test)

**Infrastructure requise** :
```yaml
# docker-compose.test.yml
version: '3.8'
services:
  arangodb-test:
    image: arangodb:3.12
    environment:
      ARANGO_ROOT_PASSWORD: test_password
    ports:
      - "8529:8529"
    volumes:
      - arangodb-test-data:/var/lib/arangodb3
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8529/_api/heartbeat"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  arangodb-test-data:
```

**Setup du test** :
```javascript
// __tests__/integration/auth-full-integration.test.js
'use strict';

const request = require('supertest');
const express = require('express');
const { aql } = require('arangojs');

describe('Authentication Full Integration', () => {
  let app;
  let arangoDB;

  beforeAll(async () => {
    // Setup ArangoDB pour les tests
    arangoDB = require('arangojs')({
      url: process.env.ARANGO_URL || 'http://localhost:8529',
      database: '_system',
      auth: { username: 'root', password: 'test_password' }
    });

    // Créer la base de données de test
    await arangoDB.createDatabase('genie_test');
    const db = arangoDB.database('genie_test');

    // Créer la collection users
    await db.collection('users').create();

    // Setup l'app Express avec les VRAIS middlewares
    app = express();
    app.use(express.json());

    // Importer les VRAIS services (sans mocks)
    const keycloakAuthMiddleware = require('../middleware/keycloak-auth-middleware').keycloakAuthMiddleware;
    app.use(keycloakAuthMiddleware.authenticate);
    app.get('/protected', (req, res) => res.json({ user: req.user }));
  });

  afterAll(async () => {
    // Nettoyer la base de données de test
    const db = arangoDB.database('genie_test');
    await db.drop();
  });

  it('should provision new user in ArangoDB on first login', async () => {
    // Générer un VRAI JWT token
    const token = generateTestJWT({
      sub: 'new-user-123',
      iss: 'http://localhost:8080/realms/genie',
      email: 'new@example.com'
    });

    const response = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.user.iss_sub).toBe('http://localhost:8080/realms/genie#new-user-123');

    // Vérifier que l'utilisateur est DANS ArangoDB
    const db = arangoDB.database('genie_test');
    const cursor = await db.query(aql`
      FOR u IN users
        FILTER u.iss_sub == 'http://localhost:8080/realms/genie#new-user-123'
        RETURN u
    `);
    const user = await cursor.next();
    expect(user).toBeDefined();
    expect(user.email).toBe('new@example.com');
  });
});
```

**Ajouter à package.json** :
```json
{
  "scripts": {
    "test:integration": "docker-compose -f docker-compose.test.yml up -d && sleep 10 && jest --testPathPattern=integration && docker-compose -f docker-compose.test.yml down -v"
  }
}
```

**Avantages** :
- ✅ Teste l'intégration RÉELLE avec ArangoDB
- ✅ Découvre les problèmes de mapping objet/DB
- ✅ Tests les requêtes AQL réelles

**Inconvénients** :
- ❌ Plus lent (~2-5 secondes par test)
- ❌ Nécessite Docker
- ❌ Plus complexe à maintenir

**Temps d'exécution** : ~2-5s par test

---

## Approche 3 : Tests E2E avec Keycloak complet

**Cible** : Flow complet AVEC Keycloak

**Infrastructure** :
```yaml
services:
  keycloak-test:
    image: quay.io/keycloak/keycloak:24.0
    environment:
      KEYCLOAK_ADMIN: admin
      KEYCLOAK_ADMIN_PASSWORD: admin
      KC_HOSTNAME: localhost:8080
    ports:
      - "8080:8080"

  arangodb-test:
    # ... (voir approche 2)
```

**Avantages** :
- ✅ Teste AVEC le vrai Keycloak
- ✅ Découvre les problèmes de compatibilité OIDC

**Inconvénients** :
- ❌ Très lent (~10-30s par test)
- ❌ Très complexe
- ❌ Fragile (dépend de Keycloak version)

**Temps d'exécution** : ~10-30s par test

---

## Recommandation

### Pour Epic 1 (Correction immédiate)

**Utiliser l'Approche 1** (Tests d'intégration légers)

**Raison** :
- Rapide à implémenter
- Pas de nouvelle infrastructure nécessaire
- Tests déjà les vrais services, juste sans la DB

**Ce qu'on obtient** :
```javascript
// Au lieu de : keycloakAuthService complètement mocké
// On a : keycloakAuthService VRAI + jose mocké intelligemment

// Au lieu de : userProvisioningService complètement mocké
// On peut : tester la logique avec un fausse DB (in-memory)
```

### Pour Epic 2 (Tests plus complets)

**Ajouter l'Approche 2** (Docker Compose + ArangoDB)

**Stratégie** :
- 1 tests d'intégration par "critical path"
- Exécuter ces tests dans un pipeline séparé (nightly)

**Exemples de scénarios critiques** :
1. Provisioning nouvel utilisateur
2. Login utilisateur existant
3. Utilisateur soft-deleted bloqué
4. Mise à jour profil utilisateur

### N'utiliser l'Approche 3 que si nécessaire

Seulement pour :
- Tests de recette Keycloak
- Validation montée de version Keycloak

---

## Réponse à votre question

> "Pour les tests d'intégration, on a pas besoin de middleware externe comme une DB ou autre ?"

**Réponse** :

1. **Pour commencer** : NON, on peut utiliser l'Approche 1 (tests légers sans DB)
   - Teste l'intégration entre services
   - Mock intelligemment les dépendances externes
   - Rapide et simple

2. **Pour plus de confiance** : OUI, on peut utiliser l'Approche 2 (Docker + ArangoDB)
   - Teste avec une vraie DB
   - Découvre les problèmes de mapping
   - Plus lent mais plus complet

3. **Approche progressive** :
   ```
   Phase 1 (maintenant) : Tests légers sans DB
   Phase 2 (Epic 2)    : Ajouter quelques tests avec ArangoDB
   Phase 3 (si besoin) : Tests E2E complets
   ```

**Mon conseil** : Commencer avec l'Approche 1 pour les corrections critiques, puis évaluer si l'Approche 2 est nécessaire.
