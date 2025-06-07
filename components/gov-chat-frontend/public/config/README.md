# GENIE.AI Framework Configuration Guide

This document provides comprehensive details for developers on managing and changing configurations for the GENIE.AI chatbot framework, used in applications like Huduma AI. The configuration is driven by a JSON file (`genie-ai-config.json`) that customizes the application’s title, icon, color scheme, and feature settings. This guide covers the configuration file’s structure, how to modify it, integration with the Vue 3 application, and deployment considerations.

## Overview

The GENIE.AI framework is designed to support customizable chatbot applications. Huduma AI is the first use case, with configurations managed via `/public/config/genie-ai-config.json`. This file is loaded at runtime by `main.js`, passed to components like `NavBarComponent.vue`, and used to style the navbar via CSS variables in `theme-variables.css` and `theme-components.css`.

Key configuration aspects:
- **Application Title**: Sets the title displayed in the navbar (e.g., `Huduma AI`).
- **Application Icon**: Specifies an SVG icon (file or inline) for the navbar logo.
- **Color Scheme**: Defines primary, secondary, and navbar-specific colors (gradient and text).
- **Features**: Configures chatbot-specific settings (e.g., welcome message, bot name).
- **Custom Settings**: Allows arbitrary key-value pairs for use case-specific needs.

## Configuration File: `genie-ai-config.json`

The configuration file is located at `/public/config/genie-ai-config.json` and follows a JSON schema for validation and extensibility. Below is the structure and key sections:

### Schema
- **`$schema`**: References JSON Schema draft-07 for validation (`http://json-schema.org/draft-07/schema#`).
- **Type**: Object with required sections: `app`, `theme`.
- **Properties**:
  - **`app`**:
    - `title` (string): Navbar title (default: `GENIE.AI Chatbot`).
    - `icon` (object):
      - `type` (enum: `file`, `inline`): Source type for the SVG icon (default: `file`).
      - `value` (string): Path to SVG file (e.g., `/public/config/huduma-icon.svg`) or inline SVG content.
  - **`theme`**:
    - `primaryColor` (string): Primary color for buttons/accents (hex, e.g., `#4E97D1`).
    - `secondaryColor` (string): Secondary color for highlights (hex, e.g., `#2C5F8A`).
    - `backgroundColor` (string): Main content background (hex, e.g., `#f5f7fa`).
    - `textColor` (string): Primary text color (hex, e.g., `#333333`).
    - `navbar` (object):
      - `gradientStart` (string): Start color for navbar gradient (hex, e.g., `#4E97D1`).
      - `gradientEnd` (string): End color for navbar gradient (hex, e.g., `#2C5F8A`).
      - `textColor` (string): Navbar text/icon color (hex, e.g., `#ffffff`).
  - **`features`**:
    - `chat` (object):
      - `welcomeMessage` (string): Chatbot welcome message (default: `Welcome to GENIE.AI!`).
      - `botName` (string): Chatbot name (default: `Genie`).
  - **`custom`**: Arbitrary key-value pairs for use case-specific settings (e.g., API endpoints).

### Example Configuration (Huduma AI)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
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

## Managing Configurations

### Modifying `genie-ai-config.json`
1. **Edit the File**:
   - Open `/public/config/genie-ai-config.json` in a text editor.
   - Update fields like `app.title`, `app.icon.value`, `theme.navbar.gradientStart`, etc.
   - For a new icon, place the SVG file in `/public/config` and update `app.icon.value` (e.g., `/public/config/new-icon.svg`).
   - Validate changes using a JSON schema validator to ensure compliance with the schema.
2. **Test Changes**:
   - Run the development server (`npm run serve`).
   - Verify the navbar displays the updated title, icon, and colors in the browser.
   - Check the console log for `Configuration loaded: Object` in `main.js`.
3. **Deploy Changes**:
   - Ensure `/public/config/genie-ai-config.json` and any referenced SVG files are included in the build (`npm run build`).
   - Deploy the updated `/public` folder to your server, verifying the files are accessible at `/public/config/*`.

### Creating a New Use Case
To configure a new chatbot application (e.g., NOOR-AI-AL-TAFSIR):
1. **Copy the Config File**:
   - Duplicate `genie-ai-config.json` to `/public/config/noor-ai-config.json`.
   - Update `app.title` (e.g., `NOOR-AI-AL-TAFSIR`), `app.icon.value` (e.g., `/public/config/noor-icon.svg`), and `theme` colors as needed.
2. **Update `main.js`**:
   - Modify `loadConfig` to fetch the new config file based on an environment variable or route:
     ```javascript
     async function loadConfig() {
       try {
         const configFile = process.env.VUE_APP_CONFIG_FILE || '/public/config/genie-ai-config.json';
         const response = await fetch(configFile);
         if (!response.ok) {
           throw new Error(`HTTP error! status: ${response.status}`);
         }
         const data = await response.json();
         config = { ...config, ...data };
         console.log('Configuration loaded:', config);
       } catch (error) {
         console.error('Error loading config:', error);
         console.warn('Using default configuration');
       }
     }
     ```
   - Set `VUE_APP_CONFIG_FILE=/public/config/noor-ai-config.json` in your `.env` file.
3. **Deploy**:
   - Include the new config and icon files in the deployment.
   - Test the new use case to ensure the navbar and chatbot reflect the updated settings.

## Integration with Vue 3 Application

### Loading Configuration
- **File**: `main.js`
- **Process**:
  - Fetches `/public/config/genie-ai-config.json` using `fetch`.
  - Merges the fetched config with a default configuration to handle missing files or properties.
  - Stores the config in `app.config.globalProperties.$config` for global access.
- **Key Code**:
  ```javascript
  let config = {
    app: { title: 'Huduma AI', icon: { type: 'file', value: '/public/config/huduma-icon.svg' } },
    theme: { primaryColor: '#4E97D1', secondaryColor: '#2C5F8A', backgroundColor: '#f5f7fa', textColor: '#333333', navbar: { gradientStart: '#4E97D1', gradientEnd: '#2C5F8A', textColor: '#ffffff' } },
    features: { chat: { welcomeMessage: 'Welcome to Huduma AI, your public service assistant!', botName: 'Huduma' } },
    custom: {}
  };
  async function loadConfig() {
    try {
      const response = await fetch('/public/config/genie-ai-config.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      config = { ...config, ...data };
      console.log('Configuration loaded:', config);
    } catch (error) {
      console.error('Error loading config:', error);
      console.warn('Using default configuration');
    }
  }
  await loadConfig();
  const app = createApp(App);
  app.config.globalProperties.$config = config;
  ```

### Passing Configuration to Components
- **File**: `App.vue`
- **Process**:
  - Passes the global `$config` to `NavBarComponent.vue` via the `:config="$config"` prop.
- **Key Code**:
  ```html
  <nav-bar-component :is-sidebar-open="isSidebarOpen" @toggleSidebar="toggleSidebar"
    @openAnalytics="showAnalytics = true" @openProfile="showUserProfile = true"
    @openSettings="showSettings = true" @logout="handleLogout"
    @open-admin="showAdminDashboard = true" :config="$config" />
  ```

### Using Configuration in Navbar
- **File**: `NavBarComponent.vue`
- **Process**:
  - Uses `config.app.title` for the navbar title.
  - Renders `config.app.icon` as an `<img>` (for `type: file`) or `<span v-html>` (for `type: inline`), with a fallback SVG if the config is invalid.
  - Applies navbar colors via CSS variables set in `theme-variables.css`.
- **Key Code**:
  ```html
  <h1 class="brand-name hide-on-mobile">{{ config?.app?.title || 'Huduma AI' }}</h1>
  <img v-if="config?.app?.icon?.type === 'file' && config.app.icon.value" :src="config.app.icon.value" class="govt-logo" alt="App Icon" />
  <span v-else-if="config?.app?.icon?.type === 'inline' && config.app.icon.value" v-html="config.app.icon.value" class="govt-logo"></span>
  <svg v-else class="govt-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="40" height="40">...</svg>
  ```

### Applying Navbar Colors
- **Files**: `theme-variables.css`, `theme-components.css`
- **Process**:
  - `theme-variables.css` defines `--bg-navbar` using `--navbar-gradient-start` and `--navbar-gradient-end` from the config, with fallbacks for light, dark, and system themes.
  - `theme-components.css` applies `--bg-navbar` and `--text-navbar` to the `.nav-bar` class.
- **Key Code** (`theme-variables.css`):
  ```css
  :root {
    --bg-navbar: linear-gradient(135deg, var(--navbar-gradient-start, #4E97D1), var(--navbar-gradient-end, #2C5F8A));
    --text-navbar: #ffffff;
  }
  html[data-theme="dark"], [data-theme="dark"] {
    --bg-navbar: linear-gradient(135deg, var(--navbar-gradient-start, #2C5F8A), var(--navbar-gradient-end, #1e3c58));
  }
  ```
- **Key Code** (`theme-components.css`):
  ```css
  .nav-bar {
    background: var(--bg-navbar);
    color: var(--text-navbar);
  }
  ```

## Theme Integration

The GENIE.AI framework supports light, dark, and system themes, managed by `ThemeManager.js` and initialized in `main.js` and `App.vue`. The configuration’s navbar colors adapt to the theme via `theme-variables.css`.

- **User Preference**:
  - Users select a theme (light, dark, system) via `SettingsComponent.vue`, which saves it to `localStorage` (`theme` key).
  - The saved theme is applied on login, logout, or refresh, ensuring persistence.
- **System Theme**:
  - Used only when no user preference is set, detected via `prefers-color-scheme` in `ThemeManager.js`.
- **Integration with Config**:
  - Navbar colors (`theme.navbar.gradientStart`, `theme.navbar.gradientEnd`, `theme.navbar.textColor`) are applied regardless of theme, but `theme-variables.css` adjusts the gradient for dark mode if specified in the config.

## Troubleshooting

- **404 Error for Config File**:
  - Ensure `/public/config/genie-ai-config.json` and `/public/config/huduma-icon.svg` are in the `/public` folder and included in the build.
  - Check the server’s file serving configuration (e.g., Nginx) to ensure `/public/config/*` is accessible.
  - Verify the fetch URL in `main.js` matches the deployment path.
- **TypeError in NavBarComponent.vue**:
  - If `Cannot read properties of undefined (reading 'icon')` occurs, confirm `main.js` loads the config correctly and `NavBarComponent.vue` has defensive checks.
  - Check the console for `Configuration loaded: Object` to ensure the config was parsed.
- **Incorrect Navbar Colors**:
  - Inspect `.nav-bar` in DevTools to verify `--bg-navbar` and `--text-navbar` match the config.
  - Ensure `theme-variables.css` and `theme-components.css` are loaded and not overridden by other styles.
- **Theme Conflicts**:
  - If the navbar’s gradient doesn’t match the expected theme, check for conflicts in `ThemeManager.js`, `main.js`, and `App.vue` (see GitLab issue #1).
  - Verify `localStorage.getItem('theme')` reflects the user’s preference.

## Deployment Considerations

- **Build Process**:
  - Run `npm run build` to include `/public/config/*` in the output (`dist` folder).
  - Verify the `dist/public/config` directory contains `genie-ai-config.json` and any SVG icons.
- **Server Configuration**:
  - Configure the server to serve `/public/config/*` as static files (e.g., `location /public { root /path/to/dist; }` in Nginx).
  - Avoid redirects or error pages for `/public/config/*` to prevent JSON parsing errors.
- **Environment Variables**:
  - Use `VUE_APP_CONFIG_FILE` to specify different config files for multiple use cases (e.g., `.env.production`).
- **Version Control**:
  - Commit `/public/config/genie-ai-config.json` and SVG files to your repository.
  - Consider versioning config files for different use cases (e.g., `genie-ai-config-v2.json`).

## Extending the Configuration

To add new configuration options:
1. **Update Schema**:
   - Modify `genie-ai-config.json`’s `$schema` to include new properties (e.g., `theme.sidebar` for sidebar colors).
   - Update the `properties` section with new fields and defaults.
2. **Update Components**:
   - Access new properties in components (e.g., `this.$config.theme.sidebar.backgroundColor` in `SideBarComponent.vue`).
   - Add CSS variables in `theme-variables.css` (e.g., `--sidebar-bg`) and apply them in `theme-components.css`.
3. **Update Fallbacks**:
   - Add new defaults in `main.js`’s `config` object to handle missing properties.
4. **Test and Deploy**:
   - Validate the new schema, test the changes, and deploy the updated config and code.

## Example: Adding Sidebar Colors
1. Update `genie-ai-config.json`:
   ```json
   "theme": {
     "sidebar": {
       "backgroundColor": "#f0f2f5",
       "textColor": "#333333"
     }
   }
   ```
2. Update `theme-variables.css`:
   ```css
   :root {
     --sidebar-bg: var(--sidebar-background-color, #f0f2f5);
     --sidebar-text: var(--sidebar-text-color, #333333);
   }
   ```
3. Update `theme-components.css`:
   ```css
   .side-bar, .sidebar {
     background-color: var(--sidebar-bg);
     color: var(--sidebar-text);
   }
   ```
4. Update `main.js`:
   ```javascript
   let config = {
     // ... existing defaults
     theme: {
       // ... existing theme defaults
       sidebar: {
         backgroundColor: '#f0f2f5',
         textColor: '#333333'
       }
     }
   };
   ```

## Conclusion

The GENIE.AI framework’s configuration system is flexible and extensible, allowing developers to customize chatbot applications like Huduma AI with ease. By managing `genie-ai-config.json`, developers can tailor the UI and features for different use cases while ensuring robustness through fallback configurations and defensive coding practices.

For issues or enhancements, refer to the GitLab issues or contact the development team.