import { Item, ItemHeading, ItemTodo } from './models';

export interface ParseResult {
    items: Item[];
    archivedItems: Item[];
}

export function parseMarkdown(content: string): ParseResult {
    const lines = content.split('\n');
    const items: Item[] = [];
    const archivedItems: Item[] = [];
    let currentIndex = 0;
    let currentNote: string[] = [];
    let collectingNote = false;
    let lastItem: Item | null = null;
    let inArchiveSection = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        // Handle Note Block
        if (trimmedLine.startsWith('```plane')) {
            collectingNote = true;
            currentNote = [];
            continue;
        }
        if (collectingNote) {
            if (trimmedLine.startsWith('```')) {
                collectingNote = false;
                if (lastItem) {
                    lastItem.note = currentNote.join('\n');
                }
            } else {
                currentNote.push(line.trim()); // Keep indentation? Spec says "ノートはmdには存在するがメインビューには表示しない"
            }
            continue;
        }

        // Handle Heading
        if (trimmedLine.startsWith('## ')) {
            const title = trimmedLine.substring(3).trim();
            
            // Check if this is the Archive heading
            if (title === 'Archive') {
                inArchiveSection = true;
                continue; // Don't add Archive heading to items
            }
            
            // If we encounter another heading after Archive, stop archive section
            inArchiveSection = false;
            
            const heading = new ItemHeading(title, currentIndex++);
            items.push(heading);
            lastItem = heading;
            continue;
        }

        // Handle Todo
        const todoMatch = line.match(/^(\s*)-\s\[([ x])\]\s(.*)$/);
        if (todoMatch) {
            const indentStr = todoMatch[1];
            const isChecked = todoMatch[2] === 'x';
            const title = todoMatch[3];
            
            // Calculate indent level based on tabs or 4 spaces
            // Spec says: "インデントの表現にはタブ (\t) を使用"
            // But we should be robust. Let's assume 1 tab or 4 spaces = level 1
            let indent = 0;
            if (indentStr.includes('\t')) {
                 indent = indentStr.split('\t').length - 1;
            } else {
                 indent = Math.floor(indentStr.length / 4);
            }
            
            // Spec: "インデント0と1のみ"
            if (indent > 1) indent = 1;

            const todo = new ItemTodo(indent, title, currentIndex++, isChecked);
            
            // Add to appropriate list
            if (inArchiveSection) {
                // Archived items are always checked
                todo.isChecked = true;
                archivedItems.push(todo);
            } else {
                items.push(todo);
            }
            lastItem = todo;
            continue;
        }
    }

    return { items, archivedItems };
}

export function stringifyItems(items: Item[], archivedItems: Item[] = []): string {
    let result = '';

    for (const item of items) {
        if (item.type === 'heading') {
            result += `## ${item.title}\n`;
        } else if (item.type === 'todo') {
            const todo = item as ItemTodo;
            const indent = '\t'.repeat(todo.indent);
            const check = todo.isChecked ? 'x' : ' ';
            result += `${indent}- [${check}] ${todo.title}\n`;
        }

        if (item.note && item.note.trim().length > 0) {
            result += `    \`\`\`plane\n`;
            const noteLines = item.note.split('\n');
            for(const line of noteLines) {
                 result += `    ${line}\n`;
            }
            result += `    \`\`\`\n`;
        }
    }

    // Add Archive section if there are archived items
    if (archivedItems.length > 0) {
        result += `## Archive\n`;
        for (const item of archivedItems) {
            if (item.type === 'todo') {
                const todo = item as ItemTodo;
                // Archived items are always checked
                const indent = '\t'.repeat(todo.indent);
                result += `${indent}- [x] ${todo.title}\n`;
            }

            if (item.note && item.note.trim().length > 0) {
                result += `    \`\`\`plane\n`;
                const noteLines = item.note.split('\n');
                for(const line of noteLines) {
                     result += `    ${line}\n`;
                }
                result += `    \`\`\`\n`;
            }
        }
    }

    return result;
}
