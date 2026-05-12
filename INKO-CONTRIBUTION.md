# Inko Lesotho — GENIE.AI Contribution

## Use Case
Agricultural advisory system for extension workers in Lesotho,
built on the GENIE.AI framework for the IEEE/ITU GenAI for Good Challenge.

## Framework Adaptations (justified)

### 1. OPEA Routing Fix (docker-compose.yaml)
- Issue: Default config referenced chatqna-xeon-backend-server
- Our environment: Container named genie-ai-chatqna-server
- Fix: Updated OPEA_HOST to match actual container name
- Contribution: Documents deployment naming requirements

### 2. CORS Configuration (nginx/conf)
- Issue: Browser blocked API calls from public IP deployment
- Fix: Added server IP to CORS and CSP allowed origins
- Contribution: Required for any real public-facing deployment

### 3. ChatQnA Payload Format (query-service.js)
- Issue: Payload format mismatch between backend and ChatQnA
- Fix: Updated to use messages array format
- Contribution: Improves compatibility with ChatQnA endpoint

### 4. Response Parsing (opea-worker.js)
- Issue: Response parser expected vLLM format, got ChatQnA format
- Fix: Updated to handle {response: "..."} format
- Contribution: Better handling of ChatQnA response structure

### 5. Language Support (document-repository)
- Issue: System only accepted English documents
- Fix: Disabled language restriction to support Sesotho
- Contribution: Critical for multilingual African deployments

## Original Contributions

### Inko Frontend (inko.html)
- Custom mobile-first UI for Lesotho extension workers
- Bilingual Sesotho/English interface
- Farmer management system
- Role-based access (Admin vs Extension Worker)
- Offline-capable design for highland connectivity

### Knowledge Hierarchy
- Crop Farming → Maize Farming, Beans Farming
- Pest & Disease Management
- Weather Advisory
- Market Linkages
- Government Programs

### Knowledge Base
- Sesotho-language agricultural guides
- Lesotho-specific farming research
- FAO/Ministry of Agriculture documents

## Target Users
Primary: Agricultural extension workers
Secondary: Ministry of Agriculture administrators
Future: Smallholder farmers via USSD/SMS

## Country Context
Kingdom of Lesotho — highland smallholder farming
Focus crops: Maize (poone) and Beans (linaoa)
