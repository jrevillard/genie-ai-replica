# GENIE.AI - Vue.js Component Library

This repository contains a comprehensive set of Vue.js components designed for the GENIE.AI RAG framework. The framework provides users with easy access to build a RAG based chatbot with extensive capabilities including, logging, security, analytics dashboards, and user profile management.

## Table of Contents

- [Overview](#overview)
- [Core Components](#core-components)
- [Component Interactions](#component-interactions)
- [Features](#features)
- [Technical Details](#technical-details)
- [Getting Started](#getting-started)
- [Internationalization](#internationalization)

## Overview

The GENIE.AI framework is a suite of pre-assembled Vue.js application components designed to provide users with easy access to build a RAG based chatbot with extensive capabilities including, logging, security, analytics dashboards, and user profile management through a chat-based interface. The application includes:

- A chat interface for interacting with government services
- A sidebar with a service tree for navigation
- Analytics dashboards for tracking system usage
- User profile management
- Multiple language support (English, French, Indonesian, Swahili... with the ability add more languages very quickly)

## Core Components

### Main Layout Components

- **NavBarComponent**: Main navigation bar with system status indicators, language selection, and action buttons.
- **SideBarComponent**: Contains the service tree and chat history, with collapsible functionality.
- **ChatBotComponent**: The main chat interface for interacting with government services.

### Chat-Related Components

- **ChatBotComponent**: Main chat interface with message history, quick help overlay, and context awareness.
- **ChatResponseFeedbackDialog**: Dialog for collecting feedback on bot responses.
- **ChatHistoryComponent**: Displays past conversations for reference.
- **ChatFolders**: Organizes saved chats into folders with management functionality.

### Service Navigation Components

- **ServiceTreeContainer**: Container for the service category tree.
- **ServiceTreePanelComponent**: Hierarchical tree of government services categories and subcategories.
- **ServiceCategoryPanelComponent**: Displays service categories with icons.

### Analytics Components

- **AnalyticsDashboard**: Dashboard displaying usage metrics and trends.
- **UnifiedAnalytics**: Comprehensive analytics views with multiple charts.
- **UsageTrendChart**: Chart showing trends in system usage over time.

### User Management Components

- **UserProfileComponent**: Profile management with multiple tabs for personal information.
- **PersonalIdentificationTab**: Detailed form for personal identification information.

### Utility Components

- **ModalDialog**: Reusable modal dialog component.
- **ModalComponent**: Alternative modal implementation with additional features.
- **ContextMenu**: Context menu for additional actions.
- **FileUploadComponent**: Component for handling file uploads.
- **LanguageSelector**: Language selection dropdown.
- **SettingsComponent**: Application settings management.

## Component Interactions

The components interact with each other through the following mechanisms:

1. **Parent-Child Communication**:
   - Props flow down from parent to child components
   - Events flow up from child to parent components
   
2. **Event Bus**:
   - Components communicate across the hierarchy using the `eventBus`
   - Key events include `treeNodeSelected`, `contextItemRemoved`, and `open-chat`

3. **Vuex Store**:
   - Components access shared state via Vuex getters
   - Components commit changes via Vuex actions
   - Chat history and service categories are managed in the store

## Features

### Chat Interface

The chat interface allows users to:

- Ask questions about government services
- Select context from the service tree for more specific answers
- Provide feedback on responses
- Save conversations to folders
- View chat history

### Service Tree Navigation

The service tree provides:

- Hierarchical navigation of service categories (AKA Knowledge Areas)
- Selection of categories/services as context for chat
- Searching for specific categories and services
- Expandable/collapsible sections

### Analytics Dashboard

The analytics dashboard shows:

- Usage trends over time (daily, weekly, monthly, yearly)
- User satisfaction metrics
- Popular query topics
- Service usage distribution
- Response time metrics

### User Profile Management

The user profile section allows citizens to:

- Manage personal identification information
- Upload documents and ID cards
- Track application status
- Manage address and contact information
- View history with government services

### Multilingual Support

The application supports:

- English, French, Indonesian and Swahili languages - extensible language support
- Language switching via the navbar
- Consistent translations across all components

## Technical Details

### Component Structure

- Each component follows Vue.js best practices with a clear separation of template, script, and style sections
- Scoped styles ensure styling doesn't leak between components
- Props validation and default values ensure robust component behavior

### State Management

- Vuex store is used for shared state
- Local component state for UI-specific concerns
- Persistence to localStorage where appropriate

### Event Handling

- Custom events for component communication
- Event bus for cross-component communication
- Global event listeners for keyboard shortcuts

### Responsive Design

- Mobile-friendly layouts with responsive breakpoints
- Collapsible sidebar for smaller screens
- Optimized touch interactions

## Getting Started

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Run Development Server**:
   ```bash
   npm run serve
   ```

3. **Build for Production**:
   ```bash
   npm run build
   ```

## Internationalization

The application uses Vue i18n for internationalization. Translation keys are organized by component and feature area. The main supported languages are:

- English (en) - Default
- French (fr)
- Indoneasian (id)
- Swahili (sw)

Translation files are structured as follows:

```javascript
{
  "en": {
    "chatbot": {
      "placeholder": "Type your message here...",
      "sendButton": "Send",
      "welcomeMessage": "Welcome! How can I help you today?"
      // ...
    },
    "sidebar": {
      "folders": "Folders",
      "governmentServices": "Government Services",
      // ...
    },
    // ...
  },
  "fr": {
    // French translations
  },
  "sw": {
    // Swahili translations
  }
}
```

To add support for additional languages, simply add a new language object with the appropriate translations.
