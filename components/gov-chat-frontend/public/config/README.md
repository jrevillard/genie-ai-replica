# GENIE.AI Framework Configuration Guide

This guide provides developers with detailed instructions for configuring the GENIE.AI chatbot framework, used in applications like Huduma AI and NAAT - Noor AI AL Tafsir. The configuration system, driven by JSON files (e.g., `genie-ai-config.json`, `genie-ai-config-huduma.json`, `genie-ai-config-naat.json`), customizes the application’s title, icon, color scheme, and chatbot features. This document explains how the configuration system works, how to apply style changes (e.g., navbar gradient, button colors), how to create new use cases, and the impact on all screens and components, including how button styles propagate across the application.

## Overview

The GENIE.AI framework powers customizable chatbot applications, with configurations stored in JSON files under `/public/config/`. These files are loaded at runtime by `main.js`, passed to components like `NavBarComponent.vue`, `SideBarComponent.vue`, and various screens, and used to style elements via CSS variables in `theme-variables.css` and component styles. Key configuration aspects include:
- **Application Title and Icon**: Define the navbar and screen titles (e.g., `Huduma AI`) and SVG logos.
- **Color Scheme**: Set primary colors for buttons, tabs, and links; navbar gradients; backgrounds; and text styles.
- **Chatbot Features**: Configure welcome messages and bot names.
- **Custom Settings**: Support use case-specific configurations.

## Configuration Files

Configurations are JSON files in `/public/config/`, validated against a JSON schema. Multiple files can coexist for different use cases in the folder for testing convenience (e.g., `genie-ai-config-huduma.json`, `genie-ai-config-naat.json`) but only the `genie-ai-config.json` will be used by the app.

### Schema
- **`$schema`**: JSON Schema draft-07 (`http://json-schema.org/draft-07/schema#`).
- **Type**: Object with required sections: `app`, `theme`.
- **Properties**:
  - **`app`**:
    - `title` (string): Application title for navbar and screens (default: `GENIE.AI Chatbot`).
    - `icon` (object):
      - `type` (enum: `file`, `inline`): Icon source (default: `file`).
      - `value` (string): SVG file path (e.g., `/public/config/huduma-icon.svg`) or inline SVG.
  - **`theme`**:
    - `primaryColor` (string): Color for buttons, tabs, checkboxes, and links (default: `#4E97D1`).
    - `secondaryColor` (string): Secondary text and highlights (default: `#2C5F8A`).
    - `backgroundColor` (string): Main content background (default: `#f5f7fa`).
    - `textColor` (string): Primary text color (default: `#333333`).
    - `navbar` (object):
      - `gradientStart` (string): Navbar gradient start (default: `#4E97D1`).
      - `gradientEnd` (string): Navbar gradient end (default: `#2C5F8A`).
      - `textColor` (string): Navbar text/icon color (default: `#ffffff`).
  - **`features`**:
    - `chat` (object):
      - `welcomeMessage` (string): Chatbot greeting (default: `Welcome to GENIE.AI!`).
      - `botName` (string): Chatbot name (default: `Genie`).
  - **`custom`**: Arbitrary key-value pairs for custom settings.

### Example Configurations

#### Huduma AI (`genie-ai-config-huduma.json`)
```json
{
  "app": {
    "title": "Huduma AI",
    "icon": {
      "type": "file",
      "value": "/public/config/huduma-icon.svg"
    }
  },
  "theme": {
    "primaryColor": "#4E97D1",
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
      "welcomeMessage": "Welcome to Huduma AI, your public service assistant!",
      "botName": "Huduma"
    }
  },
  "custom": {}
}
```

#### NAAT - Noor AI AL Tafsir (`genie-ai-config-naat.json`)
```json
{
  "app": {
    "title": "NAAT - Noor AI AL Tafsir",
    "icon": {
      "type": "file",
      "value": "/public/config/naat-icon.svg"
    }
  },
  "theme": {
    "primaryColor": "#2A9D8F",
    "secondaryColor": "#264653",
    "backgroundColor": "#EAF4F4",
    "textColor": "#1A3C34",
    "navbar": {
      "gradientStart": "#2A9D8F",
      "gradientEnd": "#1A6D62",
      "textColor": "#F8EDEB"
    }
  },
  "features": {
    "chat": {
      "welcomeMessage": "Welcome to NAAT - Noor AI AL Tafsir, your guide to Quranic interpretation!",
      "botName": "Noor"
    }
  },
  "custom": {}
}
```

## Managing Configurations

### Modifying Styles
To change styles like navbar gradients, button colors, or other UI elements:
1. **Edit the Config File**:
   - Open the desired config (e.g., `/public/config/genie-ai-config-huduma.json`).
   - Update `theme` properties:
     - **Navbar Gradient**: Set `theme.navbar.gradientStart` and `theme.navbar.gradientEnd` (e.g., `#4E97D1` to `#FF5733`).
     - **Primary Buttons/Tabs/Checkboxes/Links**: Set `theme.primaryColor` (e.g., `#4E97D1` to `#2A9D8F`).
     - **Background**: Set `theme.backgroundColor` (e.g., `#f5f7fa` to `#EAF4F4`).
     - **Primary Text**: Set `theme.textColor` (e.g., `#333333` to `#1A3C34`).
     - **Secondary Text**: Set `theme.secondaryColor` (e.g., `#2C5F8A` to `#264653`).
     - **Navbar Text/Icons**: Set `theme.navbar.textColor` (e.g., `#ffffff` to `#F8EDEB`).
   - Example: To change buttons and tabs to orange:
     ```json
     "theme": {
       "primaryColor": "#FF5733",
       "navbar": {
         "gradientStart": "#FF5733",
         "gradientEnd": "#C82333"
       }
     }
     ```
2. **Test Changes**:
   - Run `npm run serve`.
   - Verify navbar gradient, button colors, and screen styles in the browser.
   - Check console for `Configuration loaded: Object` in `main.js`.
3. **Deploy**:
   - Run `npm run build` to include updated config.
   - Deploy `/public/config/*` to the server, ensuring accessibility.

### Creating a New Use Case
To configure a new chatbot (e.g., "EcoChat"):
1. **Duplicate Config**:
   - Copy `genie-ai-config.json` to `/public/config/ecochat-config.json`.
   - Update:
     ```json
     "app": {
       "title": "EcoChat",
       "icon": { "type": "file", "value": "/public/config/ecochat-icon.svg" }
     },
     "theme": {
       "primaryColor": "#28A745",
       "secondaryColor": "#1E7E34",
       "backgroundColor": "#E6F4EA",
       "textColor": "#1A3C34",
       "navbar": {
         "gradientStart": "#28A745",
         "gradientEnd": "#1E7E34",
         "textColor": "#ffffff"
       }
     },
     "features": {
       "chat": {
         "welcomeMessage": "Welcome to EcoChat, your sustainability assistant!",
         "botName": "Eco"
       }
     }
     ```
2. **Add Icon**:
   - Place `ecochat-icon.svg` in `/public/config/`.
3. **Update `main.js`**:
   - Set `VUE_APP_CONFIG_FILE=/public/config/ecochat-config.json` in `.env`:
     ```javascript
     const configFile = process.env.VUE_APP_CONFIG_FILE || '/public/config/genie-ai-config.json';
     const response = await fetch(configFile);
     ```
4. **Test and Deploy**:
   - Run `npm run serve` to verify styles and chatbot settings.
   - Deploy updated config and SVG files.

## How Configuration Works

### Loading and Distribution
- **Loading** (`main.js`):
  - Fetches the config file using `fetch` and merges with defaults:
    ```javascript
    let config = {
      app: { title: 'GENIE.AI Chatbot', icon: { type: 'file', value: '/public/config/default-icon.svg' } },
      theme: { primaryColor: '#4E97D1', secondaryColor: '#2C5F8A', backgroundColor: '#f5f7fa', textColor: '#333333', navbar: { gradientStart: '#4E97D1', gradientEnd: '#2C5F8A', textColor: '#ffffff' } },
      features: { chat: { welcomeMessage: 'Welcome to GENIE.AI!', botName: 'Genie' } },
      custom: {}
    };
    async function loadConfig() {
      try {
        const response = await fetch(process.env.VUE_APP_CONFIG_FILE || '/public/config/genie-ai-config.json');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        config = { ...config, ...data };
        console.log('Configuration loaded:', config);
      } catch (error) {
        console.error('Error loading config:', error);
      }
    }
    await loadConfig();
    app.config.globalProperties.$config = config;
    ```
- **Distribution** (`App.vue`):
  - Passes `$config` to components via props:
    ```html
    <nav-bar-component :config="$config" />
    ```

### Applying Styles
- **CSS Variables** (`theme-variables.css`):
  - Maps config to variables:
    ```css
    :root {
      --bg-button-primary: var(--primary-color, #4E97D1);
      --text-secondary: var(--secondary-color, #2C5F8A);
      --bg-primary: var(--background-color, #f5f7fa);
      --text-primary: var(--text-color, #333333);
      --bg-navbar: linear-gradient(135deg, var(--navbar-gradient-start, #4E97D1), var(--navbar-gradient-end, #2C5F8A));
      --text-navbar: var(--navbar-text-color, #ffffff);
    }
    [data-theme="dark"] {
      --bg-primary: #1e1e1e;
      --text-primary: #f0f0f0;
      --text-secondary: #b3b3b3;
    }
    ```
- **Button Style Propagation**:
  - The `theme.primaryColor` is mapped to `--bg-button-primary`, which is applied to:
    - **Buttons**: Across all screens and components using `.primary-button`, `.login-button`, `.btn-primary`, or similar (e.g., "Login" button in `LoginScreen.vue`, "Save" button in `SettingsComponent.vue`).
    - **Tabs**: Active tabs in `SideBarComponent.vue` (`.tab-button-active`).
    - **Checkboxes**: In `LoginScreen.vue` (`.remember-me input`) and `RegisterScreen.vue` (`.terms input`).
    - **Links**: Navigation links like `.forgot-password-text`, `.login-link-text`, `.terms-link` in authentication screens.
    - **Spinners**: Loading indicators in `EmailVerificationScreen.vue` (`.spinner`).
  - This ensures a consistent primary color for interactive elements throughout the application, including:
    - **Authentication Screens**: `LoginScreen.vue`, `PasswordResetInitiateScreen.vue`, `RegistrationSuccessScreen.vue`, `EmailVerificationScreen.vue`, `PasswordResetConfirmScreen.vue`, `RegisterScreen.vue`.
    - **Navigation Components**: `SideBarComponent.vue` (tabs), `NavBarComponent.vue` (potential buttons).
    - **SettingsComponent.vue**: Buttons for saving theme/language settings.
    - **UserProfileComponent.vue**: Buttons for profile updates.
    - **Modal Dialogs**: Confirmation, error, or action dialogs using `.primary-button`.
    - **AdminDashboard.vue and Related Components**: Buttons for administrative actions (e.g., user management, analytics).
  - Example: Changing `theme.primaryColor` from `#4E97D1` to `#FF5733` updates all buttons, tabs, checkboxes, links, and spinners to orange across the app.
- **Component Styles**:
  - Components apply `--bg-button-primary` via scoped styles or `theme-components.css`:
    ```css
    .primary-button {
      background-color: var(--bg-button-primary);
      color: var(--text-button-primary, #ffffff);
    }
    ```

## Screen and Component-Specific Configuration Impacts

Configuration changes affect the following screens and components:
1. **LoginScreen.vue**:
   - **Title**: `app.title` in `.app-name` (e.g., `Huduma AI`).
   - **Icon**: `app.icon.value` in `.app-logo` (e.g., `/config/huduma-icon.svg`).
   - **Colors**:
     - Login button (`.login-button`): `--bg-button-primary` (`theme.primaryColor`).
     - Remember Me checkbox (`.remember-me input`): `--bg-button-primary`.
     - Forgot Password link (`.forgot-password-text`): `--bg-button-primary`.
     - Background: `--bg-primary` (`theme.backgroundColor`).
     - Text: `--text-primary` (`theme.textColor`), `--text-secondary` (`theme.secondaryColor`).
2. **PasswordResetInitiateScreen.vue**:
   - **Title**: `app.title`.
   - **Icon**: `app.icon.value`.
   - **Colors**:
     - Reset Password button (`.reset-initiate-button`): `--bg-button-primary`.
     - Login link (`.login-link-text`): `--bg-button-primary`.
     - Background: `--bg-primary`.
     - Text: `--text-primary`, `--text-secondary`.
3. **RegistrationSuccessScreen.vue**:
   - **Title**: `app.title`.
   - **Icon**: `app.icon.value`.
   - **Colors**:
     - Back to Login button (`.primary-button`): `--bg-button-primary`.
     - Resend Verification link (`.text-button`): `--bg-button-primary`.
     - Background: `--bg-primary`.
     - Text: `--text-primary`, `--text-secondary`.
4. **EmailVerificationScreen.vue**:
   - **Title**: `app.title`.
   - **Icon**: `app.icon.value`.
   - **Colors**:
     - Proceed/Back to Login button (`.primary-button`): `--bg-button-primary`.
     - Spinner (`.spinner`): `border-top-color: --bg-button-primary`.
     - Background: `--bg-primary`.
     - Text: `--text-primary`, `--text-secondary`.
5. **PasswordResetConfirmScreen.vue**:
   - **Title**: `app.title`.
   - **Icon**: `app.icon.value`.
   - **Colors**:
     - Validate Token/Reset Password buttons (`.validate-token-button`, `.reset-confirm-button`): `--bg-button-primary`.
     - Login link (`.login-link-text`): `--bg-button-primary`.
     - Background: `--bg-primary`.
     - Text: `--text-primary`, `--text-secondary`.
6. **RegisterScreen.vue**:
   - **Title**: `app.title`.
   - **Icon**: `app.icon.value`.
   - **Colors**:
     - Register button (`.register-button`): `--bg-button-primary`.
     - Accept Terms checkbox (`.terms input`): `--bg-button-primary`.
     - Login/Terms links (`.login-link-text`, `.terms-link`): `--bg-button-primary`.
     - Background: `--bg-primary`.
     - Text: `--text-primary`, `--text-secondary`.
7. **SideBarComponent.vue**:
   - **Colors**:
     - Active tabs (`.tab-button-active` for "Government Services", "Saved Chats"): `--bg-button-primary`.
     - Background: `--bg-primary`.
     - Text: `--text-primary`.
8. **SettingsComponent.vue**:
   - **Colors**:
     - Save buttons (e.g., for theme/language settings, typically `.primary-button`): `--bg-button-primary`.
     - Background: `--bg-primary`.
     - Text: `--text-primary`, `--text-secondary`.
9. **UserProfileComponent.vue**:
   - **Colors**:
     - Update profile buttons (e.g., `.primary-button`): `--bg-button-primary`.
     - Background: `--bg-primary`.
     - Text: `--text-primary`, `--text-secondary`.
10. **Modal Dialogs**:
    - **Colors**:
      - Action buttons (e.g., "Confirm", "Cancel" in `.primary-button`): `--bg-button-primary`.
      - Background: `--bg-primary`.
      - Text: `--text-primary`, `--text-secondary`.
11. **AdminDashboard.vue and Related Components**:
    - **Colors**:
      - Administrative buttons (e.g., user management, analytics, typically `.primary-button`): `--bg-button-primary`.
      - Background: `--bg-primary`.
      - Text: `--text-primary`, `--text-secondary`.

## Theme Integration

The framework supports light, dark, and system themes via `ThemeManager.js`. Configuration colors are applied consistently:
- **Primary Colors**: `theme.primaryColor` (`--bg-button-primary`) is uniform across modes for buttons, tabs, checkboxes, and links.
- **Navbar Gradient**: `theme.navbar.gradientStart` and `theme.navbar.gradientEnd` adjust for dark mode in `theme-variables.css`.
- **User Preference**: Set in `SettingsComponent.vue`, saved to `localStorage` (`theme` key).
- **System Theme**: Uses `prefers-color-scheme` if no preference is set.

## Troubleshooting

- **Config File Errors**:
  - Ensure `/public/config/*.json` and SVGs are in `dist/public/config/` after `npm run build`.
  - Check server configuration (e.g., Nginx: `location /public { root /path/to/dist; }`).
- **Component Errors**:
  - If `Cannot read properties of undefined`, verify `main.js` loads config and components use `this.$config` defensively.
- **Style Issues**:
  - Inspect elements (e.g., `.primary-button`, `.nav-bar`) to confirm `--bg-button-primary`, `--bg-navbar`.
  - Ensure `theme-variables.css` isn’t overridden.
- **Theme Conflicts**:
  - Check `localStorage.getItem('theme')` and `ThemeManager.js` (GitLab issue #1).

## Deployment

- **Build**: Include `/public/config/*.json` and SVGs in `npm run build`.
- **Server**: Serve `/public/config/*` as static files.
- **Environment**: Use `VUE_APP_CONFIG_FILE` for different configs.
- **Versioning**: Commit configs to Git, version as needed.

## Extending Configuration

To add new styles (e.g., sidebar colors):
1. Update schema:
   ```json
   "theme": {
     "sidebar": {
       "backgroundColor": { "type": "string", "default": "#f0f2f5" }
     }
   }
   ```
2. Update components:
   ```javascript
   computed: { sidebarBg() { return this.$config.theme.sidebar.backgroundColor; } }
   ```
3. Update `theme-variables.css`:
   ```css
   --sidebar-bg: var(--sidebar-background-color, #f0f2f5);
   ```
4. Deploy updated config and code.

## Summary

The GENIE.AI framework’s configuration system enables seamless customization of chatbot applications, with `theme.primaryColor` ensuring consistent button styles across all screens, modals, and components like `SettingsComponent.vue` and `AdminDashboard.vue`. Developers can tailor UI and features for new use cases by modifying JSON configs. For support, refer to GitLab issues or contact the development team.