# Guide Tests d'Intégration — Implémentation Future

**Date** : 2026-04-03
**Statut** : REPORTÉ — En attente d'infrastructure Docker
**Priorité** : Recommandé pour Epic 2 ou 3

---

## Prérequis Infrastructure

Pour exécuter les tests d'intégration, vous aurez besoin de :

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

---

## Tests à Implémenter

### Test 1 : Intégration Auth Complète avec ArangoDB

**Fichier** : `components/gov-chat-backend/__tests__/integration/auth-full-integration.test.js`

```javascript
'use strict';

const request = require('supertest');
const express = require('express');
const { aql } = require('arangojs');

describe('Authentication Full Integration with ArangoDB', () => {
  let app;
  let arangoDB;

  beforeAll(async () => {
    // Setup ArangoDB connection
    arangoDB = require('arangojs')({
      url: process.env.ARANGO_URL || 'http://localhost:8529',
      database: '_system',
      auth: { username: 'root', password: 'test_password' }
    });

    // Créer la DB de test
    try {
      await arangoDB.createDatabase('genie_test');
    } catch (e) {
      // DB existe peut-être déjà
    }

    const db = arangoDB.database('genie_test');
    
    // Créer la collection users
    try {
      await db.collection('users').create();
    } catch (e) {
      // Collection existe peut-être déjà
    }

    // Setup l'app Express avec VRAIS services (pas de mocks)
    app = express();
    app.use(express.json());

    const keycloakAuthMiddleware = require('../middleware/keycloak-auth-middleware').keycloakAuthMiddleware;
    app.use(keycloakAuthMiddleware.authenticate);
    app.get('/protected', (req, res) => res.json({ 
      user: req.user,
      iss_sub: req.user?.iss_sub,
      email: req.user?.email 
    }));
  });

  afterAll(async () => {
    // Nettoyer
    const db = arangoDB.database('genie_test');
    await db.drop();
  });

  it('should provision new user in ArangoDB on first login', async () => {
    // Générer un VRAI JWT token (pas un mock)
    const token = generateRealTestJWT({
      sub: 'new-user-123',
      iss: 'http://localhost:8080/realms/genie',
      email: 'new@example.com'
    });

    const response = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.user.iss_sub).toBe('http://localhost:8080/realms/genie#new-user-123');

    // Vérifier DANS ArangoDB
    const db = arangoDB.database('genie_test');
    const cursor = await db.query(aql`
      FOR u IN users
        FILTER u.iss_sub == 'http://localhost:8080/realms/genie#new-user-123'
        RETURN u
    `);
    const user = await cursor.next();
    
    expect(user).toBeDefined();
    expect(user.email).toBe('new@example.com');
    expect(user.active).toBe(true);
    expect(user.deleted).toBe(false);
  });

  it('should update existing user in ArangoDB on subsequent login', async () => {
    // Premier login
    const token1 = generateRealTestJWT({
      sub: 'existing-user-123',
      iss: 'http://localhost:8080/realms/genie',
      email: 'old@example.com'
    });

    await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token1}`);

    // Mise à jour dans ArangoDB
    const db = arangoDB.database('genie_test');
    await db.query(aql`
      UPDATE u IN users
        FILTER u.iss_sub == 'http://localhost:8080/realms/genie#existing-user-123'
        UPDATE { email: 'updated@example.com' }
    `);

    // Deuxième login avec email mis à jour
    const token2 = generateRealTestJWT({
      sub: 'existing-user-123',
      iss: 'http://localhost:8080/realms/genie',
      email: 'updated@example.com'
    });

    const response = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token2}`);

    expect(response.status).toBe(200);
    // Vérifier que l'email a été mis à jour
    const cursor = await db.query(aql`
      FOR u IN users
        FILTER u.iss_sub == 'http://localhost:8080/realms/genie#existing-user-123'
        RETURN u.email
    `);
    const email = await cursor.next();
    
    expect(email).toBe('updated@example.com');
  });

  it('should block soft-deleted user', async () => {
    // Créer utilisateur et le marquer soft-deleted
    const db = arangoDB.database('genie_test');
    await db.query(aql`
      INSERT {
        iss_sub: 'http://localhost:8080/realms/genie#deleted-user-123',
        email: 'deleted@example.com',
        active: false,
        deleted: true
      } IN users
    `);

    const token = generateRealTestJWT({
      sub: 'deleted-user-123',
      iss: 'http://localhost:8080/realms/genie',
      email: 'deleted@example.com'
    });

    const response = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('FORBIDDEN');
  });
});

// Helper pour générer des JWT tokens de test réels
function generateRealTestJWT(payload) {
  const { SignJWT } = require('jose');
  const privateKey = getTestPrivateKey(); // À implémenter
  
  return new SignJWT({
    ...payload,
    aud: 'genie-app',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000)
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .sign(privateKey);
}
```

---

## Script d'Exécution

**package.json** (ajouter) :
```json
{
  "scripts": {
    "test:integration": "docker-compose -f docker-compose.test.yml up -d && sleep 15 && jest --testPathPattern=integration && docker-compose -f docker-compose.test.yml down -v",
    "test:integration:watch": "docker-compose -f docker-compose.test.yml up -d && sleep 15 && jest --testPathPattern=integration --watch && docker-compose -f docker-compose.test.yml down -v"
  }
}
```

---

## Alternatives Sans Docker

Si Docker n'est pas disponible, ces tests d'intégration peuvent être reportés à :

1. **Environnement de pré-production** : Utiliser l'instance de pré-production pour exécuter ces tests manuellement
2. **CI/CD avec services conteneurisés** : Si votre CI utilise déjà des conteneurs, y ajouter ces tests
3. **Tests manuels ad-hoc** : Exécuter ces scénarios manuellement lors des recettes

---

## Avantages de ces Tests

| Avantage | Description |
|----------|-------------|
| **Confiance** | Teste l'intégration RÉELLE avec ArangoDB |
| **Bugs cachés** | Découvre les problèmes de mapping objet/DB |
| **Validation** | Confirme que le provisioning fonctionne en production |
| **Régression** | Empêche les changements de casser l'intégration |

---

## Priorité

**Recommandé pour** :
- Valider les changements majeurs du provisioning
- Tester les mises à jour de schéma ArangoDB
- Valider les migrations de données

**Pas critique pour** :
- Développement quotidien (tests unitaires suffisants)
- Corrections de bugs mineurs

---

## Conclusion

Les tests d'intégration sont **REPORTÉS** en attente d'infrastructure Docker appropriée. 

Les corrections critiques de Phase 1 sont **COMPLÈTES** et suffisent pour commencer Epic 2 avec confiance.

**Quand l'infrastructure sera disponible**, ce guide permettra d'implémenter rapidement les tests d'intégration.
