# UNICC-ITU Genie AI Code Management Process

## Overview

This document outlines the **code management process** for the UNICC-ITU Genie AI repository (`https://os.unicc.biz/un/itu/genie-ai`), which hosts the GENIE-AI framework for Retrieval-Augmented Generation (RAG) based chatbots. It defines how developers, including UNICC ITU team members and third-party collaborators (e.g., NOOR-AI-AL-TAFSIR), interact with the repository to ensure code quality, repository integrity, and efficient collaboration. The process is based on the GitLab collaboration guidelines for UNICC ITU and NOOR-AI-AL-TAFSIR, extended to cover all developers and future third parties.

## Objectives

- **Code Quality**: Maintain high standards through reviews, testing, and documentation.
- **Collaboration**: Enable seamless contributions from UNICC ITU and third-party developers.
- **Repository Integrity**: Protect the `main` branch and ensure stable releases.
- **Scalability**: Support multiple third-party projects and new components (e.g., `/components/document-repository`).
- **Upgradability**: Accommodate updates to third-party dependencies like OPEA (`https://opea.dev/`).

## Repository Structure

The repository is organized to support modularity, shared libraries, and third-party contributions, as outlined in the restructuring plan (`/docs/restructuring-plan.md`).

```plaintext
/unicc-itu-genie-ai
├── api-gateway-solution/        # API gateway configs (nginx, Kong, Keycloak)
├── components/                  # Core applications
│   ├── gov-chat-backend/       # Node.js backend
│   ├── gov-chat-frontend/      # Vue 3 frontend
│   ├── document-repository/    # Document repository service
│   ├── shared/                 # Shared libraries
├── configs/                    # Configurations
│   ├── opea-config/            # OPEA and vLLM configs
├── docs/                       # Documentation
├── microservices/              # Custom OPEA extensions
├── opea/                       # OPEA source or submodule
├── tests/                      # End-to-end and integration tests
├── .gitignore
├── docker-compose.yaml
├── README.md
├── package.json                # Optional monorepo management
```

## Roles and Responsibilities

### UNICC ITU Team
- Owns and maintains the `main` branch.
- Reviews merge requests from third-party branches.
- Manages repository structure, CI/CD pipelines, and documentation.
- Communicates significant changes to third parties.
- Resolves conflicts and provides architectural guidance.

### Third-Party Developers (e.g., NOOR-AI-AL-TAFSIR)
- Work on dedicated branches (e.g., `noor-al-tafsir`).
- Contribute features, bug fixes, or improvements.
- Follow code quality standards and testing requirements.
- Selectively incorporate `main` branch changes via cherry-picking.
- Submit merge requests for review by UNICC ITU.

## Code Management Process

### Repository Access
- **UNICC ITU**: Full access to `main` and all branches.
- **Third Parties**: Access to their dedicated branch (e.g., `noor-al-tafsir`) and read access to `main`.
- **Setup**:
  - UNICC ITU grants permissions via GitLab (`https://os.unicc.biz/un/itu/genie-ai/-/project_members`).
  - Developers clone the repository:
    ```bash
    git clone https://os.unicc.biz/un/itu/genie-ai
    ```
  - Third parties checkout their branch:
    ```bash
    git checkout noor-al-tafsir
    ```

### Branching Strategy
- **Main Branch**: Stable, production-ready code, maintained by UNICC ITU.
- **Third-Party Branches**: Dedicated branches (e.g., `noor-al-tafsir`) for external contributions.
- **Feature Branches**: Created off `main` or third-party branches for specific tasks (e.g., `feature/add-document-api`).
- **Naming Conventions**:
  - Feature: `feature/<description>` (e.g., `feature/add-document-api`)
  - Bug Fix: `bugfix/<description>` (e.g., `bugfix/fix-backend-auth`)
  - Third-Party Prefix: `<party>/<description>` (e.g., `noor-al-tafsir/add-search`).

### Development Workflow

#### 1. Starting a New Task
- **UNICC ITU**:
  - Create a feature branch from `main`:
    ```bash
    git checkout main
    git pull origin main
    git checkout -b feature/<description>
    ```
- **Third Parties**:
  - Create a feature branch from their dedicated branch:
    ```bash
    git checkout noor-al-tafsir
    git pull origin noor-al-tafsir
    git checkout -b noor-al-tafsir/<description>
    ```
- Create a GitLab issue to track the task, using labels (e.g., `Feature`, `Bug`, `NOOR-AL-TAFSIR`).

#### 2. Staying Updated with Main Branch
- **Third Parties**:
  - Regularly monitor `main` for relevant changes:
    ```bash
    git fetch origin
    git log noor-al-tafsir..origin/main --oneline
    ```
  - Cherry-pick necessary commits:
    ```bash
    git checkout noor-al-tafsir
    git cherry-pick <commit-hash>
    ```
  - Resolve conflicts if they arise:
    ```bash
    git add <resolved-files>
    git cherry-pick --continue
    ```
  - Push updates:
    ```bash
    git push origin noor-al-tafsir
    ```
- **UNICC ITU**: Merge third-party changes into `main` via merge requests, ensuring no direct merges from `main` to third-party branches.

#### 3. Developing Features
- Write code in the feature branch, following:
  - **Coding Standards**: Adhere to project style guides (e.g., ESLint for JavaScript, Prettier for formatting).
  - **Modularity**: Use `/shared` for reusable code (e.g., `/shared/lib/database.js`).
  - **Documentation**: Update `/docs/api-docs.md` for new APIs.
- Create logical commits:
  ```bash
  git add <files>
  git commit -m "Add document ingestion API to /components/document-repository"
  ```
- Reference GitLab issues in commit messages (e.g., `Fixes #123`).
- Push regularly:
  ```bash
  git push origin feature/<description>
  ```

#### 4. Testing
- Write unit tests for new functionality (e.g., Jest for `/components/gov-chat-backend`).
- Run tests locally:
  ```bash
  npm test  # Inside component directory
  ```
- Add integration tests to `/tests` for cross-component interactions.
- Verify builds:
  ```bash
  docker-compose up
  ```
- Ensure all tests pass before submitting a merge request.

#### 5. Submitting for Review
- Ensure code meets standards (linting, tests, documentation).
- Create a merge request:
  - UNICC ITU: From `feature/<description>` to `main`.
  - Third Parties: From `<party>/<description>` to `main` or their branch (e.g., `noor-al-tafsir`).
  - Use GitLab’s merge request template, including:
    - Description of changes.
    - Related issue numbers.
    - Testing performed.
- Push to GitLab:
  ```bash
  git push origin feature/<description>
  ```

### Code Review Process
- **UNICC ITU**:
  - Review merge requests promptly (within 2-3 business days).
  - Check for:
    - Code quality (readability, standards).
    - Functionality (meets requirements).
    - Tests (coverage, reliability).
    - Documentation (updated APIs, guides).
  - Provide clear feedback via GitLab comments.
  - Approve or request changes.
- **Third Parties**:
  - Address feedback by pushing additional commits.
  - Re-request review after updates.
- Merge approved changes to `main` via GitLab’s “Merge” button.

### Conflict Resolution
- **Merge Conflicts**:
  - Third parties attempt resolution first:
    ```bash
    git fetch origin
    git rebase origin/main
    # Resolve conflicts in editor
    git add <resolved-files>
    git rebase --continue
    ```
  - For complex conflicts, schedule a joint debugging session with UNICC ITU.
- **Architectural Disagreements**:
  - Escalate to technical leads from both teams.
  - Document decisions in GitLab issues or `/docs/decisions.md`.

### Release Management
- **Main Branch**: Represents stable releases.
- **Tagging**: UNICC ITU tags releases (e.g., `v1.0.0`) after major updates:
  ```bash
  git tag v1.0.0
  git push origin v1.0.0
  ```
- **Third Parties**: Pull tagged releases to their branches if needed.

## Third-Party Project Management

### Onboarding New Third Parties
- **Setup**:
  - UNICC ITU creates a dedicated branch (e.g., `third-party-name`):
    ```bash
    git checkout main
    git checkout -b third-party-name
    git push origin third-party-name
    ```
  - Grant access via GitLab project members.
- **Documentation**:
  - Provide `/docs/setup-guide.md` and this document.
  - Share contact information for key UNICC ITU team members.

### Workflow for Third Parties
- Follow the same development workflow as NOOR-AI-AL-TAFSIR (see above).
- Use a dedicated branch for all work.
- Cherry-pick changes from `main` instead of merging.
- Submit merge requests to `main` for integration.

### Communication
- **Sync Meetings**: Bi-weekly meetings to review progress, discuss integration, and address challenges.
- **GitLab Issues**:
  - Track tasks with labels (e.g., `NOOR-AL-TAFSIR`, `Third-Party`).
  - Cross-reference dependencies between teams.
- **Documentation**:
  - UNICC ITU documents `main` branch changes affecting third parties in `/docs/api-docs.md` or `/docs/changelog.md`.
  - Third parties document their contributions in merge requests.

## Best Practices

### Commit Guidelines
- Write clear, descriptive messages:
  ```bash
  git commit -m "Add document chunking to /components/document-repository (#123)"
  ```
- Keep commits focused on single issues.
- Reference GitLab issues.

### Branch Management
- Avoid force pushes to shared branches (e.g., `noor-al-tafsir`):
  ```bash
  git push origin noor-al-tafsir --force  # Avoid this
  ```
- Create feature branches for complex changes.
- Clean up merged branches:
  ```bash
  git push origin --delete feature/<description>
  ```

### Testing
- Run tests before merge requests:
  ```bash
  npm test
  ```
- Add tests for new functionality in `/components` or `/tests`.
- Validate cherry-picked changes don’t break existing code.

### OPEA Integration
- Monitor OPEA releases (`https://github.com/opea-project`).
- Test updates in a feature branch:
  ```bash
  git checkout -b feature/opea-upgrade
  ```
- Update `/configs/opea-config` and `/microservices` as needed.
- Document changes in `/docs/opea-integration.md`.

## Tools and Resources
- **GitLab Repository**: `https://os.unicc.biz/un/itu/genie-ai`
- **Issue Tracker**: `https://os.unicc.biz/un/itu/genie-ai/-/issues`
- **NOOR-AI-AL-TAFSIR Issues**: `https://gitlab.com/noor-al-tafsir/noor-al-tafsir/-/issues`
- **Documentation**: `/docs` (e.g., `restructuring-plan.md`, `api-docs.md`)
- **Contact**: [TBD, to be provided by UNICC ITU]

## Review and Updates
- This process is reviewed quarterly or as needed.
- Proposed changes are discussed in sync meetings and documented in GitLab issues.
- Updates are published in `/docs/code-management-process.md`.

## Conclusion
This code management process ensures efficient collaboration, high code quality, and repository integrity for the GENIE-AI framework. Developers must follow the defined workflow, and third parties must align with the cherry-picking and merge request process. For questions, contact UNICC ITU via GitLab issues or sync meetings.