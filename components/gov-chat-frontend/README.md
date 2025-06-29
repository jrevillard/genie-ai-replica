# GENIE.AI Frontend Framework

## Project Charter

GENIE.AI is a comprehensive RAG (Retrieval-Augmented Generation) chatbot framework designed to provide intelligent, context-aware conversational experiences for any domain or use case. The frontend is built with Vue.js 3 and provides a modern, accessible, and multilingual interface that can be customized for various industries and applications - from customer service and healthcare to education and e-commerce.

### Mission Statement
To democratize access to intelligent conversational AI through a flexible, configurable framework that enables organizations to create context-aware chatbots that understand domain-specific knowledge, speak multiple languages, and provide accurate, helpful responses tailored to their specific use cases.

### Key Features
- **Domain Agnostic**: Configurable for any industry or use case
- **RAG Integration**: Seamless retrieval-augmented generation capabilities
- **Multilingual Support**: Full internationalization system for global deployment
- **Responsive Design**: Mobile-first approach with adaptive layouts
- **Real-time Analytics**: Comprehensive usage tracking and insights
- **User Profile Management**: Flexible user data collection system
- **Chat History Organization**: Folder-based conversation management
- **Theme System**: Light/dark mode with customizable branding
- **Configuration-Driven**: JSON-based customization without code changes
- **Accessibility**: WCAG compliant design patterns

### Use Cases
- **Customer Service**: Automated support with knowledge base integration
- **Healthcare**: Patient inquiries and medical information assistance
- **Education**: Interactive learning and student support systems
- **E-commerce**: Product recommendations and shopping assistance
- **Government Services**: Citizen service portals and information access
- **HR & Employee Support**: Internal knowledge base and policy guidance
- **Financial Services**: Account inquiries and financial advice
- **Real Estate**: Property search and market information

## Project Structure

```
src/
├── main.js                 # Application entry point with config loading
├── App.vue                 # Root component
├── router.js               # Vue Router configuration
├── i18n.js                 # Internationalization setup
├── eventBus.js             # Custom event bus implementation
├── store/
│   ├── index.js            # Vuex store configuration
│   ├── chatHistoryStore.js # Chat history state management
│   └── modules/
│       └── auth.js         # Authentication module
├── components/             # Vue components
├── views/                  # Page-level components
├── services/               # API and business logic
├── utils/                  # Utility functions
└── assets/                 # Static assets
```

## Configuration System

### GENIE.AI Framework Configuration

The application uses a dynamic configuration system that loads from `/config/genie-ai-config.json`, allowing complete customization without code changes:

```javascript
// Configuration structure for any domain
{
  "app": {
    "title": "Your AI Assistant", // Customizable app name
    "icon": { "type": "file", "value": "/config/your-icon.svg" }
  },
  "theme": {
    "primaryColor": "#4E97D1",    // Brand colors
    "secondaryColor": "#2C5F8A",
    "backgroundColor": "#f5f7fa",
    "textColor": "#333333",
    "navbar": {
      "gradientStart": "#4E97D1",
      "gradientEnd": "#2C5F8A",
      "textColor": "#ffffff"
    }
  },
  "features": {
    "chat": {
      "welcomeMessage": "Welcome! How can I help you today?",
      "botName": "Assistant",
      "quickHelp": [
        // Domain-specific quick actions
        "Find products",
        "Check order status", 
        "Get support",
        "View account"
      ]
    },
    "userProfile": {
      "enabled": true,
      "sections": [
        // Configurable profile sections for your domain
      ]
    },
    "analytics": {
      "enabled": true,
      "metrics": ["queries", "satisfaction", "categories"]
    }
  },
  "domain": {
    "categories": [
      // Industry-specific service categories
      "Product Information",
      "Order Management", 
      "Technical Support",
      "Account Services"
    ]
  }
}
```

### Environment Variables

Ensure the following environment variable is set:

```bash
VUE_APP_API_URL=http://localhost:3000/api
```

## Core Systems

### 1. Internationalization (i18n)

The application supports three languages with comprehensive translation coverage:

#### Supported Languages
- **English (en)**: Default language
- **French (fr)**: Complete translation set
- **Swahili (sw)**: Complete translation set

#### Key Translation Categories
- Navigation and UI elements
- Configurable service categories (customizable per domain)
- User profile sections and fields (adaptable to use case)
- Analytics and reporting
- System status and notifications
- Chat interface and interactions
- Domain-specific terminology and content

#### Language Detection Priority
1. Saved user preference (localStorage)
2. Browser language detection
3. Default to English

#### Usage Example
```javascript
// In components
this.$t('nav.menu')
this.$t('userProfile.tabs.tab1')

// Programmatic locale switching
this.$setLocale('fr')
```

### 2. Theme System

Advanced theming system with CSS custom properties and dynamic switching:

#### Theme Modes
- **Light Theme**: Default bright interface
- **Dark Theme**: Dark mode for low-light environments
- **System Theme**: Follows OS preference

#### CSS Architecture
- `theme-variables.css`: CSS custom properties
- `theme-components.css`: Component-specific theming
- Dynamic CSS variable updates based on configuration

#### Implementation
```javascript
// Theme detection and application
const themeInfo = themeManager.getThemeInfo();
document.documentElement.setAttribute('data-theme', theme);
```

### 3. State Management (Vuex)

#### Store Modules

**Chat History Store (`chatHistoryStore.js`)**
- Folder-based chat organization
- Real-time chat synchronization
- Persistent storage with localStorage backup

**Authentication Module (`auth.js`)**
- User session management
- Token-based authentication
- Automatic session restoration

#### Key State Features
- Automatic localStorage persistence
- Module namespacing
- Reactive updates across components

### 4. Routing System

#### Route Structure
```javascript
const routes = [
  // Public routes
  { path: '/login', component: LoginScreen },
  { path: '/register', component: RegisterScreen },
  { path: '/verify-email/:token', component: EmailVerificationScreen },
  
  // Protected routes
  { path: '/dashboard', component: DashboardView, meta: { requiresAuth: true } },
  { path: '/analytics', component: UnifiedAnalytics, meta: { requiresAuth: true } },
  { path: '/profile', component: UserProfileComponent, meta: { requiresAuth: true } }
]
```

#### Authentication Guards
- Automatic authentication state checking
- Redirect handling for unauthenticated users
- Route protection based on meta properties

### 5. Event System

Custom event bus implementation for component communication:

```javascript
// Event emission
eventBus.$emit('languageChanged', { language: 'fr' })

// Event listening
eventBus.$on('chatUpdated', (chatData) => {
  // Handle chat update
})
```

## Architecture Overview

### Application Structure Diagram

```mermaid
graph TB
    subgraph "GENIE.AI Frontend Framework"
        subgraph "App.vue - Root Container"
            APP[App.vue<br/>Theme & Auth Manager]
            NAV[NavBarComponent]
            MAIN[Main Content Area]
        end
        
        subgraph "Authentication Flow"
            LOGIN[LoginScreen]
            REGISTER[RegisterScreen]
            VERIFY[EmailVerificationScreen]
            RESET[PasswordResetInitiateScreen]
            CONFIRM[PasswordResetConfirmScreen]
            SUCCESS[RegistrationSuccessScreen]
        end
        
        subgraph "Main Application"
            DASH[DashboardView]
            SIDEBAR[SideBarComponent]
            CHAT[ChatBotComponent]
            FOLDERS[ChatFolders]
            HISTORY[ChatHistoryComponent]
            RIGHT[RightSideBarComponent]
        end
        
        subgraph "Management Components"
            ANALYTICS[UnifiedAnalytics]
            PROFILE[UserProfileComponent]
            SETTINGS[SettingsComponent]
            ADMIN[AdminDashboard]
        end
        
        subgraph "Core Services"
            AUTH_SVC[authService]
            USER_SVC[userService]
            CHAT_SVC[chatbotService]
            HIST_SVC[chatHistoryService]
            ANALYTICS_SVC[analyticsService]
        end
        
        subgraph "State Management"
            STORE[Vuex Store]
            AUTH_MODULE[Auth Module]
            CHAT_MODULE[Chat History Module]
        end
    end
    
    APP --> NAV
    APP --> MAIN
    MAIN --> DASH
    DASH --> SIDEBAR
    DASH --> CHAT
    DASH --> RIGHT
    
    LOGIN --> AUTH_SVC
    REGISTER --> AUTH_SVC
    VERIFY --> AUTH_SVC
    
    CHAT --> CHAT_SVC
    CHAT --> HIST_SVC
    FOLDERS --> HIST_SVC
    
    ANALYTICS --> ANALYTICS_SVC
    PROFILE --> USER_SVC
    
    AUTH_SVC --> AUTH_MODULE
    HIST_SVC --> CHAT_MODULE
    
    AUTH_MODULE --> STORE
    CHAT_MODULE --> STORE
```

### Component Hierarchy

```mermaid
graph TD
    APP[App.vue] --> NAV[NavBarComponent]
    APP --> ROUTER[Router View]
    
    subgraph "Public Routes"
        ROUTER --> LOGIN[LoginScreen]
        ROUTER --> REGISTER[RegisterScreen]
        ROUTER --> VERIFY[EmailVerificationScreen]
        ROUTER --> RESET_INIT[PasswordResetInitiateScreen]
        ROUTER --> RESET_CONF[PasswordResetConfirmScreen]
        ROUTER --> REG_SUCCESS[RegistrationSuccessScreen]
    end
    
    subgraph "Protected Routes"
        ROUTER --> DASH[DashboardView]
        DASH --> SIDEBAR[SideBarComponent]
        DASH --> CHATBOT[ChatBotComponent]
        DASH --> RIGHT_SIDEBAR[RightSideBarComponent]
        
        SIDEBAR --> FOLDERS[ChatFolders]
        SIDEBAR --> HISTORY[ChatHistoryComponent]
        
        CHATBOT --> FEEDBACK[ChatResponseFeedbackDialog]
        CHATBOT --> MODAL[ModalDialog]
        CHATBOT --> CONFIRM[ConfirmDialog]
        
        FOLDERS --> MODAL_F[ModalDialog]
        FOLDERS --> CONTEXT[ContextMenu]
        
        APP --> ANALYTICS[UnifiedAnalytics]
        APP --> PROFILE[UserProfileComponent]
        APP --> SETTINGS[SettingsComponent]
        APP --> ADMIN[AdminDashboard]
    end
    
    subgraph "Shared Components"
        LANG[LanguageSelector]
        EVENT[EventBus]
    end
    
    LOGIN --> LANG
    REGISTER --> LANG
    RESET_INIT --> LANG
```

## Component Architecture

### User Authentication Flow

```mermaid
sequenceDiagram
    participant U as User
    participant L as LoginScreen
    participant R as RegisterScreen
    participant V as EmailVerificationScreen
    participant A as authService
    participant S as Vuex Store
    participant APP as App.vue
    
    Note over U,APP: Registration Flow
    U->>R: Enter registration details
    R->>A: register(userData)
    A->>A: Validate and create account
    A-->>R: Registration success
    R->>V: Redirect to email verification
    U->>V: Click email verification link
    V->>A: verifyEmail(token)
    A-->>V: Verification success
    V->>L: Redirect to login
    
    Note over U,APP: Login Flow
    U->>L: Enter credentials
    L->>A: login(username, password)
    A->>A: Authenticate user
    A-->>L: Return user data & token
    L->>S: dispatch('initAuth')
    L->>S: commit('setUser', userData)
    L->>APP: emit('login-success', userData)
    APP->>APP: Load user folders & preferences
    APP->>APP: Navigate to dashboard
```

### Chat Interaction Flow

```mermaid
sequenceDiagram
    participant U as User
    participant C as ChatBotComponent
    participant S as chatbotService
    participant H as chatHistoryService
    participant F as ChatFolders
    participant ST as Vuex Store
    
    Note over U,ST: New Chat Session
    U->>C: Type message
    C->>C: Add user message to chatMessages
    C->>S: submitQuery(queryData)
    S->>S: Process query with RAG backend
    S-->>C: Return AI response
    C->>C: Add bot response to chatMessages
    C->>S: markQueryAsAnswered(queryId)
    
    Note over U,ST: Save Chat
    U->>C: Click save chat button
    C->>C: Open save dialog
    U->>C: Enter title & select folder
    C->>H: createConversation(conversationData)
    H-->>C: Return conversation ID
    C->>H: addMessage(messageData) for each message
    C->>ST: dispatch('chatHistory/createChat', chatData)
    C->>F: emit('conversation-saved', conversationId)
    F->>F: Refresh chat list
    
    Note over U,ST: Load Existing Chat
    U->>F: Click on chat item
    F->>C: emit('load-conversation', conversationId)
    C->>C: Check for unsaved changes
    C->>H: getConversation(conversationId)
    H-->>C: Return conversation data
    C->>C: Load messages & context items
    C->>C: Update UI with chat history
```

### Folder Management Flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as ChatFolders
    participant H as chatHistoryService
    participant S as Vuex Store
    participant M as ModalDialog
    
    Note over U,S: Create Folder
    U->>F: Click create folder button
    F->>M: Show create folder dialog
    U->>M: Enter folder name
    M->>F: Submit folder creation
    F->>H: createFolder(folderData)
    H-->>F: Return new folder
    F->>S: dispatch('chatHistory/setFolders', updatedFolders)
    F->>F: Refresh folder list
    
    Note over U,S: Move Chat to Folder
    U->>F: Right-click chat item
    F->>F: Show context menu
    U->>F: Select "Move Chat"
    F->>M: Show move dialog with folder options
    U->>M: Select destination folder
    M->>F: Confirm move operation
    F->>H: moveConversation(chatId, fromFolder, toFolder)
    F->>S: dispatch('chatHistory/moveChat', moveData)
    F->>F: Update folder contents
    
    Note over U,S: Delete Folder
    U->>F: Click delete folder button
    F->>M: Show confirmation dialog
    U->>M: Confirm deletion
    M->>F: Proceed with deletion
    F->>H: deleteFolder(folderId)
    F->>S: Update store with remaining folders
    F->>F: Move orphaned chats to default folder
```

### Theme and Localization Flow

```mermaid
sequenceDiagram
    participant U as User
    participant S as SettingsComponent
    participant L as LanguageSelector
    participant T as ThemeManager
    participant APP as App.vue
    participant DOM as Document
    
    Note over U,DOM: Theme Change
    U->>S: Select theme (light/dark/system)
    S->>T: Apply new theme
    T->>DOM: setAttribute('data-theme', newTheme)
    T->>T: Save to localStorage
    S->>APP: emit('themeChanged', newTheme)
    APP->>APP: Update component theme state
    
    Note over U,DOM: Language Change
    U->>L: Select new language
    L->>L: Update i18n locale
    L->>L: Save to localStorage
    L->>DOM: setAttribute('lang', newLocale)
    L->>APP: emit('languageChanged', locale)
    APP->>APP: Force page reload for full translation
    
    Note over U,DOM: System Theme Detection
    DOM->>T: Media query change (prefers-color-scheme)
    T->>T: Detect system preference
    T->>DOM: Apply system theme
    T->>APP: Notify components of theme change
```

The application organizes services into configurable categories that can be customized for any domain:

**Example: Government Services (Default Configuration)**
1. **Identity & Civil Registration**
2. **Healthcare & Social Services**
3. **Education & Learning**
4. **Employment & Labor Services**
5. **Taxes & Revenue**
6. **Public Safety & Justice**
7. **Transportation & Mobility**
8. **Housing & Urban Development**
9. **Utilities & Environment**
10. **Business & Trade**
11. **Social Security & Pensions**
12. **Community & Civic Engagement**

**Example: E-commerce Configuration**
1. **Product Catalog & Search**
2. **Order Management**
3. **Payment & Billing**
4. **Shipping & Delivery**
5. **Returns & Exchanges**
6. **Customer Account**
7. **Technical Support**
8. **Product Reviews & Recommendations**

**Example: Healthcare Configuration**
1. **Appointment Scheduling**
2. **Medical Records & History**
3. **Insurance & Billing**
4. **Prescription Management**
5. **Lab Results & Reports**
6. **Provider Information**
7. **Health Education & Resources**
8. **Emergency & Urgent Care**

### 2. User Profile System

Flexible profile system that adapts to different domains and use cases:

**Configurable Profile Sections:**
- **Basic Information**: Core user data relevant to your domain
- **Preferences**: User settings and customization options
- **History & Activity**: Past interactions and engagement data
- **Documents & Verification**: Domain-specific document management
- **Custom Fields**: Industry-specific data collection

**Example Configurations:**

**E-commerce Profile:**
- Personal details and contact information
- Shipping addresses and preferences  
- Payment methods and billing information
- Order history and purchase patterns
- Product preferences and wishlist
- Communication preferences

**Healthcare Profile:**
- Patient demographics and emergency contacts
- Medical history and current conditions
- Insurance information and coverage details
- Provider preferences and appointment history
- Medication lists and allergies
- Health goals and monitoring data

**Government Services Profile (Default):**
- Personal identification data
- Civil registration documents
- Address and residency information
- Employment and financial data
- Service history and preferences

### 3. Analytics Dashboard

Configurable analytics system that adapts to different business needs:

**Core Metrics (Universal):**
- Usage statistics and trends
- User satisfaction and feedback
- Chat completion rates
- Response accuracy metrics
- System performance indicators

**Domain-Specific Analytics:**

**E-commerce:**
- Product inquiry patterns
- Conversion tracking from chat to purchase  
- Cart abandonment recovery
- Customer lifetime value impact

**Healthcare:**
- Appointment booking success rates
- Common health inquiry categories
- Patient satisfaction with AI responses
- Provider referral patterns

**Customer Service:**
- Issue resolution rates
- Escalation to human agents
- Cost savings through automation
- Customer effort scores

**Exportable Reports:**
- CSV/Excel data exports
- Customizable date ranges
- Filtered analytics by category
- Performance benchmarking

## Mobile Responsiveness

### Viewport Handling
- Dynamic viewport height calculation
- iOS Safari toolbar accommodation
- Android keyboard detection and adjustment

### CSS Breakpoints
```css
/* Mobile-first responsive design */
--mobile: 768px
--tablet: 1024px
--desktop: 1200px
```

### Touch Interactions
- Touch-friendly button sizing
- Swipe gestures for navigation
- Optimized input handling

## Customization Guide

### Quick Start for New Domains

1. **Configuration Setup**
   ```bash
   # Copy the example configuration
   cp /config/genie-ai-config.example.json /config/genie-ai-config.json
   
   # Customize for your domain
   nano /config/genie-ai-config.json
   ```

2. **Branding Customization**
   - Replace logo/icon files in `/config/`
   - Update color scheme in configuration
   - Modify welcome messages and bot personality

3. **Service Categories**
   - Define your domain-specific categories
   - Configure quick help actions
   - Set up service hierarchies

4. **Internationalization**
   - Add domain-specific translations to `i18n.js`
   - Configure supported languages
   - Customize regional settings

5. **User Profile Fields**
   - Define relevant user data fields
   - Configure validation rules
   - Set up data collection preferences

## Development Setup

### Installation
```bash
npm install
```

### Development Server
```bash
npm run serve
```

### Production Build
```bash
npm run build
```

### Configuration Requirements
1. Create `/public/config/genie-ai-config.json`
2. Set environment variables
3. Configure API endpoints

## Dependencies

### Core Framework
- **Vue.js 3.2+**: Progressive JavaScript framework
- **Vue Router 4**: Client-side routing
- **Vuex 4**: State management
- **Vue i18n 9**: Internationalization

### UI and Visualization
- **ApexCharts**: Interactive charts and graphs
- **Chart.js**: Additional charting capabilities
- **ECharts**: Advanced data visualization
- **FontAwesome**: Icon library

### Utilities
- **Axios**: HTTP client for API communication
- **DOMPurify**: XSS protection for user content
- **jsPDF**: PDF generation capabilities
- **Marked**: Markdown parsing
- **D3.js**: Data manipulation and visualization

### Development

### Ensure that the VUE_APP_API_URL env for the back end services is set up for example (port on which node.js is running)
VUE_APP_API_URL=http://localhost:3000/api

## Project setup
```
npm install
```

### Compiles and hot-reloads for development
```
npm run serve
```

### Compiles and minifies for production
```
npm run build
```

### Lints and fixes files
```
npm run lint
```

### Customize configuration
See [Configuration Reference](https://cli.vuejs.org/config/).

