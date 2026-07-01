# UNICC-ITU Genie AI Code Management Process

## Overview

This document outlines the **code management process** for the UNICC-ITU Genie AI repository (`https://opensource.unicc.org/un/itu/genie-ai/`), which hosts the GENIE-AI framework for Retrieval-Augmented Generation (RAG) based chatbots. It defines how developers, including UNICC ITU team members and third-party collaborators, interact with the repository to ensure code quality, repository integrity, and efficient collaboration.

The process supports two main collaboration models:
1. **Long-term third-party partnerships** (e.g., NOOR-AI-AL-TAFSIR) for sustained development
2. **Challenge-based contributor teams** (e.g., GENIE4Good Challenge) for time-bound innovation sprints

This document specifically details the GitLab Challenge Contributor Branch Setup for managing multiple third-party teams simultaneously using GitLab Ultimate's granular branch protection capabilities.

## Objectives

- **Code Quality**: Maintain high standards through reviews, testing, and documentation.
- **Collaboration**: Enable seamless contributions from UNICC ITU and third-party developers.
- **Repository Integrity**: Protect the `main` branch and ensure stable releases.
- **Scalability**: Support multiple third-party projects and new components (e.g., `/components/document-repository`).
- **Upgradability**: Accommodate updates to third-party dependencies like OPEA (`https://opea.dev/`).
- **Multi-Team Challenge Management**: Support simultaneous development by multiple challenge teams while maintaining isolation and security.
- **Open-Source Principles**: Ensure all teams can read each other's work while maintaining write access controls.

## Repository Structure

The repository is organized to support modularity, shared libraries, and third-party contributions, as outlined in the restructuring plan (`proposed-repo-structure-changes.md`).

```plaintext
/unicc-itu-genie-ai
├── api-gateway-solution/        # API gateway configs (nginx, Kong)
│   ├── nginx/                   # Nginx configuration (template-based, auto-rendered)
│   ├── new-config/              # Kong configuration files and scripts
│   └── scripts/                 # Kong management utilities
├── components/                  # Core applications
│   ├── gov-chat-backend/        # Node.js backend
│   │   ├── controllers/         # Request handlers
│   │   ├── middleware/          # Express middleware
│   │   ├── routes/              # API route definitions
│   │   ├── services/            # Business logic
│   │   ├── utils/               # Utility functions
│   │   ├── design/              # Design documentation
│   │   ├── scripts/             # Deployment scripts
│   │   └── uploads/             # File upload storage
│   ├── gov-chat-frontend/       # Vue 3 frontend
│   │   ├── src/                 # Vue components and source code
│   │   ├── public/              # Static assets
│   │   ├── scripts/             # Build and deployment scripts
│   │   └── dist/                # Built application files
│   ├── document-repository/     # Document repository service
│   │   ├── src/                 # Source code
│   │   ├── scripts/             # Utility scripts
│   │   └── uploads/             # Document storage
│   ├── shared/                  # Shared libraries
│   │   └── lib/                 # Common utilities
│   ├── arangodb/                # ArangoDB database configurations
│   └── google-translate-example/ # Translation service example
├── configs/                     # Configuration files
│   └── opea-config/             # OPEA and vLLM configurations
│       └── vllm/                # vLLM specific configurations
├── genie-ai-overlay/            # Custom OPEA extensions and overlays
│   ├── chatqna/                 # ChatQnA component overlays
│   ├── core/                    # Core OPEA overlays
│   ├── dataprep/                # Data preparation overlays
│   ├── retriever/               # Retriever component overlays
│   ├── reranker/                # Reranker component overlays
│   └── build-patches/           # Build modification patches
├── mobile/                      # Mobile applications
│   └── genie_ai_mobile/         # Genie AI mobile app
├── data/                        # Data storage and samples
│   ├── el-salvador/             # Country-specific data
│   ├── gambia/                  # Country-specific data
│   ├── kenya/                   # Country-specific data
│   └── lesotho/                 # Country-specific data
├── docs/                        # Documentation
├── tests/                       # End-to-end and integration tests
├── logs/                        # Application logs
├── .gitignore
├── .claude/                     # Claude Code configuration
├── CLA.md                       # Contributor License Agreement
├── CONTRIBUTING.md              # Contribution guidelines
├── STANDARDS.md                 # Coding standards and practices
├── THIRD_PARTY.md               # Third-party integration guidelines
├── site/content/en/docs/deployment/install-guide.md # Installation guide
├── site/content/en/docs/rag/data-labeling.md # Data labeling strategy
├── proposed-repo-structure-changes.md # Repository restructuring plan
├── README.md                    # Project overview
├── docker-compose.yaml          # Main Docker Compose configuration
├── docker-compose-t4.yaml       # T4 GPU variant configuration
├── docker-compose-RTX6000-ADA.yaml # RTX 6000 ADA GPU variant
├── env                          # Environment configuration (main)
├── env-T4                       # Environment configuration (T4 variant)
└── package.json                 # Node.js dependencies and scripts
```

## Roles and Responsibilities

### UNICC ITU Team (Maintainers)
- Owns and maintains the `main` branch with full push and merge permissions.
- Reviews and approves merge requests from all third-party branches.
- Manages repository structure, CI/CD pipelines, and documentation.
- Configures and maintains branch protection rules and access controls.
- Communicates significant changes to all third parties.
- Resolves conflicts and provides architectural guidance.
- Creates and manages challenge team groups and branches.

### Long-Term Third-Party Partners (e.g., NOOR-AI-AL-TAFSIR)
- Work on dedicated long-term branches (e.g., `noor-al-tafsir`).
- Contribute features, bug fixes, or improvements.
- Follow code quality standards and testing requirements.
- Selectively incorporate `main` branch changes via cherry-picking.
- Submit merge requests for review by UNICC ITU.

### GENIE4Good Challenge Teams
Challenge teams work in time-bound innovation sprints with isolated workspaces:

#### Agriculture Sector Teams
- **AgriConnect Team**: Branch `agriculture-agriconnect-branch`, Group `Agriculture-AgriConnect-group`
- **AgriPivot Team**: Branch `agriculture-agripivot-branch`, Group `Agriculture-AgriPivot-group`
- **Inko Team**: Branch `agriculture-inko-branch`, Group `Agriculture-Inko-group`

#### Climate Sector Teams
- **Barind Team**: Branch `climate-barind-branch`, Group `Climate-Barind-group`
- **PolisenseAI Team**: Branch `climate-polisenseai-branch`, Group `Climate-PolisenseAI-group`
- **CHP Team**: Branch `climate-chp-team-branch`, Group `Climate-CHP-Team-group`

#### Health Sector Teams
- **YoungAI Leaders Team**: Branch `health-youngai-leaders-branch`, Group `Health-YoungAI-Leaders-group`
- **AminaCare Team**: Branch `health-aminacare-branch`, Group `Health-AminaCare-group`
- **Innov8AI Team**: Branch `health-innov8ai-branch`, Group `Health-Innov8AI-group`

**Challenge Team Responsibilities**:
- Work exclusively on assigned team branches with write permissions
- Contribute innovative solutions within their sector focus
- Follow code quality standards and testing requirements
- Can read all code from other teams (open-source principle)
- Submit merge requests to main for review by UNICC ITU maintainers
- Create separate feature branches for framework-compatible contributions

## GENIE4Good Challenge GitLab Configuration

### Overview
The GENIE4Good Challenge utilizes GitLab Ultimate's granular branch protection to manage multiple teams simultaneously. The security model implements "Deny-by-Default" via wildcard protection, with "Allow-by-Exception" for team branches.

### Configuration Requirements
- **GitLab Tier**: Ultimate (required for individual/group branch protection)
- **Project Role**: All participants assigned Developer role only
- **Security Logic**: Wildcard protection restricts Developers from pushing anywhere except their designated team branches

### Step 1: Organizational Setup

#### Create Challenge Team Groups
Navigate to Groups > New group and create subgroups for each team:

**Agriculture Sector:**
- `Agriculture-AgriConnect-group`
- `Agriculture-AgriPivot-group`
- `Agriculture-Inko-group`

**Climate Sector:**
- `Climate-Barind-group`
- `Climate-PolisenseAI-group`
- `Climate-CHP-Team-group`

**Health Sector:**
- `Health-YoungAI-Leaders-group`
- `Health-AminaCare-group`
- `Health-Innov8AI-group`

#### Add Team Members
After UNICC completes user account creation:
1. Add respective developers to their specific Team Group
2. Invite all 9 groups to the GENIE-AI project with Developer role:
   - Navigate to Project information > Members
   - Click "Invite a group"
   - Invite all groups with Developer role

### Step 2: Establish "Deny-By-Default" Protection

#### Protect Main Branch
1. Go to Settings > Repository > Protected branches
2. Locate `main`
3. Set "Allowed to push" to **Maintainers only**
4. Set "Allowed to merge" to **Maintainers only**

#### Protect Wildcard Pattern
1. Click "Add protected branch"
2. In Branch field, type `*` and press Enter
3. Set "Allowed to push" to **Maintainers only**
4. Set "Allowed to merge" to **Maintainers only**

**Result**: Developers can read all code but cannot push to any existing or new branch.

### Step 3: Provision Team "Safe Zones"

For each of the 9 teams, create and protect their specific branch:

#### Create Team Branches
Go to Repository > Branches > New branch and create from `main`:

**Agriculture Sector:**
- `agriculture-agriconnect-branch`
- `agriculture-agripivot-branch`
- `agriculture-inko-branch`

**Climate Sector:**
- `climate-barind-branch`
- `climate-polisenseai-branch`
- `climate-chp-team-branch`

**Health Sector:**
- `health-youngai-leaders-branch`
- `health-aminacare-branch`
- `health-innov8ai-branch`

#### Apply Granular Branch Protection
For each team branch:
1. Go to Settings > Repository > Protected branches
2. Select the specific team branch
3. **Allowed to push**: Select Maintainers AND search for the corresponding team group
4. **Allowed to merge**: Select Maintainers AND search for the corresponding team group
5. Click "Protect"

### Access Control Summary

| Access Level | Main Branch | Team Branches | Other Team Branches |
|--------------|-------------|---------------|---------------------|
| **Maintainers** | Read, Write, Merge | Read, Write, Merge | Read, Write, Merge |
| **Team Developers** | Read Only | Read, Write | Read Only |

### Important Constraints

#### 📖 Open Source Principles
- All Developer role users can see all branches and all code
- Team branches are NOT hidden from other teams
- This aligns with open-source development principles

#### 🔧 Shared Infrastructure Considerations
- CI/CD pipelines may require team-specific configurations
- Challenge cloud environments should be isolated per team
- Consider environment variable scoping for team-specific deployments

#### 🔄 Merge Request Process
- Teams can create MRs from their branch to main
- Only Maintainers can approve and merge MRs
- Framework-compatible changes should be in separate feature branches
- Challenge-specific features typically remain in team branches
- Merge decisions are tightly controlled through team meetings

## Code Management Process

### Repository Access
- **UNICC ITU (Maintainers)**: Full access to `main` and all branches.
- **Long-term Third Parties**: Access to their dedicated branch (e.g., `noor-al-tafsir`) and read access to all other branches.
- **Challenge Teams**: Access to their specific team branch with write permissions, read access to all branches.
- **Setup**:
  - UNICC ITU grants permissions via GitLab (`https://opensource.unicc.org/un/itu/genie-ai//-/project_members`).
  - Developers clone the repository:
    ```bash
    git clone https://opensource.unicc.org/un/itu/genie-ai/
    ```
  - Long-term third parties checkout their branch:
    ```bash
    git checkout noor-al-tafsir
    ```
  - Challenge teams checkout their team branch:
    ```bash
    git checkout agriculture-agriconnect-branch
    ```

### Branching Strategy
- **Main Branch**: Stable, production-ready code, maintained by UNICC ITU Maintainers.
- **Long-Term Third-Party Branches**: Dedicated branches (e.g., `noor-al-tafsir`) for sustained external contributions.
- **Challenge Team Branches**: Temporary branches for innovation sprints (e.g., `agriculture-agriconnect-branch`, `climate-barind-branch`).
- **Feature Branches**: Created off `main` or third-party branches for specific tasks (e.g., `feature/add-document-api`).
- **Naming Conventions**:
  - Feature: `feature/<description>` (e.g., `feature/add-document-api`)
  - Bug Fix: `bugfix/<description>` (e.g., `bugfix/fix-backend-auth`)
  - Third-Party Prefix: `<party>/<description>` (e.g., `noor-al-tafsir/add-search`)
  - Challenge Team: `<sector>-<team>-branch` (e.g., `agriculture-agriconnect-branch`)

### Development Workflow

#### 1. Starting a New Task
- **UNICC ITU**:
  - Create a feature branch from `main`:
    ```bash
    git checkout main
    git pull origin main
    git checkout -b feature/<description>
    ```
- **Long-Term Third Parties**:
  - Create a feature branch from their dedicated branch:
    ```bash
    git checkout noor-al-tafsir
    git pull origin noor-al-tafsir
    git checkout -b noor-al-tafsir/<description>
    ```
- **Challenge Teams**:
  - Work directly on their team branch:
    ```bash
    git checkout agriculture-agriconnect-branch
    git pull origin agriculture-agriconnect-branch
    ```
  - For framework contributions, create feature branches:
    ```bash
    git checkout -b feature/<description>
    ```
- Create a GitLab issue to track the task, using labels (e.g., `Feature`, `Bug`, `Agriculture`, `Climate`, `Health`).

#### 2. Staying Updated with Main Branch
- **Long-Term Third Parties**:
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
- **Challenge Teams**:
  - Monitor `main` for framework updates relevant to their sector
  - Create feature branches for framework-compatible changes
  - Coordinate with UNICC ITU for integration of significant contributions
  - Challenge-specific features typically remain in team branches
- **UNICC ITU**: Merge third-party changes into `main` via merge requests, ensuring no direct merges from `main` to third-party branches.

#### 3. Developing Features
- Write code in the feature branch, following:
  - **Coding Standards**: Adhere to project style guides (e.g., ESLint for JavaScript, Prettier for formatting) as defined in `STANDARDS.md`.
  - **Third-Party Requirements**: Follow integration patterns specified in `THIRD_PARTY.md`.
  - **Modularity**: Use `/components/shared` for reusable code (e.g., `/components/shared/lib/`).
  - **Documentation**: Update relevant documentation in root directory files (e.g., `site/content/en/docs/deployment/install-guide.md`) for new features.
  - **Configuration**: Follow installation and configuration patterns from `site/content/en/docs/deployment/install-guide.md`.
- Create logical commits:
  ```bash
  git add <files>
  git commit -m "Add document ingestion API to /components/document-repository"
  ```
- Reference GitLab issues in commit messages (e.g., `Fixes #123`).
- Ensure CLA.md acceptance for all contributors before pushing.
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
- Verify builds following `site/content/en/docs/deployment/install-guide.md`:
  ```bash
  docker-compose up
  ```
- Test environment configurations per `site/content/en/docs/deployment/install-guide.md`.
- Ensure all tests pass before submitting a merge request.

#### 5. Submitting for Review
- Ensure code meets standards defined in `STANDARDS.md` (linting, tests, documentation).
- Verify compliance with `THIRD_PARTY.md` guidelines for external contributors.
- Create a merge request:
  - UNICC ITU: From `feature/<description>` to `main`.
  - Long-term Parties: From `<party>/<description>` to `main` or their branch (e.g., `noor-al-tafsir`).
  - Challenge Teams: From team branch (e.g., `agriculture-agriconnect-branch`) to `main`.
  - Use GitLab’s merge request template, including:
    - Description of changes
    - Related issue numbers
    - Testing performed
    - Reference to relevant sections of `site/content/en/docs/deployment/install-guide.md` if applicable
- Push to GitLab:
  ```bash
  git push origin feature/<description>
  ```

### Code Review Process
- **UNICC ITU**:
  - Review merge requests promptly (within 2-3 business days).
  - Check for:
    - Code quality (readability, standards) per `STANDARDS.md`.
    - Functionality (meets requirements).
    - Tests (coverage, reliability).
    - Documentation (updated APIs, guides).
    - Third-party compliance per `THIRD_PARTY.md`.
    - CLA.md acceptance for all contributors.
  - Provide clear feedback via GitLab comments.
  - Approve or request changes.
- **Third Parties**:
  - Address feedback by pushing additional commits.
  - Ensure compliance with `STANDARDS.md` and `THIRD_PARTY.md`.
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

#### Documentation Requirements
All new contributors must review and agree to:
- **`CLA.md`**: Contributor License Agreement - must be accepted before committing code
- **`THIRD_PARTY.md`**: Third-party integration guidelines and requirements
- **`STANDARDS.md`**: Coding standards, development practices, and quality requirements
- **`CONTRIBUTING.md`**: General contribution guidelines and process
- **`site/content/en/docs/deployment/install-guide.md`**: Technical setup and configuration
- **This document**: Code management process and workflows

#### Long-Term Partner Setup
- **Branch Creation**:
  - UNICC ITU creates a dedicated branch (e.g., `third-party-name`):
    ```bash
    git checkout main
    git checkout -b third-party-name
    git push origin third-party-name
    ```
  - Grant appropriate access via GitLab project members
- **Access Control**: Configure branch protection following the long-term partner model

#### Challenge Team Setup
- **Group Creation**: Follow the GENIE4Good Challenge GitLab Configuration process
- **Branch Provisioning**: Create sector-specific team branches
- **Access Control**: Implement "Deny-by-Default" with team-specific exceptions
- **CLA Compliance**: Ensure all team members have accepted CLA.md before granting commit access

### Workflow for Third Parties
- Follow the same development workflow principles as outlined in `CONTRIBUTING.md`.
- **Long-term partners**: Use a dedicated branch for all work, cherry-pick changes from `main` instead of merging.
- **Challenge teams**: Work in designated team branches, follow challenge-specific timelines and deliverables.
- Submit merge requests to `main` for integration after thorough testing.
- Ensure all contributions comply with `STANDARDS.md` and `THIRD_PARTY.md`.
- Reference `site/content/en/docs/deployment/install-guide.md` for any environment or configuration changes.

### Communication
- **Sync Meetings**: Bi-weekly meetings to review progress, discuss integration, and address challenges.
- **GitLab Issues**:
  - Track tasks with labels (e.g., `Agriculture`, `Climate`, `Health`, `Feature`, `Bug`).
  - Cross-reference dependencies between teams.
- **Documentation**:
  - UNICC ITU documents `main` branch changes affecting third parties in root-level markdown files.
  - Third parties document their contributions in merge requests.
  - Configuration changes reference `site/content/en/docs/deployment/install-guide.md`.
  - Standard compliance verified against `STANDARDS.md` and `THIRD_PARTY.md`.

## Best Practices

### Documentation Requirements
All contributors must be familiar with:
- **`CLA.md`**: Review and accept the Contributor License Agreement
- **`THIRD_PARTY.md`**: Understand third-party integration requirements
- **`STANDARDS.md`**: Follow coding standards and development practices
- **`CONTRIBUTING.md`**: Adhere to contribution guidelines
- **`site/content/en/docs/deployment/install-guide.md`**: Follow installation and configuration patterns

### Commit Guidelines
- Write clear, descriptive messages:
  ```bash
  git commit -m "Add document chunking to /components/document-repository (#123)"
  ```
- Keep commits focused on single issues.
- Reference GitLab issues.
- Ensure all contributors have accepted CLA.md before committing.

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
- Update `/configs/opea-config` and `/genie-ai-overlay` as needed.
- Document changes in root-level documentation files.

## Tools and Resources
- **GitLab Repository**: `https://opensource.unicc.org/un/itu/genie-ai/`
- **Issue Tracker**: `https://opensource.unicc.org/un/itu/genie-ai//-/issues`
- **NOOR-AI-AL-TAFSIR Issues**: `https://gitlab.com/noor-al-tafsir/noor-al-tafsir/-/issues`
- **Documentation**:
  - `README.md` - Project overview and quick start
  - `site/content/en/docs/deployment/install-guide.md` - Detailed installation and setup guide
  - `STANDARDS.md` - Coding standards and development practices
  - `CONTRIBUTING.md` - Contribution guidelines
  - `THIRD_PARTY.md` - Third-party integration guidelines
  - `CLA.md` - Contributor License Agreement
  - `site/content/en/docs/rag/data-labeling.md` - Data labeling guidelines
  - `proposed-repo-structure-changes.md` - Repository restructuring plan
- **Contact**: [TBD, to be provided by UNICC ITU]

## Review and Updates
- This process is reviewed quarterly or as needed.
- Proposed changes are discussed in sync meetings and documented in GitLab issues.
- Updates are published in `UNICC-ITU-Genie-AI Code Management Process.md`.

## Conclusion
This code management process ensures efficient collaboration, high code quality, and repository integrity for the GENIE-AI framework. All developers and third-party contributors must follow the defined workflow and comply with the established documentation:

### Required Documentation for Contributors
- **[`CLA.md`](CLA.md)**: Contributor License Agreement - must be accepted before code contributions
- **[`CONTRIBUTING.md`](CONTRIBUTING.md)**: General contribution guidelines and workflows
- **[`THIRD_PARTY.md`](THIRD_PARTY.md)**: Specific requirements for third-party integrations
- **[`STANDARDS.md`](STANDARDS.md)**: Coding standards and development practices
- **[`site/content/en/docs/deployment/install-guide.md`](site/content/en/docs/deployment/install-guide.md)**: Technical setup and configuration

### Access Models
- **Long-term Partners**: Dedicated branches with cherry-pick workflow for sustained collaboration
- **Challenge Teams**: Time-bounded team branches with sector-specific isolation and open-source transparency
- **Both Models**: Maintain code quality through controlled merge processes and comprehensive documentation

For questions or clarifications, contact UNICC ITU via GitLab issues or sync meetings. All merge decisions are tightly controlled through team meetings to ensure architectural consistency and framework stability.

**Document Version:** 2.0
**Last Updated:** March 10, 2026
**Project:** GENIE.AI
**Maintained By:** ITU (International Telecommunication Union)