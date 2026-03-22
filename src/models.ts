import { randomUUID } from "node:crypto";

// --- Conversation State Models ---

export type MessageRole = "user" | "assistant";

export interface ToolInvocation {
  toolName: string;
  inputData: Record<string, unknown>;
  result: string;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  toolInvocations: ToolInvocation[];
  timestamp: Date;
}

export interface AnchorPosition {
  messageId: string;
  startOffset: number;
  endOffset: number;
  selectedText: string;
}

export interface SideThread {
  id: string;
  anchor: AnchorPosition;
  messages: Message[];
  collapsed: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  mainThread: Message[];
  sideThreads: SideThread[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;  // ISO 8601
  updatedAt: string;  // ISO 8601
  messageCount: number;
}

// --- Configuration Models ---

export interface SkillFile {
  id: string;
  name: string;
  content: string;
  order: number;
}

export interface MCPServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
}

export interface AppConfig {
  bedrockModelId: string;
  systemPrompt: string;
  skillFiles: SkillFile[];
  mcpServers: MCPServerConfig[];
}

// --- Factory Functions ---

export function createMessage(role: MessageRole, content: string): Message {
  return {
    id: randomUUID(),
    role,
    content,
    toolInvocations: [],
    timestamp: new Date(),
  };
}

export function createSideThread(anchor: AnchorPosition): SideThread {
  return {
    id: randomUUID(),
    anchor,
    messages: [],
    collapsed: false,
  };
}

export function createConversation(): Conversation {
  const now = new Date();
  return {
    id: randomUUID(),
    title: "Untitled Conversation",
    mainThread: [],
    sideThreads: [],
    createdAt: now,
    updatedAt: now,
  };
}

// --- Conversation Helpers ---

export function getSideThread(
  conversation: Conversation,
  threadId: string
): SideThread | undefined {
  return conversation.sideThreads.find((t) => t.id === threadId);
}

export function addSideThread(
  conversation: Conversation,
  anchor: AnchorPosition
): SideThread {
  const thread = createSideThread(anchor);
  conversation.sideThreads.push(thread);
  return thread;
}

// --- System Prompt Assembly ---

export function getFullSystemPrompt(config: AppConfig): string {
  const parts = [config.systemPrompt];
  const sorted = [...config.skillFiles].sort((a, b) => a.order - b.order);
  for (const sf of sorted) {
    parts.push(`\n\n--- Skill: ${sf.name} ---\n${sf.content}`);
  }
  return parts.join("\n");
}
