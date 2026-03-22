# **Genie AI Color Scheme for El Salvador**

# **Overview**

We are building the MVP for **CENTA** (Centro Nacional de Tecnología Agropecuaria y Forestal) and **ENA** (Escuela Nacional de Agricultura) in El Salvador, the color scheme needs to bridge the gap between **traditional agriculture** and your **Genie AI** high-tech framework.

Based on current branding for these institutions and modern "Ag-Tech" standards for 2026, here is a suggested palette designed for accessibility and dual-mode support.

# ---

**🎨 The "Terra-Digital" Palette**

This scheme uses the **Cobalt Blue** from the Salvadoran national identity and **ENA's brand**, paired with a **Verdant Green** that signifies growth and AI-driven precision.

## **1\. Primary Colors (The Identity)**

* **Brand Blue (\#0073AA):** Direct from ENA's branding. It evokes trust, government stability, and water.  
* **Growth Green (\#2E7D32):** A deep, "Sacred Green" that represents El Salvador’s coffee and agricultural heritage.  
* **Genie Gold (\#FFB300):** An accent color for AI "insights" or "alerts," reminiscent of harvest and the sun.

## ---

**2\. Light Mode: "The Open Field"**

Designed for high legibility in outdoor environments (farmers checking the app in the sun).

| Element | Hex Code | Purpose |
| :---- | :---- | :---- |
| **Background** | \#F8F9FA | Clean, off-white to reduce glare. |
| **Surface** | \#FFFFFF | Cards and navigation elements. |
| **Primary Text** | \#1A1C1E | Deep charcoal for maximum contrast. |
| **Secondary Text** | \#44474E | Metadata and labels. |
| **AI Insights** | \#E3F2FD | Soft blue background for Genie AI chat bubbles. |

## ---

**3\. Dark Mode: "The Fertile Soil"**

Designed for power saving and "Tech-Forward" aesthetics, popular with the newer generation of digital-first agronomists in El Salvador.

| Element | Hex Code | Purpose |
| :---- | :---- | :---- |
| **Background** | \#0E1113 | "Midnight Carbon" – softer than pure black. |
| **Surface** | \#1C1F22 | Raised elements (cards, menus). |
| **Primary Text** | \#E2E2E6 | High-emphasis white (87% opacity). |
| **Accent Green** | \#81C784 | A desaturated green that "pops" without causing eye strain. |
| **Genie Glow** | \#4FC3F7 | A cyan/blue glow used for AI-active states. |

## ---

**💡 Implementation Strategies**

* **State-Based Gradients:** For Genie AI features, use a subtle gradient from \#0073AA to \#2E7D32. This visually represents the "Software (Blue) meeting the Soil (Green)."  
* **Accessibility (WCAG 2.1):** Ensure your "Action" buttons (like "Generate Report") maintain a 4.5:1 contrast ratio. For Dark Mode, avoid 100% saturated greens, as they can "vibrate" against dark backgrounds.  
* **Regional Context:** The blue-and-white motif is patriotic in El Salvador. Using the \#0073AA blue as your primary navigation bar color will immediately make the app feel "official" and trustworthy to local users.

# ---

**🎨 The CENTA/ENA Quickhelp Palette**

I've grouped the 8 buttons into semantic pairs. This prevents the UI from looking chaotic while still giving each button a distinct identity.

| Button Label | Semantic Group | Visual Logic | Light Mode (Hex) | Dark Mode (Hex) |
| :---- | :---- | :---- | :---- | :---- |
| **Plant Basic Grains** | Core Crops | **Verdant Green:** Represents staple crops and field growth. | \#2E7D32 | \#81C784 |
| **Grow Fruits & Veggies** | Core Crops | **Leaf Green:** A slightly warmer green for specialized produce. | \#558B2F | \#AED581 |
| **Manage Poultry & Pigs** | Livestock/Aqua | **Sienna Brown:** Earthy tones representing land animals. | \#8D6E63 | \#BCAAA4 |
| **Tilapia & Pond Care** | Livestock/Aqua | **Cobalt Water:** Blue tones distinct from your primary app branding. | \#0288D1 | \#4FC3F7 |
| **Diagnose Pest/Disease** | Alerts/Action | **Alert Orange:** High-visibility for urgent, negative states. | \#D84315 | \#FF8A65 |
| **Fertilizer & Soil Advice** | Alerts/Action | **Soil Amber:** Represents minerals, chemistry, and soil prep. | \#F9A825 | \#FFF59D |
| **Start/Manage Apiary** | Specialty/Ops | **Honey Gold:** Directly maps to bees, wax, and honey. | \#F57F17 | \#FFE082 |
| **Harvest & Storage** | Specialty/Ops | **Silo Teal:** Represents machinery, metal silos, and structure. | \#00838F | \#4DD0E1 |

## ---

**🛠️ UI Implementation Notes**

* **Light Mode Execution:** To keep the interface clean, use a crisp white background for the buttons (\#FFFFFF) with a subtle 1px border matching the Light Mode hex code. Use the Light Mode hex for the icon and the button text. This ensures high legibility in direct El Salvador sun.  
* **Dark Mode Execution:** Use a dark surface background (\#1C1F22). Apply the Dark Mode hex codes to the icon and text. To make it feel like a modern AI framework, add a very soft drop-shadow or "glow" behind the icon using the same color at 20% opacity.  
* **Loading States:** When a user taps a button and the hidden prompt payload is sent to the LLM, you can pulse the specific button's color to indicate the AI is "thinking" about that specific category.

Since you are bringing this MVP to life soon, would you like me to generate the functional component code (e.g., in Vue 3 or Flutter) that maps this exact color dictionary to your button grid?