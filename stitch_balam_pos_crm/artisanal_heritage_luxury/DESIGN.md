---
name: Artisanal Heritage Luxury
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#45464d'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#735c00'
  on-secondary: '#ffffff'
  secondary-container: '#fed65b'
  on-secondary-container: '#745c00'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#0b1c30'
  on-tertiary-container: '#75859d'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#ffe088'
  secondary-fixed-dim: '#e9c349'
  on-secondary-fixed: '#241a00'
  on-secondary-fixed-variant: '#574500'
  tertiary-fixed: '#d3e4fe'
  tertiary-fixed-dim: '#b7c8e1'
  on-tertiary-fixed: '#0b1c30'
  on-tertiary-fixed-variant: '#38485d'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  display-lg:
    fontFamily: Playfair Display
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Playfair Display
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
  headline-lg-mobile:
    fontFamily: Playfair Display
    fontSize: 28px
    fontWeight: '600'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Playfair Display
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 8px
  container-max: 1440px
  gutter: 24px
  margin-desktop: 48px
  margin-mobile: 16px
---

## Brand & Style

The brand personality is rooted in the intersection of artisanal heritage and modern commerce. This design system prioritizes an editorial aesthetic, moving away from generic SaaS "flatness" toward a more textured, sophisticated environment that reflects the high-value physical goods sold through the platform.

The visual style blends **Minimalism** with **Corporate/Modern** precision. It utilizes heavy whitespace to provide a sense of luxury and "breathing room," punctuated by sharp, high-contrast typography and precise golden accents. Every interaction should feel intentional and quiet, evoking the atmosphere of a high-end boutique where technology serves the craft rather than distracting from it.

## Colors

The palette is anchored by **Midnight Navy**, providing a deep, authoritative foundation that replaces standard blacks for a more "expensive" feel. **Champagne Gold** is used sparingly as an action color or a mark of distinction, reserved for primary CTAs, active states, and premium indicators.

Backgrounds utilize **Off-White** and very light **Slate Grays** to create a layered, "paper-like" surface quality. Success, error, and warning states should be muted and integrated into the primary palette (e.g., a desaturated sage green for success) to maintain the sophisticated tonal balance.

## Typography

This design system uses a high-contrast typographic pairing. **Playfair Display** serves as the primary voice for brand moments, page titles, and high-level headers, providing the "editorial" flair and classic luxury associated with bespoke tailoring.

**Inter** handles all functional data, body copy, and UI labels. This ensures that the POS remains highly legible and efficient during rapid transactions. Labels should frequently use uppercase styling with increased letter spacing to create an "indexical" look, reminiscent of luxury garment tags and inventory ledgers.

## Layout & Spacing

The layout follows a **Fixed Grid** philosophy for desktop interfaces to maintain a centered, stable composition that feels grounded and premium. It uses a 12-column system with generous 48px outer margins to create a focused viewing area. 

Spacing follows a strict 8px rhythm. For editorial sections, padding should be increased (double or triple the standard) to emphasize content hierarchy. On mobile devices, the grid collapses to 4 columns with tighter 16px margins, ensuring the POS remains functional on tablets and handheld devices without losing the "upscale" sense of space.

## Elevation & Depth

Depth is achieved through **Tonal Layers** and **Ambient Shadows**. This design system avoids harsh drop shadows, opting instead for multi-layered, low-opacity blurs that mimic natural light falling on fine stationery.

1.  **Level 0 (Base):** Off-White (#F8FAFC) surface.
2.  **Level 1 (Cards/Sidebar):** Pure white background with a 1px border in a very light Slate Gray.
3.  **Level 2 (Dropdowns/Modals):** A soft shadow with a 10% opacity Midnight Navy tint and a 12px blur radius.

Background blurs (glassmorphism) may be used for overlay headers or navigation bars to maintain context of the underlying "inventory" while adding a modern, technical edge.

## Shapes

The shape language is **Soft** and restrained. A 4px to 6px border radius is applied to buttons, input fields, and card containers. This provides a subtle "human" touch to the interface without becoming overly casual or "bubbly."

Sharp 0px corners are reserved for decorative elements, such as image frames or high-contrast dividers, to maintain a structured, architectural feel. Secondary elements like tags or "status chips" may use a slightly higher radius to differentiate them from functional inputs.

## Components

### Buttons
Primary buttons use the **Midnight Navy** background with white text for maximum authority. The **Champagne Gold** is used for "Gold-tier" actions or "Complete Sale" buttons to signify value. Hover states should involve a subtle shift in color depth rather than a dramatic change.

### Input Fields
Inputs are defined by a bottom-only border or a very subtle 1px frame in Slate Gray. Focus states should transition the border to Midnight Navy with no "outer glow," keeping the look crisp and clean.

### Cards
Cards are the primary container for product entries. They feature no heavy borders; instead, they use a subtle change in background color (pure white against the off-white base) and a very soft ambient shadow to define their boundaries.

### Lists & Tables
In a POS context, lists must be dense but legible. Use thin, 1px dividers in a faint gray. For "Luxury CRM" profiles, incorporate a larger Playfair Display serif for the customer's name to make the record feel like a personal guest book entry.

### Chips & Badges
Used for garment sizes or stock status. These should be minimalist—light gray backgrounds with navy text, or navy backgrounds with gold text for "Limited Edition" or "Bespoke" tags.