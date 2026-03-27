import { exportHtml, hexToRgba, COLOR_PALETTE } from './src/exporters.js';
import type { Conversation } from './src/models.js';

// Test hexToRgba
console.log('hexToRgba:', hexToRgba('#e6194b', 0.25));

// Test empty conversation
const empty = exportHtml({
  id: '1', title: 'Test', mainThread: [], sideThreads: [],
  createdAt: new Date(), updatedAt: new Date()
} as Conversation);
console.log('Empty has DOCTYPE:', empty.includes('<!DOCTYPE html>'));
console.log('Empty has charset:', empty.includes('<meta charset="UTF-8">'));
console.log('Empty has title:', empty.includes('<title>Test</title>'));
console.log('Empty has empty note:', empty.includes('Empty conversation'));
console.log('Empty has style:', empty.includes('<style>'));

// Test with messages and side thread
const conv: Conversation = {
  id: '2', title: 'My <b>Chat</b>',
  mainThread: [
    { id: 'm1', role: 'user', content: 'Hello world', toolInvocations: [], timestamp: new Date() },
    { id: 'm2', role: 'assistant', content: '**Bold** and `code`', toolInvocations: [], timestamp: new Date() },
  ],
  sideThreads: [{
    id: 's1',
    anchor: { messageId: 'm2', startOffset: 0, endOffset: 4, selectedText: 'Bold' },
    messages: [
      { id: 'sq1', role: 'user', content: 'What is bold?', toolInvocations: [], timestamp: new Date() },
      { id: 'sa1', role: 'assistant', content: 'Bold is emphasis.', toolInvocations: [], timestamp: new Date() },
    ],
    collapsed: false,
  }],
  createdAt: new Date(), updatedAt: new Date()
};
const html = exportHtml(conv);
console.log('Has mark:', html.includes('<mark'));
console.log('Has margin note:', html.includes('margin-note'));
console.log('Title escaped:', html.includes('My &lt;b&gt;Chat&lt;/b&gt;'));
console.log('No input:', !html.includes('<input'));
console.log('No textarea:', !html.includes('<textarea'));
console.log('No nav:', !html.includes('<nav'));
console.log('No dialog:', !html.includes('<dialog'));
console.log('Has grid:', html.includes('grid-template-columns'));
console.log('COLOR_PALETTE length:', COLOR_PALETTE.length);
console.log('Has Q:', html.includes('<strong>Q:</strong>'));
console.log('Has A:', html.includes('<strong>A:</strong>'));
