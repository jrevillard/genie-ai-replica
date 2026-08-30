# Contribution Guidelines

Thank you for your interest in the GENIE.AI initiative. This document provides a comprehensive guide for contributors, including required documentation, contribution areas, and submission processes.

## 📋 Prerequisite Documentation

Before contributing to GENIE.AI, all contributors must review and agree to the following documentation:

### Required Reading
1. **[CLA.md](CLA.md)** - Contributor License Agreement
   - **MUST be accepted** before any code contribution
   - Defines copyright and patent licenses
   - Outlines compliance requirements and representations
   - Includes challenge-specific provisions for GenAI for Good Challenge participants

2. **[STANDARDS.md](STANDARDS.md)** - Project Coding Standards Specification
   - Mandatory coding standards for all contributions
   - Covers JavaScript, Vue 3, Node.js, Python, Bash, and more
   - Defines documentation, Docker, and internationalization standards
   - All contributions must adhere to these standards

3. **[THIRD_PARTY.md](THIRD_PARTY.md)** - Third-Party Software Disclosure
   - Requirements for disclosing third-party dependencies
   - Licensing compliance for all external components
   - Attribution requirements (e.g., FontAwesome icons)
   - Must be updated for any new dependencies introduced

### Essential Documentation
4. **[README.md](README.md)** - Project Overview
   - High-level understanding of GENIE.AI initiative
   - Architecture and technology stack
   - Quick start guide and development setup
   - Deployment instructions

5. **[site/content/en/docs/deployment/install-guide.md](site/content/en/docs/deployment/install-guide.md)** - Technical Setup
   - Detailed installation and configuration instructions
   - Environment setup and prerequisites
   - Docker and Kubernetes deployment guides
   - Troubleshooting and best practices

6. **[UNICC-ITU-Genie-AI Code Management Process.md](UNICC-ITU-Genie-AI%20Code%20Management%20Process.md)** - Development Workflow
   - Repository access and branching strategy
   - Code submission and review processes
   - GitLab configuration for challenge teams
   - Conflict resolution and communication guidelines

### Specialized Documentation
7. **[site/content/en/docs/rag/data-labeling.md](site/content/en/docs/rag/data-labeling.md)** - Data Labeling for RAG
   - Understanding the hybrid RAG pipeline
   - Data labeling and enrichment strategies
   - Knowledge graph integration
   - Best practices for domain-specific labeling

8. **[proposed-repo-structure-changes.md](proposed-repo-structure-changes.md)** - Repository Architecture
   - Current and proposed repository structure
   - Component organization and shared libraries
   - Modularity and scalability considerations

## 🎯 Areas of Contribution

### 1. Collection of Data for Fine-Tuning and Testing
- **What**: Contribute relevant datasets for refining and testing AI models
- **Ideal Contributors**: Data scientists, researchers, academic institutions, governmental bodies
- **Documentation**: Review [site/content/en/docs/rag/data-labeling.md](site/content/en/docs/rag/data-labeling.md) for data preparation guidelines

### 2. Open-Source Fine-Tuned LLMs and Embedding Models
- **What**: Contribute fully open-source fine-tuned models
- **Ideal Contributors**: AI developers, ML researchers, open-source enthusiasts
- **Standards**: Must comply with [STANDARDS.md](STANDARDS.md) and [THIRD_PARTY.md](THIRD_PARTY.md)

### 3. RAG Methods for Public Sector Needs
- **What**: Develop Retrieval-Augmented Generation methods for public sector applications
- **Ideal Contributors**: AI researchers, ML engineers, public sector technology experts
- **Context**: See [site/content/en/docs/rag/data-labeling.md](site/content/en/docs/rag/data-labeling.md) for hybrid RAG approach

### 4. Under-Served Language Optimization
- **What**: Optimize AI solutions for under-served languages
- **Ideal Contributors**: Linguists, multilingual AI developers, local language experts
- **Standards**: Follow internationalization guidelines in [STANDARDS.md](STANDARDS.md)

## 🚀 Getting Started

### For All Contributors
1. **Review Documentation**: Read all required documentation listed above
2. **Accept CLA**: Review and accept [CLA.md](CLA.md)
3. **Setup Environment**: Follow [site/content/en/docs/deployment/install-guide.md](site/content/en/docs/deployment/install-guide.md)
4. **Understand Process**: Review [UNICC-ITU-Genie-AI Code Management Process.md](UNICC-ITU-Genie-AI%20Code%20Management%20Process.md)
5. **Follow Standards**: Ensure all code meets [STANDARDS.md](STANDARDS.md) requirements

### For Challenge Participants
If you're participating in the **GenAI for Good Challenge**, please note:
- Challenge-specific provisions are in [CLA.md](CLA.md) (Appendix)
- Team branch setup is detailed in [UNICC-ITU-Genie-AI Code Management Process.md](UNICC-ITU-Genie-AI%20Code%20Management%20Process.md)
- Submission deadline: **1 December 2025**
- Focus areas: Agriculture (Lesotho), Health (The Gambia), Climate (Bangladesh)

## 📝 Submission Process

1. **Branch Strategy**: Follow the branching strategy in [UNICC-ITU-Genie-AI Code Management Process.md](UNICC-ITU-Genie-AI%20Code%20Management%20Process.md)
2. **Code Quality**: Ensure compliance with [STANDARDS.md](STANDARDS.md)
3. **Testing**: Test thoroughly using guidelines from [site/content/en/docs/deployment/install-guide.md](site/content/en/docs/deployment/install-guide.md)
4. **Third-Party Check**: Update [THIRD_PARTY.md](THIRD_PARTY.md) for any new dependencies
5. **Submit**: Create merge request following the code management process

## 🔍 Additional Resources

### Documentation Links
- **[README.md](README.md)** - Project overview and quick start
- **[STANDARDS.md](STANDARDS.md)** - Coding standards and best practices
- **[CLA.md](CLA.md)** - Contributor license agreement
- **[THIRD_PARTY.md](THIRD_PARTY.md)** - Third-party software disclosure
- **[site/content/en/docs/deployment/install-guide.md](site/content/en/docs/deployment/install-guide.md)** - Setup and configuration
- **[site/content/en/docs/rag/data-labeling.md](site/content/en/docs/rag/data-labeling.md)** - Data labeling guidelines
- **[UNICC-ITU-Genie-AI Code Management Process.md](UNICC-ITU-Genie-AI%20Code%20Management%20Process.md)** - Development workflow
- **[proposed-repo-structure-changes.md](proposed-repo-structure-changes.md)** - Repository architecture

### External Resources
- **[Contributor Covenant](https://www.contributor-covenant.org/)** - Code of conduct
- **[ITU Initiative on Open Source AI for Public Services](https://www.itu.int/en/ITU-D/ICT-Applications/Pages/Initiatives/ITU_OSPO/Open-Source_AI_for_Public_Services/About_the_Initiative.aspx)**
- **[AI for Good Global Summit](https://aiforgood.itu.int/eventcat/discovery-open-source-ai-for-digital-public-goods/)**

## 💬 Community and Communication

- **GitLab Repository**: https://opensource.unicc.org/un/itu/genie-ai/
- **Issue Tracker**: https://opensource.unicc.org/un/itu/genie-ai/-/issues
- **Challenge Website**: https://ieeeht.org/get-involved/funding-opportunities/genai-for-good/

For questions about contributions, please open an issue in the GitLab repository or contact the GENIE.AI Project Team. 

**Document Version:** 2.0
**Last Updated:** March 10, 2026
**Project:** GENIE.AI
**Maintained By:** ITU (International Telecommunication Union)