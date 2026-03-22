# Requirements Document

## Introduction

Marginalia is a web-based LLM explainer tool that lets users ask technical questions and receive structured explanations rendered as a document. Users can select any portion of the explanation text and ask follow-up "side questions" that appear as margin notes anchored to the selected passage — similar to Google Docs comments, but where the comments are LLM-generated answers. Multiple independent side threads can coexist alongside the main explanation. Crucially, all margin note context is folded back into the main conversation, so subsequent questions benefit from the full context of prior drill-downs without repetition.

## Glossary

- **Main_Panel**: The primary content area that displays the LLM-generated explanation as a rendered document
- **Margin_Note**: A side panel element anchored to a specific text selection in the Main_Panel, containing an LLM response to a user's follow-up question about that selected passage
- **Side_Thread**: An independent conversation thread attached to a Margin_Note, allowing further follow-up questions scoped to the anchored text
- **Context_Window**: The assembled conversation context sent to the LLM, including the main explanation and all Margin_Note exchanges
- **Text_Selection**: A user-highlighted portion of text within the Main_Panel that serves as the anchor point for a Margin_Note
- **Main_Thread**: The primary conversation flow in the Main_Panel, including the initial question and any continuation questions asked below the explanation
- **Input_Bar**: The text input field at the top of the interface where the user types the initial question
- **Continuation_Input**: The text input field at the bottom of the Main_Panel for asking follow-up questions in the Main_Thread
- **LLM_Backend**: The language model service (e.g., Amazon Bedrock) that generates responses for both main explanations and Margin_Note answers
- **Anchor_Position**: The location within the Main_Panel text where a Margin_Note is visually attached
- **System_Prompt**: The built-in base instruction set that governs how the LLM_Backend generates responses, defining the default persona, tone, and explanation style
- **Skill_File**: A user-provided markdown or text file containing additional instructions, context, or domain knowledge that gets appended to the System_Prompt to customize LLM behavior for specific topics or use cases
- **MCP_Server**: A Model Context Protocol server that exposes external tools and data sources to the LLM_Backend, enabling it to call functions, query APIs, or access resources beyond its training data
- **MCP_Tool**: A specific capability exposed by an MCP_Server that the LLM_Backend can invoke during response generation to fetch data, perform calculations, or interact with external systems

## Requirements

### Requirement 1: Initial Question Submission

**User Story:** As a user, I want to type a technical question into an input bar and receive a detailed explanation, so that I can learn about a topic in a structured document format.

#### Acceptance Criteria

1. THE Input_Bar SHALL accept free-form text input for the user's question
2. WHEN the user submits a question via the Input_Bar, THE LLM_Backend SHALL generate an explanation and THE Main_Panel SHALL render the response as formatted text
3. WHILE the LLM_Backend is generating a response, THE Main_Panel SHALL display a loading indicator
4. IF the LLM_Backend fails to generate a response, THEN THE Main_Panel SHALL display an error message describing the failure

### Requirement 2: Main Panel Explanation Rendering

**User Story:** As a user, I want the LLM explanation rendered as a readable document in the main panel, so that I can read and study the content comfortably.

#### Acceptance Criteria

1. THE Main_Panel SHALL render LLM responses as formatted text with support for headings, paragraphs, code blocks, and inline code
2. THE Main_Panel SHALL be scrollable when the explanation content exceeds the visible area
3. THE Main_Panel SHALL render all text as selectable content so that users can highlight any portion

### Requirement 3: Text Selection for Side Questions

**User Story:** As a user, I want to select any portion of the explanation text and ask a follow-up question about that specific passage, so that I can drill into details without losing the main thread.

#### Acceptance Criteria

1. WHEN the user selects text within the Main_Panel, THE system SHALL display an option to ask a follow-up question about the Text_Selection
2. WHEN the user submits a follow-up question for a Text_Selection, THE system SHALL create a new Margin_Note anchored to the Anchor_Position of the selected text
3. THE system SHALL include the Text_Selection content as context when sending the follow-up question to the LLM_Backend
4. IF the user submits a follow-up question with an empty Text_Selection, THEN THE system SHALL prevent submission and display a validation message

### Requirement 4: Margin Note Display

**User Story:** As a user, I want follow-up answers to appear as margin notes alongside the main explanation, so that I can see drill-down answers without interrupting the main content flow.

#### Acceptance Criteria

1. THE Margin_Note SHALL be displayed in a side panel adjacent to the Main_Panel, visually anchored to the corresponding Anchor_Position
2. THE Margin_Note SHALL display the user's follow-up question and the LLM_Backend response
3. THE Margin_Note SHALL display the original Text_Selection that the note is anchored to
4. WHILE the LLM_Backend is generating a Margin_Note response, THE Margin_Note SHALL display a loading indicator
5. IF the LLM_Backend fails to generate a Margin_Note response, THEN THE Margin_Note SHALL display an error message

### Requirement 5: Multiple Independent Side Threads

**User Story:** As a user, I want to create multiple margin notes on different parts of the explanation, so that I can explore several sub-topics independently.

#### Acceptance Criteria

1. THE system SHALL support multiple Margin_Notes existing simultaneously, each anchored to a different Text_Selection
2. THE system SHALL visually distinguish separate Margin_Notes so that each note is identifiable as an independent Side_Thread
3. WHEN multiple Margin_Notes overlap in vertical position, THE system SHALL arrange the notes to avoid visual overlap while maintaining proximity to the Anchor_Position
4. THE system SHALL allow the user to collapse or expand individual Margin_Notes

### Requirement 6: Side Thread Follow-Up Questions

**User Story:** As a user, I want to ask additional follow-up questions within a margin note thread, so that I can continue drilling deeper into a specific sub-topic.

#### Acceptance Criteria

1. THE Margin_Note SHALL include a text input field for submitting additional follow-up questions within the same Side_Thread
2. WHEN the user submits a follow-up question within a Side_Thread, THE LLM_Backend SHALL generate a response using the Side_Thread conversation history as context
3. THE Margin_Note SHALL display the full Side_Thread conversation history in chronological order

### Requirement 7: Context Threading

**User Story:** As a user, I want the LLM to be aware of all my margin note conversations when I continue asking questions in the main thread, so that I get coherent answers without repeating myself.

#### Acceptance Criteria

1. WHEN the user submits a question via the Continuation_Input, THE Context_Window SHALL include the main explanation, all Margin_Note exchanges, and the new question
2. THE Context_Window SHALL preserve the relationship between each Margin_Note and the Text_Selection it is anchored to
3. THE LLM_Backend SHALL receive the assembled Context_Window so that responses reflect awareness of all prior Side_Thread discussions
4. WHEN a new Margin_Note is created, THE Context_Window SHALL include all existing Margin_Note exchanges as context for the new Margin_Note response

### Requirement 8: Main Thread Continuation

**User Story:** As a user, I want to continue asking questions below the main explanation, so that I can extend the conversation while benefiting from all the context gathered through margin notes.

#### Acceptance Criteria

1. THE Continuation_Input SHALL be displayed below the Main_Panel content
2. WHEN the user submits a question via the Continuation_Input, THE LLM_Backend SHALL generate a response and THE Main_Panel SHALL append the response below the existing content
3. THE Main_Panel SHALL visually separate each continuation exchange from the previous content

### Requirement 9: LLM Backend Integration

**User Story:** As a developer, I want the tool to integrate with Amazon Bedrock as the LLM backend, so that I can leverage managed LLM services for generating responses.

#### Acceptance Criteria

1. THE LLM_Backend SHALL send requests to Amazon Bedrock for generating both main explanations and Margin_Note responses
2. THE LLM_Backend SHALL support configuring the Bedrock model identifier via application configuration
3. IF the LLM_Backend receives a rate limit or throttling response from Amazon Bedrock, THEN THE LLM_Backend SHALL retry the request with exponential backoff and inform the user of the delay
4. THE LLM_Backend SHALL stream responses from Amazon Bedrock so that text appears incrementally in the Main_Panel and Margin_Notes

### Requirement 10: Responsive Layout

**User Story:** As a user, I want the interface to adapt to different screen sizes, so that I can use the tool on various devices.

#### Acceptance Criteria

1. THE system SHALL arrange the Main_Panel and Margin_Notes side by side on screens wider than 1024 pixels
2. WHEN the screen width is 1024 pixels or narrower, THE system SHALL stack Margin_Notes below the Main_Panel content
3. THE Main_Panel SHALL occupy a minimum of 60 percent of the available width when displayed alongside Margin_Notes

### Requirement 11: System Prompt and Skill Files

**User Story:** As a user, I want to customize how the LLM explains topics by providing additional context files and skills, so that I can tailor the tool's behavior to my domain expertise and preferred explanation style.

#### Acceptance Criteria

1. THE system SHALL include a built-in System_Prompt that defines the default explanation persona, tone, and formatting instructions for the LLM_Backend
2. THE system SHALL allow users to add one or more Skill_Files that extend the System_Prompt with additional instructions, domain context, or behavioral rules
3. WHEN Skill_Files are configured, THE system SHALL append their content to the System_Prompt before sending requests to the LLM_Backend
4. THE system SHALL provide a settings interface where users can manage Skill_Files by adding, removing, or reordering them
5. THE system SHALL validate that Skill_Files are readable text or markdown files before accepting them
6. THE System_Prompt and all active Skill_Files SHALL be included in every request to the LLM_Backend, for both Main_Thread and Side_Thread interactions

### Requirement 12: MCP Tool Integration

**User Story:** As a user, I want the LLM to be able to use external tools via MCP servers, so that explanations can include live data, code execution results, or information from external sources.

#### Acceptance Criteria

1. THE system SHALL support connecting to one or more MCP_Servers via the Model Context Protocol
2. THE system SHALL allow users to configure MCP_Server connections through application settings, specifying the server command and arguments
3. WHEN an MCP_Server is configured, THE LLM_Backend SHALL discover available MCP_Tools from the server and make them available for use during response generation
4. THE LLM_Backend SHALL be able to invoke MCP_Tools during generation of both Main_Thread and Side_Thread responses
5. WHEN the LLM_Backend invokes an MCP_Tool, THE system SHALL display the tool invocation and result within the response content so the user can see what tools were used
6. IF an MCP_Server connection fails, THEN THE system SHALL display an error message and continue operating without the unavailable tools
