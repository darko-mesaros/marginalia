# Requirements Document

## Introduction

This feature adds color-coded visual differentiation to side threads (margin notes) and their connector lines in Marginalia. A fixed palette of 32 colors is used to assign each side thread a unique color. The connector line linking a side thread to its anchored text in the main panel matches the thread's assigned color, making it easy to visually trace which margin note corresponds to which text selection.

## Glossary

- **Color_Palette**: A fixed, ordered array of 32 visually distinct CSS color values used for side thread color assignment.
- **Color_Index**: A zero-based integer position within the Color_Palette, assigned to each side thread based on its creation order.
- **Side_Thread**: A margin note conversation anchored to a specific text selection in the main panel.
- **Connector_Line**: An SVG path element drawn between an anchored text selection in the main panel and its corresponding margin note in the margin note panel.
- **Margin_Note**: The DOM element in the margin note panel that displays a side thread's question, response, and follow-up input.
- **Color_Assigner**: The frontend logic responsible for mapping each side thread to a Color_Index from the Color_Palette.

## Requirements

### Requirement 1: Define a 32-Color Palette

**User Story:** As a user, I want side threads to use a predefined set of visually distinct colors, so that each thread is easy to distinguish from its neighbors.

#### Acceptance Criteria

1. THE Color_Palette SHALL contain exactly 32 color values defined as valid CSS color strings.
2. THE Color_Palette SHALL contain colors that are visually distinguishable from one another against both the white surface background (#ffffff) and the light background (#f5f7fa) used in margin note headers.
3. THE Color_Palette SHALL be defined as a single constant array in the frontend JavaScript code.

### Requirement 2: Assign a Color to Each Side Thread

**User Story:** As a user, I want each side thread to have its own color, so that I can visually identify which margin note belongs to which text selection.

#### Acceptance Criteria

1. WHEN a new side thread is created, THE Color_Assigner SHALL assign the side thread a Color_Index equal to the side thread's zero-based position in the conversation's sideThreads array, modulo 32.
2. WHEN a saved conversation is loaded, THE Color_Assigner SHALL re-derive each side thread's Color_Index from its position in the sideThreads array, modulo 32.
3. THE Color_Assigner SHALL produce the same Color_Index for a given side thread regardless of whether the thread was just created or loaded from a saved conversation.

### Requirement 3: Apply Color to Margin Note Border

**User Story:** As a user, I want each margin note card to have a colored visual indicator, so that I can see at a glance which color belongs to which note.

#### Acceptance Criteria

1. WHEN a margin note is rendered, THE Margin_Note SHALL display a left border whose color matches the side thread's assigned Color_Palette entry.
2. THE Margin_Note SHALL use a left border width of 3 pixels to provide a visible but non-intrusive color indicator.
3. WHEN a margin note's color is applied, THE Margin_Note SHALL retain all existing styling (background, padding, border-radius) for elements not related to the color indicator.

### Requirement 4: Apply Color to Connector Lines

**User Story:** As a user, I want the connector line between a text selection and its margin note to match the note's color, so that I can visually trace the connection.

#### Acceptance Criteria

1. WHEN a connector line is drawn for a side thread, THE Connector_Line SHALL use a stroke color matching the side thread's assigned Color_Palette entry.
2. WHEN a connector line is redrawn (due to scroll, resize, or layout change), THE Connector_Line SHALL retain the same stroke color as previously assigned to its side thread.
3. THE Connector_Line SHALL retain the existing stroke-width (2.5px), stroke-dasharray (6 4), and opacity (0.6) styling for all properties not related to color.

### Requirement 5: Apply Color to Anchor Text Highlights

**User Story:** As a user, I want the highlighted text in the main panel to match the color of its corresponding margin note, so that the visual connection is clear from both sides.

#### Acceptance Criteria

1. WHEN anchor text is highlighted for a side thread, THE highlight background color SHALL use a semi-transparent version of the side thread's assigned Color_Palette entry.
2. WHEN multiple anchor highlights are visible, each highlight SHALL use the color corresponding to its own side thread, not a shared highlight color.
3. IF the CSS Custom Highlight API is not supported by the browser, THEN THE system SHALL degrade gracefully by not applying per-thread highlight colors.

### Requirement 6: Color Consistency Across Interactions

**User Story:** As a user, I want colors to remain stable as I interact with the conversation, so that the visual mapping does not change unexpectedly.

#### Acceptance Criteria

1. WHEN a new side thread is added to an existing conversation, THE Color_Assigner SHALL preserve the Color_Index of all previously created side threads.
2. WHEN the user scrolls the main panel or margin note panel, THE Connector_Line colors SHALL remain unchanged.
3. WHEN the user collapses or expands a margin note, THE Margin_Note border color and its corresponding Connector_Line color SHALL remain unchanged.
4. WHEN the browser window is resized, THE Connector_Line colors SHALL remain unchanged.

### Requirement 7: Palette Cycling for Conversations with More Than 32 Side Threads

**User Story:** As a user with many side threads, I want colors to cycle through the palette, so that every thread still gets a color even when there are more than 32.

#### Acceptance Criteria

1. WHEN a conversation contains more than 32 side threads, THE Color_Assigner SHALL wrap the Color_Index using modulo 32, cycling back to the beginning of the Color_Palette.
2. THE Color_Assigner SHALL assign Color_Index 0 to the 33rd side thread, Color_Index 1 to the 34th, and so on.
