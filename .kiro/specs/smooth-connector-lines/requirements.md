# Requirements Document

## Introduction

Replace the current straight dashed SVG connector lines between side thread anchors (highlighted text in the main content panel) and their corresponding margin note cards (in the right margin panel) with smooth S-curve/snake-style connector lines. The lines must update in real-time during scrolling rather than only after scrolling stops, and the rendering must be performant with no visible jank or lag.

## Glossary

- **Connector_Renderer**: The frontend module responsible for drawing SVG connector lines between anchor highlights and margin note cards
- **Anchor_Point**: The right edge midpoint of a highlighted text selection in the main panel that serves as the start point of a connector line
- **Note_Point**: The left edge of a margin note card header in the margin panel that serves as the end point of a connector line
- **S_Curve**: A cubic Bézier SVG path that forms a smooth snake-like curve between two points, with control points offset horizontally to create the characteristic S shape
- **Main_Panel**: The scrollable main content area (`#main-panel`) containing rendered markdown explanations
- **Margin_Panel**: The scrollable right-side panel (`#margin-note-panel`) containing side thread margin note cards
- **Connector_SVG**: The fixed-position full-viewport SVG overlay element (`#anchor-connector-svg`) used to render connector lines

## Requirements

### Requirement 1: S-Curve Path Rendering

**User Story:** As a user, I want connector lines to follow a smooth S-curve path from anchor text to margin notes, so that the visual connection feels organic and aesthetically pleasing.

#### Acceptance Criteria

1. WHEN a connector line is drawn between an Anchor_Point and a Note_Point, THE Connector_Renderer SHALL render an SVG `<path>` element using a cubic Bézier curve instead of a straight `<line>` element
2. THE Connector_Renderer SHALL compute Bézier control points by offsetting horizontally from the start and end points to produce a smooth S-shaped curve
3. WHEN the Anchor_Point and Note_Point are at the same vertical position, THE Connector_Renderer SHALL still produce a visually smooth curve without degenerating into a straight line
4. THE Connector_Renderer SHALL apply a dashed stroke style to the S-curve path consistent with the existing visual design (stroke color `var(--color-primary)`, stroke-width 2.5, dash pattern, opacity 0.6)

### Requirement 2: Real-Time Scroll Updates

**User Story:** As a user, I want connector lines to update their positions continuously while I scroll, so that the lines always visually connect the correct anchor and note without waiting for scrolling to stop.

#### Acceptance Criteria

1. WHEN the Main_Panel scroll position changes, THE Connector_Renderer SHALL update all connector line positions on every animation frame during the scroll
2. WHEN the Margin_Panel scroll position changes, THE Connector_Renderer SHALL update all connector line positions on every animation frame during the scroll
3. THE Connector_Renderer SHALL use `requestAnimationFrame` for scroll-driven updates instead of debounced `setTimeout` callbacks
4. WHEN scrolling stops, THE Connector_Renderer SHALL display connector lines in their final correct positions with no additional delay

### Requirement 3: Rendering Performance

**User Story:** As a user, I want connector line updates to be smooth and free of visual stutter, so that the interface feels responsive during scrolling and interaction.

#### Acceptance Criteria

1. THE Connector_Renderer SHALL complete a full redraw of all connector lines within a single animation frame (under 16ms at 60fps)
2. THE Connector_Renderer SHALL avoid triggering layout reflows during connector line updates by reading all DOM measurements before writing any SVG mutations
3. WHEN more than 10 margin notes are visible simultaneously, THE Connector_Renderer SHALL maintain smooth rendering without frame drops
4. THE Connector_Renderer SHALL reuse or update existing SVG path elements when possible instead of clearing and recreating all elements on every frame

### Requirement 4: Window Resize Handling

**User Story:** As a user, I want connector lines to reposition correctly when I resize the browser window, so that the visual connections remain accurate after layout changes.

#### Acceptance Criteria

1. WHEN the browser window is resized, THE Connector_Renderer SHALL recalculate and redraw all connector lines to match the new layout positions
2. THE Connector_Renderer SHALL use `requestAnimationFrame` for resize-driven updates to avoid excessive redraws during continuous resizing

### Requirement 5: Connector Visibility Management

**User Story:** As a user, I want connector lines to only appear for visible anchor-note pairs, so that off-screen connectors do not clutter the display or waste rendering resources.

#### Acceptance Criteria

1. WHEN an Anchor_Point is scrolled out of the visible area of the Main_Panel, THE Connector_Renderer SHALL hide the corresponding connector line
2. WHEN a Note_Point is scrolled out of the visible area of the Margin_Panel, THE Connector_Renderer SHALL hide the corresponding connector line
3. WHEN a previously hidden Anchor_Point or Note_Point scrolls back into view, THE Connector_Renderer SHALL redisplay the corresponding connector line

### Requirement 6: Backward Compatibility

**User Story:** As a user, I want all existing connector line behaviors to continue working after the visual upgrade, so that no functionality is lost.

#### Acceptance Criteria

1. THE Connector_Renderer SHALL draw connector lines for all side threads that have both a valid anchor highlight in the Main_Panel and a corresponding margin note card in the Margin_Panel
2. WHEN a new side thread is created, THE Connector_Renderer SHALL draw a connector line for the new thread after the margin note is rendered
3. WHEN a saved conversation is loaded, THE Connector_Renderer SHALL draw connector lines for all restored side threads after rendering completes
4. THE Connector_SVG overlay SHALL remain non-interactive (pointer-events: none) so that connector lines do not interfere with text selection or clicking
