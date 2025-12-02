const vscode = acquireVsCodeApi();

// ============================================================
// Constants
// ============================================================
const Constants = {
    MAX_HISTORY_SIZE: 50,
    NOTIFICATION_DURATION: 1500,
    INDENT: {
        PARENT: 0,
        CHILD: 1,
        MAX: 1
    },
    ITEM_PADDING_BASE: 4,
    ITEM_PADDING_PER_INDENT: 20
};

// ============================================================
// Global State
// ============================================================
let items = [];
let archivedItems = []; // Archived items (separate from main items list)
let archivedSelectedIndices = new Set(); // Selection state for archived items
let archivedActiveIndex = -1; // Active index in archived items
let archivedAnchorIndex = -1; // Anchor index for shift-selection in archived items
let history = [];
let future = [];
let activeIndex = -1;
let anchorIndex = -1;
let selectedIndices = new Set();
let editingId = null; // ID of the item currently being edited
let isNewItem = false; // Track if the editing item is new
let ignoreBlur = false;
let isUndoingRedoing = false;
let isArchiveHidden = true;
let isPreSelected = false; // Pre-selection state: cursor is shown but inspector is hidden
let clipboard = []; // Clipboard for copy/paste operations
let isArchiveActive = false; // Whether archive section is active (for keyboard navigation)
let isArchiveHeaderSelected = false; // Whether the archive header is selected

// Settings
let taskMoveModifier = 'ctrl'; // 'ctrl' or 'alt'
let newItemTrigger = 'shift+enter'; // 'enter' or 'shift+enter'
let isMac = false;

// ============================================================
// ItemUtils - Utility functions for item operations
// ============================================================
const ItemUtils = {
    /**
     * Generate a unique ID for a new item
     * @returns {string} Unique ID
     */
    generateId() {
        return Date.now().toString() + Math.random().toString(36).substr(2, 9);
    },

    /**
     * Find the index of the Archive heading
     * @param {Array} itemList - The items array
     * @returns {number} Index of Archive heading, or -1 if not found
     */
    findArchiveIndex(itemList) {
        return itemList.findIndex(i => i.type === 'heading' && i.title === 'Archive');
    },

    /**
     * Check if an item is the Archive heading
     * @param {Object} item - The item to check
     * @returns {boolean}
     */
    isArchiveHeading(item) {
        return item && item.type === 'heading' && item.title === 'Archive';
    },

    /**
     * Count the children of a parent item (indent 0)
     * @param {Array} itemList - The items array
     * @param {number} parentIndex - Index of the parent item
     * @returns {number} Number of children (items with indent > 0 following the parent)
     */
    getChildCount(itemList, parentIndex) {
        if (parentIndex < 0 || parentIndex >= itemList.length) return 0;
        const parentItem = itemList[parentIndex];
        if (parentItem.indent !== Constants.INDENT.PARENT || parentItem.type === 'heading') return 0;

        let count = 0;
        for (let i = parentIndex + 1; i < itemList.length; i++) {
            if (itemList[i].indent <= Constants.INDENT.PARENT || itemList[i].type === 'heading') break;
            count++;
        }
        return count;
    },

    /**
     * Get an item and its children as a slice
     * @param {Array} itemList - The items array
     * @param {number} index - Index of the item
     * @returns {{items: Array, count: number}} The item(s) and count
     */
    getItemWithChildren(itemList, index) {
        if (index < 0 || index >= itemList.length) return { items: [], count: 0 };

        const item = itemList[index];
        let count = 1;

        if (item.type === 'heading') {
            // Heading includes all items until next heading
            for (let i = index + 1; i < itemList.length; i++) {
                if (itemList[i].type === 'heading') break;
                count++;
            }
        } else if (item.indent === Constants.INDENT.PARENT) {
            // Parent includes all children
            for (let i = index + 1; i < itemList.length; i++) {
                if (itemList[i].indent <= Constants.INDENT.PARENT || itemList[i].type === 'heading') break;
                count++;
            }
        }
        // For indent 1, count stays 1

        return {
            items: itemList.slice(index, index + count),
            count
        };
    },

    /**
     * Check if a child item's parent is selected
     * @param {Array} itemList - The items array
     * @param {number} childIndex - Index of the child item
     * @param {Set} selectedSet - Set of selected indices
     * @returns {boolean} True if parent is selected
     */
    isParentSelected(itemList, childIndex, selectedSet) {
        const item = itemList[childIndex];
        if (!item || item.indent !== Constants.INDENT.CHILD) return false;

        for (let i = childIndex - 1; i >= 0; i--) {
            if (itemList[i].indent === Constants.INDENT.PARENT) {
                return selectedSet.has(i);
            }
            if (itemList[i].type === 'heading') break;
        }
        return false;
    },

    /**
     * Collect items to move/copy, filtering out children whose parents are also selected
     * @param {Array} itemList - The items array
     * @param {Set} selectedSet - Set of selected indices
     * @param {Object} options - Options { excludeHeadings: boolean }
     * @returns {Array} Array of items to move/copy
     */
    collectItemsToProcess(itemList, selectedSet, options = {}) {
        const { excludeHeadings = true } = options;
        const result = [];
        const sortedIndices = Array.from(selectedSet).sort((a, b) => a - b);

        sortedIndices.forEach(index => {
            const item = itemList[index];
            if (!item) return;
            if (excludeHeadings && item.type === 'heading') return;

            // Skip children whose parents are also selected
            if (item.indent === Constants.INDENT.CHILD && this.isParentSelected(itemList, index, selectedSet)) {
                return;
            }

            result.push(item);
        });

        return result;
    },

    /**
     * Deep copy an array of items with new IDs
     * @param {Array} itemList - Items to copy
     * @param {boolean} generateNewIds - Whether to generate new IDs
     * @returns {Array} Deep copied items
     */
    deepCopyItems(itemList, generateNewIds = false) {
        return itemList.map(item => {
            const copy = JSON.parse(JSON.stringify(item));
            if (generateNewIds) {
                copy.id = this.generateId();
            }
            return copy;
        });
    },

    /**
     * Check if there's a parent above a given position
     * @param {Array} itemList - The items array
     * @param {number} position - The position to check above
     * @returns {boolean} True if there's a parent (indent 0, non-heading) above
     */
    hasParentAbove(itemList, position) {
        for (let i = position - 1; i >= 0; i--) {
            if (itemList[i].indent === Constants.INDENT.PARENT && itemList[i].type !== 'heading') {
                return true;
            }
            if (itemList[i].type === 'heading') break;
        }
        return false;
    },

    /**
     * Adjust indent of first item if it would be orphaned
     * @param {Array} itemsToInsert - Items being inserted
     * @param {Array} targetList - The target items array
     * @param {number} insertPosition - Where items will be inserted
     */
    adjustOrphanedIndent(itemsToInsert, targetList, insertPosition) {
        if (itemsToInsert.length === 0) return;
        if (itemsToInsert[0].indent !== Constants.INDENT.CHILD) return;

        if (insertPosition === 0 || !this.hasParentAbove(targetList, insertPosition)) {
            itemsToInsert[0].indent = Constants.INDENT.PARENT;
        }
    }
};

// ============================================================
// SelectionManager - Manages selection state
// ============================================================
const SelectionManager = {
    /**
     * Capture current selection state as IDs (for restoration after array mutations)
     * @param {Array} itemList - The items array
     * @returns {{selectedIds: Set, activeItemId: string|null}}
     */
    captureState(itemList) {
        const selectedIds = new Set();
        selectedIndices.forEach(index => {
            if (itemList[index]) {
                selectedIds.add(itemList[index].id);
            }
        });
        const activeItemId = (activeIndex >= 0 && itemList[activeIndex])
            ? itemList[activeIndex].id
            : null;
        return { selectedIds, activeItemId };
    },

    /**
     * Restore selection state from captured IDs after array mutations
     * @param {Array} itemList - The items array (after mutation)
     * @param {{selectedIds: Set, activeItemId: string|null}} capturedState
     */
    restoreState(itemList, capturedState) {
        const { selectedIds, activeItemId } = capturedState;

        selectedIndices.clear();
        itemList.forEach((item, idx) => {
            if (selectedIds.has(item.id)) {
                selectedIndices.add(idx);
            }
        });

        if (activeItemId) {
            const newActiveIndex = itemList.findIndex(i => i.id === activeItemId);
            if (newActiveIndex !== -1) {
                activeIndex = newActiveIndex;
            }
        }
    },

    /**
     * Clear all selection
     */
    clear() {
        selectedIndices.clear();
        activeIndex = -1;
        anchorIndex = -1;
    },

    /**
     * Set single selection
     * @param {number} index - Index to select
     */
    setSingle(index) {
        selectedIndices.clear();
        if (index >= 0) {
            selectedIndices.add(index);
        }
        activeIndex = index;
        anchorIndex = index;
    },

    /**
     * Validate and fix selection indices after items array changes
     * @param {Array} itemList - The items array
     */
    validate(itemList) {
        if (activeIndex >= itemList.length) {
            activeIndex = -1;
            selectedIndices.clear();
            anchorIndex = -1;
        }
    }
};

// ============================================================
// RenderUtils - DOM rendering utility functions
// ============================================================
const RenderUtils = {
    /**
     * Calculate padding left for an item based on its type and indent
     * @param {Object} item - The item
     * @returns {number} Padding in pixels
     */
    calculatePadding(item) {
        if (item.type === 'heading') {
            return 0;
        }
        return Constants.ITEM_PADDING_BASE + item.indent * Constants.ITEM_PADDING_PER_INDENT;
    },

    /**
     * Create the base item div element with classes and styles
     * @param {Object} item - The item
     * @param {number} index - Index of the item
     * @returns {HTMLElement} The created div element
     */
    createItemDiv(item, index) {
        const itemDiv = document.createElement('div');
        itemDiv.className = `item item-${item.type} indent-${item.indent} ${item.isChecked ? 'checked' : ''}`;
        if (ItemUtils.isArchiveHeading(item)) {
            itemDiv.classList.add('item-archive');
        }
        itemDiv.dataset.id = item.id;
        itemDiv.dataset.index = index;
        itemDiv.style.paddingLeft = `${this.calculatePadding(item)}px`;
        return itemDiv;
    },

    /**
     * Create a checkbox element for todo items
     * @param {Object} item - The item
     * @param {HTMLElement} itemDiv - The parent item div
     * @param {Function} onUpdate - Callback when checkbox changes
     * @returns {HTMLElement} The checkbox element
     */
    createCheckbox(item, itemDiv, onUpdate) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = item.isChecked;
        checkbox.onclick = (e) => {
            e.stopPropagation();
            item.isChecked = checkbox.checked;
            itemDiv.classList.toggle('checked', checkbox.checked);
            onUpdate();
        };
        return checkbox;
    },

    /**
     * Create edit input for editing mode
     * @param {Object} item - The item being edited
     * @param {Object} callbacks - {onTab, onEnter, onEscape, onBlur}
     * @returns {HTMLElement} The input element
     */
    createEditInput(item, callbacks) {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = item.title;
        input.dataset.editId = item.id;
        input.className = 'edit-input';
        input.style.flexGrow = '1';

        input.addEventListener('keydown', (e) => {
            if (e.isComposing) return;
            if (e.key === 'Tab') {
                e.preventDefault();
                callbacks.onTab(e.shiftKey, input);
            } else if (e.key === 'Enter') {
                e.stopPropagation();
                callbacks.onEnter(input);
            } else if (e.key === 'Escape') {
                e.stopPropagation();
                callbacks.onEscape();
            }
        });

        input.addEventListener('blur', () => {
            callbacks.onBlur();
        });

        input.onclick = (e) => e.stopPropagation();

        return input;
    },

    /**
     * Create title span for display mode
     * @param {Object} item - The item
     * @param {number} index - Index of the item
     * @param {Array} itemList - Full items array (for archive count)
     * @returns {HTMLElement} The title span element
     */
    createTitleSpan(item, index, itemList) {
        const titleSpan = document.createElement('span');
        titleSpan.className = 'item-title';

        if (ItemUtils.isArchiveHeading(item)) {
            // Calculate archive count
            let archiveCount = 0;
            for (let i = index + 1; i < itemList.length; i++) {
                if (itemList[i].type === 'heading') break;
                archiveCount++;
            }
            titleSpan.textContent = `Archive [${archiveCount}]`;
        } else {
            titleSpan.textContent = item.title || '(No Title)';
        }

        return titleSpan;
    },

    /**
     * Create note icon if item has a note
     * @param {Object} item - The item
     * @returns {HTMLElement|null} The note icon element or null
     */
    createNoteIcon(item) {
        if (item.note && item.note.trim().length > 0) {
            const noteIcon = document.createElement('span');
            noteIcon.className = 'codicon codicon-note item-note-icon';
            return noteIcon;
        }
        return null;
    },

    /**
     * Create archive icon for Archive heading
     * @param {boolean} isHidden - Whether archive is hidden
     * @returns {HTMLElement} The archive icon div
     */
    createArchiveIcon(isHidden) {
        const iconDiv = document.createElement('div');
        iconDiv.className = 'archive-icon';
        if (!isHidden) {
            iconDiv.classList.add('active');
        }
        iconDiv.innerHTML = `<i class="codicon codicon-archive"></i>`;
        return iconDiv;
    },

    /**
     * Apply selection classes to rendered items
     * @param {HTMLElement} listContainer - The list container element
     * @param {Set} selectedIdxs - Set of selected indices
     * @param {boolean} isPreSel - Whether in pre-selection mode
     */
    applySelectionClasses(listContainer, selectedIdxs, isPreSel) {
        const renderedItems = listContainer.children;
        selectedIdxs.forEach(idx => {
            if (renderedItems[idx]) {
                if (isPreSel) {
                    renderedItems[idx].classList.add('pre-selected');
                } else {
                    renderedItems[idx].classList.add('selected');
                }
            }
        });
    },

    /**
     * Focus the edit input if editing
     * @param {string} editId - ID of the item being edited
     */
    focusEditInput(editId) {
        if (editId) {
            const input = document.querySelector(`input[data-edit-id="${editId}"]`);
            if (input) {
                input.focus();
            }
        }
    }
};

// ============================================================
// MoveUtils - Movement operation utilities
// ============================================================
const MoveUtils = {
    /**
     * Expand selection to include children of selected parent items
     * @param {Array} indices - Selected indices
     * @param {Array} itemList - Items array
     * @returns {Array} Expanded and sorted indices
     */
    expandSelectionWithChildren(indices, itemList) {
        const expandedIndices = new Set(indices);
        indices.forEach(idx => {
            const item = itemList[idx];
            if (item.indent === Constants.INDENT.PARENT && item.type !== 'heading') {
                for (let i = idx + 1; i < itemList.length; i++) {
                    if (itemList[i].indent === Constants.INDENT.CHILD) {
                        expandedIndices.add(i);
                    } else {
                        break;
                    }
                }
            }
        });
        return Array.from(expandedIndices).sort((a, b) => a - b);
    },

    /**
     * Check if indices are contiguous
     * @param {Array} indices - Sorted array of indices
     * @returns {boolean} True if contiguous
     */
    isContiguous(indices) {
        for (let i = 0; i < indices.length - 1; i++) {
            if (indices[i + 1] !== indices[i] + 1) {
                return false;
            }
        }
        return true;
    },

    /**
     * Get the count of items in a block starting from index
     * @param {Array} itemList - Items array
     * @param {number} startIndex - Starting index
     * @returns {number} Number of items in the block
     */
    getBlockCount(itemList, startIndex) {
        const item = itemList[startIndex];
        let count = 1;

        if (item.type === 'heading') {
            for (let i = startIndex + 1; i < itemList.length; i++) {
                if (itemList[i].type === 'heading') break;
                count++;
            }
        } else if (item.indent === Constants.INDENT.PARENT) {
            for (let i = startIndex + 1; i < itemList.length; i++) {
                if (itemList[i].indent <= Constants.INDENT.PARENT || itemList[i].type === 'heading') break;
                count++;
            }
        }
        return count;
    },

    /**
     * Find the start index of the block above the given index
     * @param {Array} itemList - Items array
     * @param {number} currentIndex - Current index
     * @param {Object} item - Current item
     * @returns {number} Start index of block above, or -1 if not found
     */
    findBlockAbove(itemList, currentIndex, item) {
        if (currentIndex === 0) return -1;

        const targetIndex = currentIndex - 1;
        const targetItem = itemList[targetIndex];

        if (item.indent === Constants.INDENT.CHILD) {
            // Child can only swap with another child
            return targetItem.indent === Constants.INDENT.CHILD ? targetIndex : -1;
        }

        // For parent or heading, find the start of the block above
        if (targetItem.indent === Constants.INDENT.CHILD) {
            // Scan up to find the parent
            for (let i = targetIndex; i >= 0; i--) {
                if (itemList[i].indent === Constants.INDENT.PARENT || itemList[i].type === 'heading') {
                    return i;
                }
            }
        }
        return targetIndex;
    },

    /**
     * Find how many items to swap with when moving down
     * @param {Array} itemList - Items array
     * @param {number} nextIndex - Index of next item
     * @param {Object} currentItem - Current item being moved
     * @returns {number} Number of items to swap with, or 0 if cannot move
     */
    getSwapCountDown(itemList, nextIndex, currentItem) {
        if (nextIndex >= itemList.length) return 0;

        const nextItem = itemList[nextIndex];

        if (currentItem.indent === Constants.INDENT.CHILD) {
            return nextItem.indent === Constants.INDENT.CHILD ? 1 : 0;
        }

        // For parent items
        if (currentItem.indent === Constants.INDENT.PARENT && currentItem.type !== 'heading') {
            let count = 0;
            let i = nextIndex;
            while (i < itemList.length) {
                if (i > nextIndex && (itemList[i].indent === Constants.INDENT.PARENT || itemList[i].type === 'heading')) break;
                count++;
                i++;
            }
            return count;
        }

        // For headings
        if (currentItem.type === 'heading') {
            if (nextItem.type === 'heading') {
                let count = 1;
                for (let i = nextIndex + 1; i < itemList.length; i++) {
                    if (itemList[i].type === 'heading') break;
                    count++;
                }
                return count;
            }
        }

        return 1;
    },

    /**
     * Update selection indices based on item IDs after array mutation
     * @param {Array} itemList - Items array after mutation
     * @param {Set} movingIds - Set of IDs that were moved
     */
    updateSelectionByIds(itemList, movingIds) {
        selectedIndices.clear();
        itemList.forEach((item, idx) => {
            if (movingIds.has(item.id)) {
                selectedIndices.add(idx);
            }
        });
    },

    /**
     * Check if moved items ended up in archive section
     * @param {Array} itemList - Items array
     * @param {Set} movingIds - Set of IDs that were moved
     * @param {boolean} archiveHidden - Whether archive is hidden
     * @returns {boolean} True if any moved item is in hidden archive
     */
    checkMovedIntoArchive(itemList, movingIds, archiveHidden) {
        if (!archiveHidden) return false;

        let inArchive = false;
        for (const item of itemList) {
            if (item.type === 'heading' && item.title === 'Archive') {
                inArchive = true;
            } else if (inArchive && movingIds.has(item.id)) {
                return true;
            }
        }
        return false;
    }
};

// ============================================================
// KeyboardHandler - Centralized keyboard event handling
// ============================================================
const KeyboardHandler = {
    /**
     * Handle arrow up key
     * @param {KeyboardEvent} event
     * @param {boolean} isCmd - Command/Ctrl key pressed
     */
    handleArrowUp(event, isCmd) {
        event.preventDefault();

        // Handle Cmd+Up (move item) - only for main items
        if (isCmd) {
            if (!isArchiveActive && !isArchiveHeaderSelected) {
                moveItem('up');
            }
            return;
        }

        // Navigation in archive items
        if (isArchiveActive && !isArchiveHeaderSelected) {
            const currentArchivedIndex = archivedActiveIndex >= 0 ? archivedActiveIndex : Math.min(...archivedSelectedIndices);
            if (currentArchivedIndex > 0) {
                const newIndex = currentArchivedIndex - 1;
                if (event.shiftKey) {
                    // Shift+Up: extend selection
                    if (archivedAnchorIndex === -1) archivedAnchorIndex = currentArchivedIndex;
                    archivedSelectedIndices.clear();
                    const start = Math.min(archivedAnchorIndex, newIndex);
                    const end = Math.max(archivedAnchorIndex, newIndex);
                    for (let i = start; i <= end; i++) {
                        archivedSelectedIndices.add(i);
                    }
                    archivedActiveIndex = newIndex;
                } else {
                    // Normal up: single selection
                    archivedSelectedIndices.clear();
                    archivedSelectedIndices.add(newIndex);
                    archivedActiveIndex = newIndex;
                    archivedAnchorIndex = newIndex;
                }
                render(false);
                renderInspector();
                scrollToActiveArchiveItem();
            } else if (!event.shiftKey) {
                // Move from first archive item to archive header (only without shift)
                archivedSelectedIndices.clear();
                archivedActiveIndex = -1;
                archivedAnchorIndex = -1;
                isArchiveHeaderSelected = true;
                render(false);
                renderInspector();
                scrollToActiveArchiveItem();
            }
            return;
        }

        // Navigation from archive header to main items
        if (isArchiveHeaderSelected) {
            isArchiveHeaderSelected = false;
            isArchiveActive = false;
            if (items.length > 0) {
                activeIndex = items.length - 1;
                selectedIndices.clear();
                selectedIndices.add(activeIndex);
                anchorIndex = activeIndex;
            }
            render(false);
            renderInspector();
            scrollToActiveItem();
            return;
        }

        // Navigation in main items
        if (activeIndex > 0) {
            if (event.shiftKey && items[activeIndex - 1].type === 'heading') {
                return;
            }
            selectItem(activeIndex - 1, false, event.shiftKey, true);
        }
    },

    /**
     * Handle arrow down key
     * @param {KeyboardEvent} event
     * @param {boolean} isCmd - Command/Ctrl key pressed
     */
    handleArrowDown(event, isCmd) {
        event.preventDefault();

        // Handle Cmd+Down (move item) - only for main items
        if (isCmd) {
            if (!isArchiveActive && !isArchiveHeaderSelected) {
                moveItem('down');
            }
            return;
        }

        // Navigation from archive header to archive items (if expanded)
        if (isArchiveHeaderSelected) {
            if (!isArchiveHidden && archivedItems.length > 0) {
                isArchiveHeaderSelected = false;
                isArchiveActive = true;
                archivedSelectedIndices.clear();
                archivedSelectedIndices.add(0);
                archivedActiveIndex = 0;
                archivedAnchorIndex = 0;
            }
            render(false);
            renderInspector();
            scrollToActiveArchiveItem();
            return;
        }

        // Navigation in archive items
        if (isArchiveActive) {
            const currentArchivedIndex = archivedActiveIndex >= 0 ? archivedActiveIndex : Math.max(...archivedSelectedIndices);
            if (currentArchivedIndex < archivedItems.length - 1) {
                const newIndex = currentArchivedIndex + 1;
                if (event.shiftKey) {
                    // Shift+Down: extend selection
                    if (archivedAnchorIndex === -1) archivedAnchorIndex = currentArchivedIndex;
                    archivedSelectedIndices.clear();
                    const start = Math.min(archivedAnchorIndex, newIndex);
                    const end = Math.max(archivedAnchorIndex, newIndex);
                    for (let i = start; i <= end; i++) {
                        archivedSelectedIndices.add(i);
                    }
                    archivedActiveIndex = newIndex;
                } else {
                    // Normal down: single selection
                    archivedSelectedIndices.clear();
                    archivedSelectedIndices.add(newIndex);
                    archivedActiveIndex = newIndex;
                    archivedAnchorIndex = newIndex;
                }
                render(false);
                renderInspector();
                scrollToActiveArchiveItem();
            }
            return;
        }

        // Navigation in main items
        if (activeIndex < items.length - 1) {
            if (event.shiftKey && items[activeIndex + 1].type === 'heading') {
                return;
            }
            selectItem(activeIndex + 1, false, event.shiftKey, true);
        } else if (activeIndex === items.length - 1 && archivedItems.length > 0) {
            // Move from last main item to archive header
            selectedIndices.clear();
            activeIndex = -1;
            anchorIndex = -1;
            isArchiveHeaderSelected = true;
            isArchiveActive = true;
            render(false);
            renderInspector();
            scrollToActiveArchiveItem();
        }
    },

    /**
     * Handle arrow right key (move to next heading or archive)
     * @param {KeyboardEvent} event
     * @param {boolean} isCmd - Command/Ctrl key pressed
     */
    handleArrowRight(event, isCmd) {
        // Archive Header: Open
        if (isArchiveHeaderSelected && !isCmd) {
            if (isArchiveHidden) {
                isArchiveHidden = false;
                render(false);
            }
            return;
        }

        // Archive items: block all operations except archive
        if (isArchiveActive) {
            event.preventDefault();
            return;
        }
        if (isCmd) {
            event.preventDefault();
            if (event.shiftKey) {
                moveToArchive();
            } else {
                moveToNextHeading();
            }
        }
    },

    /**
     * Handle arrow left key (move to previous heading or restore from archive)
     * @param {KeyboardEvent} event
     * @param {boolean} isCmd - Command/Ctrl key pressed
     */
    handleArrowLeft(event, isCmd) {
        // Archive Header: Close
        if (isArchiveHeaderSelected && !isCmd) {
            if (!isArchiveHidden) {
                isArchiveHidden = true;
                render(false);
            }
            return;
        }

        // Archive items: Select Archive Header
        if (isArchiveActive && !isCmd) {
            archivedSelectedIndices.clear();
            archivedActiveIndex = -1;
            archivedAnchorIndex = -1;
            isArchiveHeaderSelected = true;
            render(false);
            renderInspector();
            scrollToActiveArchiveItem();
            return;
        }

        if (isCmd) {
            event.preventDefault();
            if (event.shiftKey) {
                // Cmd+Shift+Left: Restore from archive (works for archived items)
                moveFromArchive();
            } else {
                // Cmd+Left: Move to previous heading (only for main items)
                if (!isArchiveActive) {
                    moveToPrevHeading();
                }
            }
        }
    },

    /**
     * Handle Enter key (add item or edit)
     * @param {KeyboardEvent} event
     */
    handleEnter(event) {
        event.preventDefault();

        // Archive header: toggle visibility
        if (isArchiveHeaderSelected) {
            isArchiveHidden = !isArchiveHidden;
            render(false);
            return;
        }

        // Archive items: block all operations
        if (isArchiveActive) {
            return;
        }

        // Determine trigger based on settings
        const isNewItemTrigger = (newItemTrigger === 'enter' && !event.shiftKey) ||
            (newItemTrigger === 'shift+enter' && event.shiftKey);
        const isEditTrigger = (newItemTrigger === 'enter' && event.shiftKey) ||
            (newItemTrigger === 'shift+enter' && !event.shiftKey);

        if (isNewItemTrigger) {
            // Add new item
            if (activeIndex >= 0) {
                addItem('todo', activeIndex + 1);
            } else {
                addItem('todo');
            }
        } else if (isEditTrigger) {
            // Enter edit mode
            if (activeIndex >= 0) {
                startEditing(items[activeIndex].id, false);
            }
        }
    },

    /**
     * Handle Space key (toggle checkbox)
     * @param {KeyboardEvent} event
     */
    handleSpace(event) {
        event.preventDefault();

        // Archive items: block all operations
        if (isArchiveActive) {
            return;
        }

        if (selectedIndices.size === 0) return;

        saveState();

        // Check if any selected todo is unchecked
        let hasUnchecked = false;
        selectedIndices.forEach(index => {
            const item = items[index];
            if (item && item.type === 'todo' && !item.isChecked) {
                hasUnchecked = true;
            }
        });

        // Toggle: if any unchecked, check all; otherwise uncheck all
        let changed = false;
        selectedIndices.forEach(index => {
            const item = items[index];
            if (item && item.type === 'todo') {
                item.isChecked = hasUnchecked;
                changed = true;
            }
        });
        if (changed) render();
    },

    /**
     * Handle Delete/Backspace key
     */
    handleDelete() {
        if (isArchiveActive) {
            if (archivedSelectedIndices.size > 0) {
                saveState();
                deleteArchivedItems();
            }
            return;
        }

        if (selectedIndices.size > 0) {
            saveState();
            deleteItems();
        }
    },

    /**
     * Handle Tab key (change indent)
     * @param {KeyboardEvent} event
     */
    handleTab(event) {
        event.preventDefault();

        // Archive items: block all operations
        if (isArchiveActive) {
            return;
        }

        if (selectedIndices.size > 0) {
            saveState();
            changeIndent(event.shiftKey ? -1 : 1);
        }
    },

    /**
     * Handle Z key (undo/redo)
     * @param {KeyboardEvent} event
     * @param {boolean} isCmd - Command/Ctrl key pressed
     */
    handleZ(event, isCmd) {
        if (isCmd) {
            event.preventDefault();
            if (event.shiftKey) {
                redo();
            } else {
                undo();
            }
        }
    },

    /**
     * Handle C key (copy)
     * @param {KeyboardEvent} event
     * @param {boolean} isCmd - Command/Ctrl key pressed
     */
    handleC(event, isCmd) {
        if (isCmd) {
            event.preventDefault();
            copyItems();
        }
    },

    /**
     * Handle X key (cut)
     * @param {KeyboardEvent} event
     * @param {boolean} isCmd - Command/Ctrl key pressed
     */
    handleX(event, isCmd) {
        if (isCmd) {
            event.preventDefault();
            cutItems();
        }
    },

    /**
     * Handle V key (paste)
     * @param {KeyboardEvent} event
     * @param {boolean} isCmd - Command/Ctrl key pressed
     */
    handleV(event, isCmd) {
        if (isCmd) {
            event.preventDefault();
            pasteItems();
        }
    },

    /**
     * Handle D key (duplicate)
     * @param {KeyboardEvent} event
     * @param {boolean} isCmd - Command/Ctrl key pressed
     */
    handleD(event, isCmd) {
        if (isCmd) {
            event.preventDefault();
            duplicateItems();
        }
    },

    /**
     * Handle A key (select all)
     * @param {KeyboardEvent} event
     * @param {boolean} isCmd - Command/Ctrl key pressed
     * @returns {boolean} True if handled
     */
    handleA(event, isCmd) {
        if (isCmd) {
            event.preventDefault();
            selectAll();
            return true;
        }
        return false;
    },

    /**
     * Main keydown event handler
     * @param {KeyboardEvent} event
     */
    handleKeydown(event) {
        if (editingId) return; // Let input handle events when editing

        // Detect modifier key based on settings
        let isModifierKey = false;
        if (taskMoveModifier === 'ctrl') {
            isModifierKey = event.metaKey || event.ctrlKey;
        } else if (taskMoveModifier === 'alt') {
            isModifierKey = event.altKey;
        }

        // Handle Cmd+A early to prevent default selection behavior
        const isCmd = event.metaKey || event.ctrlKey; // For Cmd+C, V, D, Z (always use native modifiers)
        if (event.key === 'a' && this.handleA(event, isCmd)) return;

        if (event.target.tagName === 'TEXTAREA') return;
        if (items.length === 0 && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) return;

        switch (event.key) {
            case 'ArrowUp':
                this.handleArrowUp(event, isModifierKey);
                break;
            case 'ArrowDown':
                this.handleArrowDown(event, isModifierKey);
                break;
            case 'ArrowRight':
                this.handleArrowRight(event, isModifierKey);
                break;
            case 'ArrowLeft':
                this.handleArrowLeft(event, isModifierKey);
                break;
            case 'Enter':
                this.handleEnter(event);
                break;
            case ' ':
                this.handleSpace(event);
                break;
            case 'Backspace':
            case 'Delete':
                this.handleDelete();
                break;
            case 'Tab':
                this.handleTab(event);
                break;
            case 'z':
                this.handleZ(event, isCmd);
                break;
            case 'c':
                this.handleC(event, isCmd);
                break;
            case 'x':
                this.handleX(event, isCmd);
                break;
            case 'v':
                this.handleV(event, isCmd);
                break;
            case 'd':
                this.handleD(event, isCmd);
                break;
        }
    }
};

// ============================================================
// HistoryManager - Undo/Redo history management
// ============================================================
const HistoryManager = {
    /**
     * Save current state to history
     */
    save() {
        if (isUndoingRedoing) return;
        const state = {
            items: JSON.parse(JSON.stringify(items)),
            archivedItems: JSON.parse(JSON.stringify(archivedItems))
        };
        history.push(state);
        if (history.length > Constants.MAX_HISTORY_SIZE) history.shift();
        future = [];
    },

    /**
     * Pop last state from history (for canceling new item)
     */
    popLast() {
        if (history.length > 0) {
            history.pop();
        }
    },

    /**
     * Perform undo operation
     * @returns {boolean} True if undo was performed
     */
    undo() {
        if (isUndoingRedoing || history.length === 0) return false;

        isUndoingRedoing = true;
        try {
            future.push({
                items: JSON.parse(JSON.stringify(items)),
                archivedItems: JSON.parse(JSON.stringify(archivedItems))
            });
            const previousState = history.pop();
            items = previousState.items;
            archivedItems = previousState.archivedItems || [];
            this._validateSelection();
            return true;
        } finally {
            isUndoingRedoing = false;
        }
    },

    /**
     * Perform redo operation
     * @returns {boolean} True if redo was performed
     */
    redo() {
        if (isUndoingRedoing || future.length === 0) return false;

        isUndoingRedoing = true;
        try {
            history.push({
                items: JSON.parse(JSON.stringify(items)),
                archivedItems: JSON.parse(JSON.stringify(archivedItems))
            });
            const nextState = future.pop();
            items = nextState.items;
            archivedItems = nextState.archivedItems || [];
            this._validateSelection();
            return true;
        } finally {
            isUndoingRedoing = false;
        }
    },

    /**
     * Validate and fix selection after history change
     * @private
     */
    _validateSelection() {
        // If activeIndex is out of bounds, select the last item
        if (activeIndex >= items.length) {
            activeIndex = items.length > 0 ? items.length - 1 : -1;
        }
        selectedIndices.clear();
        if (activeIndex >= 0) {
            selectedIndices.add(activeIndex);
            anchorIndex = activeIndex;
        }

        // Validate archive selection
        // If archivedActiveIndex is out of bounds, select the last archived item
        if (archivedActiveIndex >= archivedItems.length) {
            archivedActiveIndex = archivedItems.length > 0 ? archivedItems.length - 1 : -1;
        } 
        const validArchivedIndices = new Set();
        archivedSelectedIndices.forEach(idx => {
            if (idx < archivedItems.length) {
                validArchivedIndices.add(idx);
            }
        });
        archivedSelectedIndices = validArchivedIndices;
        if (archivedActiveIndex >= 0) {
            archivedAnchorIndex = archivedActiveIndex;
        } else if (archivedSelectedIndices.size > 0) {
            archivedActiveIndex = Math.min(...archivedSelectedIndices);
            archivedAnchorIndex = archivedActiveIndex;
        } else {
            archivedAnchorIndex = -1;
        }
    },

    /**
     * Check if undo is available
     * @returns {boolean}
     */
    canUndo() {
        return history.length > 0;
    },

    /**
     * Check if redo is available
     * @returns {boolean}
     */
    canRedo() {
        return future.length > 0;
    }
};

// ============================================================
// EditingManager - Item editing operations
// ============================================================
const EditingManager = {
    /**
     * Handle saving edited item
     * @param {number} itemIndex - Index of the item being edited
     * @param {string} newTitle - New title value
     */
    saveEdit(itemIndex, newTitle) {
        if (newTitle === '' && isNewItem) {
            // Empty title on new item -> delete without notifying
            this._cancelNewItem(itemIndex);
        } else if (newTitle === '') {
            // Existing item: title became empty -> delete it
            HistoryManager.save();
            deleteItem(itemIndex, true);
            this._resetEditingState();
        } else {
            // Title is not empty - save changes
            this._saveTitle(itemIndex, newTitle);
        }
    },

    /**
     * Handle canceling edit
     * @param {number} itemIndex - Index of the item being edited
     */
    cancelEdit(itemIndex) {
        if (isNewItem) {
            this._cancelNewItem(itemIndex);
        } else {
            this._resetEditingState();
            render(false);
        }
    },

    /**
     * Cancel and delete a new item
     * @private
     */
    _cancelNewItem(itemIndex) {
        deleteItem(itemIndex, false);
        HistoryManager.popLast();
        this._resetEditingState();
    },

    /**
     * Save title changes
     * @private
     */
    _saveTitle(itemIndex, newTitle) {
        if (items[itemIndex].title !== newTitle) {
            if (!isNewItem) {
                HistoryManager.save();
            }
            items[itemIndex].title = newTitle;
        }
        this._resetEditingState();
        render(true);
    },

    /**
     * Reset editing state variables
     * @private
     */
    _resetEditingState() {
        editingId = null;
        isNewItem = false;
    }
};

// ============================================================
// IndentManager - Indent change operations
// ============================================================
const IndentManager = {
    /**
     * Check if an item can change indent
     * @param {Object} item - The item to check
     * @param {number} index - Index of the item
     * @param {number} delta - Indent change direction (+1 or -1)
     * @param {number} newIndent - New indent value
     * @returns {boolean} True if indent can be changed
     */
    canChangeIndent(item, index, delta, newIndent) {
        // Headings cannot change indent
        if (item.type === 'heading') return false;

        // Check bounds
        if (newIndent < Constants.INDENT.PARENT || newIndent > Constants.INDENT.MAX) return false;

        // Restriction for indenting (not dedenting)
        if (delta > 0) {
            if (index === 0) return false;
            if (items[index - 1].type === 'heading') return false;
        }

        return true;
    },

    /**
     * Change indent for all selected items
     * @param {number} delta - Indent change direction (+1 or -1)
     */
    changeIndent(delta) {
        const indices = Array.from(selectedIndices).sort((a, b) => a - b);

        indices.forEach(index => {
            const item = items[index];
            const newIndent = item.indent + delta;

            if (this.canChangeIndent(item, index, delta, newIndent)) {
                item.indent = newIndent;
            }
        });

        render();
        scrollToActiveItem();
        renderInspector();
    }
};

// ============================================================
// DeleteManager - Item deletion operations
// ============================================================
const DeleteManager = {
    /**
     * Collect indices to delete including children of parents
     * @param {Set} indices - Selected indices
     * @returns {Set} All indices to delete
     */
    collectIndicesToDelete(indices) {
        const indicesToDelete = new Set();
        const sortedIndices = Array.from(indices).sort((a, b) => a - b);

        sortedIndices.forEach(index => {
            if (indicesToDelete.has(index)) return;

            indicesToDelete.add(index);
            const item = items[index];

            // If parent, also mark children for deletion
            if (item.indent === Constants.INDENT.PARENT && item.type !== 'heading') {
                for (let i = index + 1; i < items.length; i++) {
                    if (items[i].indent === Constants.INDENT.PARENT || items[i].type === 'heading') break;
                    indicesToDelete.add(i);
                }
            }
        });

        return indicesToDelete;
    },

    /**
     * Delete items by indices (in reverse order to avoid index shifting)
     * @param {Set} indicesToDelete - Indices to delete
     * @returns {{sortedDeleteIndices: number[], deletedTypes: string[]}}
     */
    deleteByIndices(indicesToDelete) {
        const sortedDeleteIndices = Array.from(indicesToDelete).sort((a, b) => b - a);
        const deletedTypes = [];

        // Record the type of each item before deletion
        sortedDeleteIndices.forEach(index => {
            const item = items[index];
            deletedTypes.unshift(item.indent === Constants.INDENT.PARENT ? 'parent' : 'child');
        });

        sortedDeleteIndices.forEach(index => {
            items.splice(index, 1);
        });
        return { sortedDeleteIndices, deletedTypes };
    },

    /**
     * Adjust cursor after deletion based on what was deleted
     * @param {number} referenceIndex - Position after deletion
     * @param {string[]} deletedTypes - Types of deleted items ('parent' or 'child')
     * @returns {number} Adjusted cursor position
     */
    adjustCursorAfterDeletion(referenceIndex, deletedTypes) {
        let adjustedIndex = Math.min(referenceIndex, items.length - 1);
        if (adjustedIndex < 0 && items.length > 0) {
            adjustedIndex = 0;
        }

        if (adjustedIndex < 0 || adjustedIndex >= items.length) {
            return adjustedIndex;
        }

        const item = items[adjustedIndex];
        const deletedParent = deletedTypes.some(t => t === 'parent');
        const deletedChild = deletedTypes.some(t => t === 'child');

        // Case 1: Parent task was deleted
        if (deletedParent && !deletedChild) {
            // Only move up if current position is a heading
            if (item.type === 'heading') {
                return adjustedIndex > 0 ? adjustedIndex - 1 : adjustedIndex;
            }
        }

        // Case 2: Child task was deleted (no parent deleted)
        if (deletedChild && !deletedParent) {
            // Move up if current position is heading or parent task
            if (item.type === 'heading' || item.indent === Constants.INDENT.PARENT) {
                // Recurse to handle edge cases
                return this.adjustCursorAfterDeletion(adjustedIndex - 1, []);
            }
        }

        return adjustedIndex;
    },

    /**
     * Reset selection after deletion
     * @param {number} referenceIndex - Index to base new selection on
     * @param {string[]} deletedTypes - Types of deleted items
     */
    resetSelectionAfterDelete(referenceIndex, deletedTypes = []) {
        selectedIndices.clear();
        activeIndex = this.adjustCursorAfterDeletion(referenceIndex, deletedTypes);

        if (activeIndex >= 0) {
            selectedIndices.add(activeIndex);
            anchorIndex = activeIndex;
        } else {
            anchorIndex = -1;
        }
    },

    /**
     * Delete a single item
     * @param {number} index - Index of item to delete
     * @param {boolean} notify - Whether to notify extension
     */
    deleteSingle(index, notify = true) {
        if (index < 0 || index >= items.length) return;

        const item = items[index];
        const deletedType = item.indent === Constants.INDENT.PARENT ? 'parent' : 'child';

        items.splice(index, 1);
        this.resetSelectionAfterDelete(index, [deletedType]);
        render(notify);
        selectItem(activeIndex);
    },

    /**
     * Delete multiple selected items
     * @param {boolean} notify - Whether to notify extension
     */
    deleteMultiple(notify = true) {
        if (selectedIndices.size === 0) return;

        const indicesToDelete = this.collectIndicesToDelete(selectedIndices);
        const result = this.deleteByIndices(indicesToDelete);
        const { sortedDeleteIndices, deletedTypes } = result;

        // Find the minimum deleted index (last element of descending sorted array)
        const minDeletedIndex = sortedDeleteIndices[sortedDeleteIndices.length - 1];
        this.resetSelectionAfterDelete(minDeletedIndex, deletedTypes);

        render(notify);
        selectItem(activeIndex);
    }
};

// ============================================================
// ArchiveDeleteManager - Archive deletion operations
// ============================================================
const ArchiveDeleteManager = {
    /**
     * Collect indices to delete including children of parents
     * @param {Set} indices - Selected indices in archived items
     * @returns {Set} All indices to delete
     */
    collectIndicesToDelete(indices) {
        const indicesToDelete = new Set();
        const sortedIndices = Array.from(indices).sort((a, b) => a - b);

        sortedIndices.forEach(index => {
            if (indicesToDelete.has(index)) return;

            indicesToDelete.add(index);
            const item = archivedItems[index];

            // If parent, also mark children for deletion
            if (item.indent === Constants.INDENT.PARENT) {
                for (let i = index + 1; i < archivedItems.length; i++) {
                    if (archivedItems[i].indent === Constants.INDENT.PARENT) break;
                    indicesToDelete.add(i);
                }
            }
        });

        return indicesToDelete;
    },

    /**
     * Delete archived items by indices (in reverse order to avoid index shifting)
     * @param {Set} indicesToDelete - Indices to delete
     * @returns {number} Minimum deleted index
     */
    deleteByIndices(indicesToDelete) {
        const sortedDeleteIndices = Array.from(indicesToDelete).sort((a, b) => b - a);

        sortedDeleteIndices.forEach(index => {
            archivedItems.splice(index, 1);
        });

        // Return the minimum deleted index (last element of descending sorted array)
        return sortedDeleteIndices[sortedDeleteIndices.length - 1];
    },

    /**
     * Reset selection after deletion
     * @param {number} minDeletedIndex - Index of first deleted item
     */
    resetSelectionAfterDelete(minDeletedIndex) {
        archivedSelectedIndices.clear();

        if (archivedItems.length > 0) {
            const newActiveIndex = Math.min(minDeletedIndex, archivedItems.length - 1);
            archivedActiveIndex = newActiveIndex;
            archivedSelectedIndices.add(newActiveIndex);
            archivedAnchorIndex = newActiveIndex;
        } else {
            // If no items left, select header
            archivedActiveIndex = -1;
            archivedAnchorIndex = -1;
            isArchiveHeaderSelected = true;
            isArchiveActive = false;
        }
    },

    /**
     * Delete multiple selected archived items
     */
    deleteMultiple() {
        if (archivedSelectedIndices.size === 0) return;

        const indicesToDelete = this.collectIndicesToDelete(archivedSelectedIndices);
        const minDeletedIndex = this.deleteByIndices(indicesToDelete);
        this.resetSelectionAfterDelete(minDeletedIndex);

        const deletedCount = indicesToDelete.size;
        render(true);
        renderInspector();

        // Wait for DOM to update before scrolling
        setTimeout(() => {
            scrollToActiveArchiveItem();
        }, 0);

        showNotification(`${deletedCount} item(s) deleted`, 'codicon-trash');
    }
};

function deleteArchivedItems() {
    ArchiveDeleteManager.deleteMultiple();
}

function saveState() {
    HistoryManager.save();
}

function enterPreSelectionState() {
    if (activeIndex < 0) return;

    isPreSelected = true;

    // Update visual state: change selected items to pre-selected appearance
    const renderedItems = document.querySelectorAll('.item');
    renderedItems.forEach((el, i) => {
        if (selectedIndices.has(i)) {
            el.classList.remove('selected');
            el.classList.add('pre-selected');
        }
    });

    // Hide inspector
    renderInspector();
}

function exitPreSelectionState() {
    if (!isPreSelected) return;

    isPreSelected = false;

    // Update visual state: change pre-selected items back to selected appearance
    const renderedItems = document.querySelectorAll('.item');
    renderedItems.forEach((el, i) => {
        if (selectedIndices.has(i)) {
            el.classList.remove('pre-selected');
            el.classList.add('selected');
        }
    });

    // Show inspector
    renderInspector();
}

function undo() {
    if (HistoryManager.undo()) {
        render();
        showNotification('Undo', 'codicon-discard');
    }
}

function redo() {
    if (HistoryManager.redo()) {
        render();
        showNotification('Redo', 'codicon-redo');
    }
}

window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'update':
            items = message.items || [];
            archivedItems = message.archivedItems || [];
            // Validate activeIndex against new items
            if (activeIndex >= items.length) {
                activeIndex = -1;
                selectedIndices.clear();
                anchorIndex = -1;
            }
            // Reset archive selection
            archivedSelectedIndices.clear();
            archivedActiveIndex = -1;
            archivedAnchorIndex = -1;
            isArchiveActive = false;
            isArchiveHeaderSelected = false;
            // If we were editing, we might lose focus if we just re-render blindly,
            // but for now let's assume update comes from file change or initial load.
            // If we are driving the change locally, we might want to be careful.
            // For this step, we'll re-render.
            render(false); // Don't notify extension on inbound update
            break;
        case 'settings':
            taskMoveModifier = message.taskMoveModifier || 'ctrl';
            newItemTrigger = message.newItemTrigger || 'enter';
            isMac = message.isMac || false;
            break;
        case 'showDonationBanner':
            showDonationBanner();
            break;
        case 'clearArchiveConfirmed':
            saveState(); // Save state before clearing
            archivedItems = [];
            archivedSelectedIndices.clear();
            archivedActiveIndex = -1;
            archivedAnchorIndex = -1;
            render(false);
            // Send update to Extension to save the changes
            vscode.postMessage({
                type: 'updateItems',
                items: items,
                archivedItems: archivedItems
            });
            break;
        case 'requestSync':
            // Reload the webview to fetch latest items from file
            location.reload();
            break;
    }
});

// Header Buttons
document.getElementById('btn-add-todo').addEventListener('click', () => {
    addItem('todo');
});

document.getElementById('btn-add-heading').addEventListener('click', () => {
    addItem('heading');
});

document.getElementById('btn-open-file').addEventListener('click', () => {
    vscode.postMessage({ type: 'openFile' });
});

// Donation Banner
function showDonationBanner() {
    const banner = document.getElementById('donation-banner');
    if (banner) {
        banner.style.display = 'flex';
    }
}

document.getElementById('btn-donate').addEventListener('click', () => {
    const banner = document.getElementById('donation-banner');
    if (banner) {
        banner.style.display = 'none';
    }
    vscode.postMessage({ type: 'hideDonationBanner', buttonType: 'support' });
    // Open support URL
    vscode.postMessage({ type: 'openUrl', url: 'https://github.com/swgamesdev/ArchyTask' });
});

document.getElementById('btn-dismiss').addEventListener('click', () => {
    const banner = document.getElementById('donation-banner');
    if (banner) {
        banner.style.display = 'none';
    }
    vscode.postMessage({ type: 'hideDonationBanner', buttonType: 'dismiss' });
});

// Keyboard Navigation & Operations
window.addEventListener('keydown', event => KeyboardHandler.handleKeydown(event));

function selectItem(index, toggle = false, extend = false, isKeyboard = false) {
    // Exit pre-selection state on normal selection
    exitPreSelectionState();

    if (index < 0 || index >= items.length) {
        SelectionManager.clear();
        return;
    }

    if (extend) {
        handleExtendSelection(index, isKeyboard);
    } else if (toggle) {
        handleToggleSelection(index);
    } else {
        SelectionManager.setSingle(index);
    }

    updateSelectionUI();
    renderInspector();
}

/**
 * Handle extend selection (Shift + Click/Arrow)
 * @param {number} index - Target index
 * @param {boolean} isKeyboard - Whether triggered by keyboard
 */
function handleExtendSelection(index, isKeyboard) {
    if (isKeyboard) {
        // Keyboard: Shift+Up/Down - replace selection with range from anchor to current
        if (anchorIndex === -1) anchorIndex = index;

        selectedIndices.clear();
        const start = Math.min(anchorIndex, index);
        const end = Math.max(anchorIndex, index);
        for (let i = start; i <= end; i++) {
            if (items[i].type !== 'heading') {
                selectedIndices.add(i);
            }
        }
        activeIndex = index;
    } else {
        // Mouse: Shift+Click - expand existing selection
        if (anchorIndex === -1) {
            anchorIndex = selectedIndices.size > 0 ? Math.min(...selectedIndices) : index;
        }

        // If anchor is a heading, it shouldn't be part of a multi-selection with tasks
        if (anchorIndex >= 0 && items[anchorIndex].type === 'heading') {
            selectedIndices.delete(anchorIndex);
        }

        // Find the actual endpoint, stopping before any heading
        let actualEnd = findSelectionEndpoint(index);

        // Expand selection from anchor to actual endpoint
        const selStart = Math.min(anchorIndex, actualEnd);
        const selEnd = Math.max(anchorIndex, actualEnd);
        for (let i = selStart; i <= selEnd; i++) {
            if (items[i].type !== 'heading') {
                selectedIndices.add(i);
            }
        }
        activeIndex = actualEnd;
    }
}

/**
 * Find selection endpoint, stopping before any heading
 * @param {number} targetIndex - Target index
 * @returns {number} Actual endpoint index
 */
function findSelectionEndpoint(targetIndex) {
    let actualEnd = targetIndex;

    if (anchorIndex < targetIndex) {
        // Moving forward
        for (let i = anchorIndex + 1; i <= targetIndex; i++) {
            if (items[i].type === 'heading') {
                actualEnd = i - 1;
                break;
            }
        }
    } else if (anchorIndex > targetIndex) {
        // Moving backward
        for (let i = anchorIndex - 1; i >= targetIndex; i--) {
            if (items[i].type === 'heading') {
                actualEnd = i + 1;
                break;
            }
        }
    }
    return actualEnd;
}

/**
 * Handle toggle selection (Cmd + Click)
 * @param {number} index - Target index
 */
function handleToggleSelection(index) {
    if (items[index].type !== 'heading') {
        if (selectedIndices.has(index)) {
            selectedIndices.delete(index);
            if (activeIndex === index) activeIndex = -1;
        } else {
            selectedIndices.add(index);
            activeIndex = index;
            anchorIndex = index;
        }
    } else {
        // Cmd+Click on heading selects it singly
        SelectionManager.setSingle(index);
    }
}

/**
 * Update selection UI classes
 */
function updateSelectionUI() {
    const renderedItems = document.querySelectorAll('.item');
    renderedItems.forEach((el, i) => {
        el.classList.remove('selected', 'pre-selected');
        if (selectedIndices.has(i)) {
            el.classList.add(isPreSelected ? 'pre-selected' : 'selected');
            if (i === activeIndex) {
                el.scrollIntoView({ block: 'nearest' });
            }
        }
    });
}

function addItem(type, insertIndex = null, indent = null) {
    saveState();
    const newItem = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        type: type,
        title: '',
        indent: 0,
        isChecked: false,
        note: ''
    };

    // Determine insert position if not specified
    if (insertIndex === null) {
        if (activeIndex >= 0) {
            if (type === 'heading') {
                // If creating a heading and active item is a child (indent 1),
                // insert before the parent (indent 0)
                if (items[activeIndex].indent === 1) {
                    // Find the parent (indent 0) above this child
                    for (let i = activeIndex - 1; i >= 0; i--) {
                        if (items[i].indent === 0) {
                            insertIndex = i;
                            break;
                        }
                        if (items[i].type === 'heading') {
                            // Found heading before parent, insert before heading
                            insertIndex = i;
                            break;
                        }
                    }
                    if (insertIndex === null) {
                        insertIndex = 0; // Insert at beginning if no parent found
                    }
                } else {
                    insertIndex = activeIndex;
                }
            } else {
                insertIndex = activeIndex + 1;
            }
        } else {
            insertIndex = items.length;
        }
    }

    // Check Archive constraints
    const archiveIndex = items.findIndex(i => i.type === 'heading' && i.title === 'Archive');
    if (type === 'heading' && archiveIndex !== -1 && insertIndex > archiveIndex) {
        // Cannot create heading under Archive
        return;
    }

    // Determine indent if not specified
    if (indent === null) {
        if (type === 'heading') {
            newItem.indent = 0;
        } else if (activeIndex >= 0 && items[activeIndex]) {
            const selectedItem = items[activeIndex];
            // Smart indent logic: if parent (indent 0) has children, new item is indent 1
            if (selectedItem.indent === 0) {
                if (activeIndex + 1 < items.length && items[activeIndex + 1].indent === 1) {
                    newItem.indent = 1;
                } else {
                    newItem.indent = 0;
                }
            } else {
                // Child or other indent level, keep same indent
                newItem.indent = selectedItem.indent;
            }
        } else {
            newItem.indent = 0;
        }
    } else {
        newItem.indent = indent;
    }

    // Ensure indent is within bounds and heading is always 0
    if (type === 'heading') {
        newItem.indent = 0;
    } else if (newItem.indent > 1) {
        newItem.indent = 1;
    }

    items.splice(insertIndex, 0, newItem);
    render(false); // Don't save yet, wait for user input
    selectItem(insertIndex);
    startEditing(newItem.id, true);
}

function deleteItem(index, notify = true) {
    DeleteManager.deleteSingle(index, notify);
}

function deleteItems(notify = true) {
    DeleteManager.deleteMultiple(notify);
}

function changeIndent(delta) {
    IndentManager.changeIndent(delta);
}

function moveItem(direction) {
    if (activeIndex < 0) return;
    if (ItemUtils.isArchiveHeading(items[activeIndex])) return;

    saveState();

    // Multi-selection handling
    if (selectedIndices.size > 1) {
        moveMultipleItems(direction);
        return;
    }

    // Single item handling
    moveSingleItem(direction);
}

/**
 * Handle movement of multiple selected items
 * @param {string} direction - 'up' or 'down'
 */
function moveMultipleItems(direction) {
    const indices = Array.from(selectedIndices).sort((a, b) => a - b);
    const finalIndices = MoveUtils.expandSelectionWithChildren(indices, items);

    // Prevent movement if child is topmost but parent is also selected
    if (items[finalIndices[0]].indent === Constants.INDENT.CHILD) {
        if (finalIndices.some(idx => items[idx].indent === Constants.INDENT.PARENT)) {
            return;
        }
    }

    if (!MoveUtils.isContiguous(finalIndices)) return;

    const start = finalIndices[0];
    const count = finalIndices.length;
    const movingItems = items.slice(start, start + count);
    const movingIds = new Set(movingItems.map(i => i.id));

    if (direction === 'up') {
        moveMultipleUp(start, count, movingItems, movingIds);
    } else {
        moveMultipleDown(start, count, movingItems, movingIds);
    }
}

function moveMultipleUp(start, count, movingItems, movingIds) {
    if (start === 0) return;

    const targetIndex = start - 1;
    const targetItem = items[targetIndex];
    let swapStart = targetIndex;

    if (items[start].indent === Constants.INDENT.PARENT) {
        // Find start of block above
        if (targetItem.indent === Constants.INDENT.CHILD) {
            for (let i = targetIndex; i >= 0; i--) {
                if (items[i].indent === Constants.INDENT.PARENT || items[i].type === 'heading') {
                    swapStart = i;
                    break;
                }
            }
        }
    } else {
        // Moving children only
        if (targetItem.indent !== Constants.INDENT.CHILD) return;
    }

    const displacedItems = items.slice(swapStart, start);
    const swapCount = start - swapStart;

    items.splice(start, count);
    items.splice(swapStart, 0, ...movingItems);

    MoveUtils.updateSelectionByIds(items, movingIds);
    activeIndex -= swapCount;

    render();
    scrollToActiveItem();
    renderInspector();
    animateDisplacedItems(displacedItems, 'up');
}

function moveMultipleDown(start, count, movingItems, movingIds) {
    if (start + count >= items.length) return;

    const nextItem = items[start + count];

    // Check if next item or any item ahead is Archive heading
    for (let i = start + count; i < items.length; i++) {
        if (ItemUtils.isArchiveHeading(items[i])) {
            return; // Don't move if Archive heading is ahead
        }
    }

    let swapCount = 0;

    if (items[start].indent === Constants.INDENT.PARENT) {
        let i = start + count;
        while (i < items.length) {
            if (i > start + count && (items[i].indent === Constants.INDENT.PARENT || items[i].type === 'heading')) break;
            swapCount++;
            i++;
        }
    } else {
        if (nextItem.indent !== Constants.INDENT.CHILD) return;
        swapCount = 1;
    }

    const displacedItems = items.slice(start + count, start + count + swapCount);

    items.splice(start, count);
    items.splice(start + swapCount, 0, ...movingItems);

    MoveUtils.updateSelectionByIds(items, movingIds);
    activeIndex += swapCount;

    render();

    if (MoveUtils.checkMovedIntoArchive(items, movingIds, isArchiveHidden)) {
        selectArchiveHeading();
    } else {
        scrollToActiveItem();
    }

    renderInspector();
    animateDisplacedItems(displacedItems, 'down');
}

/**
 * Handle movement of a single selected item (with its children if parent)
 * @param {string} direction - 'up' or 'down'
 */
function moveSingleItem(direction) {
    const item = items[activeIndex];
    const originalIndex = activeIndex;
    const count = MoveUtils.getBlockCount(items, originalIndex);
    const movingItems = items.slice(originalIndex, originalIndex + count);

    if (direction === 'up') {
        moveSingleUp(item, originalIndex, count, movingItems);
    } else {
        moveSingleDown(item, originalIndex, count, movingItems);
    }
}

function moveSingleUp(item, originalIndex, count, movingItems) {
    if (originalIndex === 0) return;

    const targetIndex = originalIndex - 1;

    // Child can only swap with another child
    if (item.indent === Constants.INDENT.CHILD) {
        if (items[targetIndex].indent !== Constants.INDENT.CHILD) return;

        const displacedItems = [items[targetIndex]];
        items.splice(originalIndex, 1);
        items.splice(targetIndex, 0, item);
        render();
        selectItem(targetIndex);
        animateDisplacedItems(displacedItems, 'up');
        return;
    }

    // Parent or heading: find sibling block above
    let siblingIndex = -1;
    for (let i = originalIndex - 1; i >= 0; i--) {
        const candidate = items[i];
        if (item.type === 'heading') {
            if (candidate.type === 'heading') {
                siblingIndex = i;
                break;
            }
        } else {
            if (candidate.indent === Constants.INDENT.PARENT) {
                siblingIndex = i;
                break;
            }
        }
    }

    if (siblingIndex !== -1) {
        const displacedItems = items.slice(siblingIndex, originalIndex);
        items.splice(originalIndex, count);
        items.splice(siblingIndex, 0, ...movingItems);
        render();
        selectItem(siblingIndex);
        animateDisplacedItems(displacedItems, 'up');
    }
}

function moveSingleDown(item, originalIndex, count, movingItems) {
    const nextIndex = originalIndex + count;
    if (nextIndex >= items.length) return;

    const nextItem = items[nextIndex];

    // Don't move if next item is Archive heading
    if (ItemUtils.isArchiveHeading(nextItem)) {
        return;
    }

    // Child can only swap with another child
    if (item.indent === Constants.INDENT.CHILD) {
        if (nextItem.indent !== Constants.INDENT.CHILD) return;

        const displacedItems = [nextItem];
        items.splice(originalIndex, 1);
        items.splice(originalIndex + 1, 0, item);
        render();
        selectItem(originalIndex + 1);
        animateDisplacedItems(displacedItems, 'down');
        return;
    }

    // Parent or heading: find next block size
    let nextBlockCount = 1;
    if (nextItem.type === 'heading' && item.type === 'heading') {
        for (let i = nextIndex + 1; i < items.length; i++) {
            if (items[i].type === 'heading') break;
            nextBlockCount++;
        }
    } else if (nextItem.indent === Constants.INDENT.PARENT) {
        for (let i = nextIndex + 1; i < items.length; i++) {
            if (items[i].indent <= Constants.INDENT.PARENT || items[i].type === 'heading') break;
            nextBlockCount++;
        }
    }

    const displacedItems = items.slice(originalIndex + count, originalIndex + count + nextBlockCount);
    items.splice(originalIndex, count);
    items.splice(originalIndex + nextBlockCount, 0, ...movingItems);
    render();

    const newPosition = originalIndex + nextBlockCount;

    // Check if moved into hidden archive
    let inArchive = false;
    for (let i = newPosition - 1; i >= 0; i--) {
        if (items[i].type === 'heading') {
            if (items[i].title === 'Archive' && isArchiveHidden) {
                inArchive = true;
                selectArchiveHeading();
            }
            break;
        }
    }

    if (!inArchive) {
        selectItem(newPosition);
    }
    animateDisplacedItems(displacedItems, 'down');
}

function scrollToActiveItem() {
    const renderedItems = document.querySelectorAll('.item');
    if (activeIndex >= 0 && renderedItems[activeIndex]) {
        renderedItems[activeIndex].scrollIntoView({ block: 'nearest' });
    }
}

function scrollToActiveArchiveItem() {
    if (isArchiveHeaderSelected) {
        const archiveHeader = document.querySelector('.item.item-archive');
        if (archiveHeader) {
            archiveHeader.scrollIntoView({ block: 'nearest' });
        }
        return;
    }

    if (isArchiveActive && archivedActiveIndex >= 0) {
        const archivedItem = document.querySelector(`.item[data-archived-index="${archivedActiveIndex}"]`);
        if (archivedItem) {
            archivedItem.scrollIntoView({ block: 'nearest' });
        }
    }
}

function selectAll() {
    // Determine the reference item (active or first task)
    let referenceIndex = activeIndex;

    if (activeIndex < 0 || items[activeIndex].type === 'heading') {
        // Find the first non-heading task
        referenceIndex = -1;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type !== 'heading') {
                referenceIndex = i;
                break;
            }
        }
        if (referenceIndex === -1) return; // No tasks found
    }

    // Find the section boundaries (heading to heading)
    let sectionStart = 0;
    let sectionEnd = items.length - 1;

    // Find the heading that contains the reference item
    for (let i = referenceIndex; i >= 0; i--) {
        if (items[i].type === 'heading') {
            sectionStart = i + 1;
            break;
        }
        if (i === 0) {
            sectionStart = 0;
            break;
        }
    }

    // Find the next heading after the reference item
    for (let i = referenceIndex + 1; i < items.length; i++) {
        if (items[i].type === 'heading') {
            sectionEnd = i - 1;
            break;
        }
    }

    // Select all tasks in the section (excluding headings)
    selectedIndices.clear();
    for (let i = sectionStart; i <= sectionEnd; i++) {
        if (items[i].type !== 'heading') {
            selectedIndices.add(i);
        }
    }

    // Set active index to the reference item
    activeIndex = referenceIndex;
    anchorIndex = referenceIndex;

    // Update UI
    const renderedItems = document.querySelectorAll('.item');
    renderedItems.forEach((el, i) => {
        el.classList.remove('selected', 'pre-selected');
        if (selectedIndices.has(i)) {
            if (isPreSelected) {
                el.classList.add('pre-selected');
            } else {
                el.classList.add('selected');
            }
        }
    });
    renderInspector();
}

function copyItems() {
    if (selectedIndices.size === 0) return;

    // Use ItemUtils to collect items (filtering out children whose parents are selected)
    const itemsToProcess = ItemUtils.collectItemsToProcess(items, selectedIndices, { excludeHeadings: true });

    // Copy each item with its children
    clipboard = [];
    itemsToProcess.forEach(item => {
        const index = items.findIndex(i => i.id === item.id);
        if (index === -1) return;

        const { items: itemWithChildren } = ItemUtils.getItemWithChildren(items, index);
        clipboard.push(...ItemUtils.deepCopyItems(itemWithChildren, false));
    });

    showNotification('Copied', 'codicon-copy');
}

function cutItems() {
    if (selectedIndices.size === 0) return;

    // First, copy the selected items to clipboard
    const itemsToProcess = ItemUtils.collectItemsToProcess(items, selectedIndices, { excludeHeadings: true });
    clipboard = [];
    itemsToProcess.forEach(item => {
        const index = items.findIndex(i => i.id === item.id);
        if (index === -1) return;

        const { items: itemWithChildren } = ItemUtils.getItemWithChildren(items, index);
        clipboard.push(...ItemUtils.deepCopyItems(itemWithChildren, false));
    });

    // Then delete the selected items
    saveState();
    deleteItems(false); // false = no notification (we'll show our own)

    showNotification('Cut', 'codicon-cut');
}

function pasteItems() {
    if (clipboard.length === 0) return;

    saveState();

    // Determine insert position
    let insertIndex;
    if (activeIndex >= 0) {
        const activeItem = items[activeIndex];
        if (activeItem.indent === Constants.INDENT.PARENT) {
            // Insert after the item and its children
            insertIndex = activeIndex + 1 + ItemUtils.getChildCount(items, activeIndex);
        } else {
            insertIndex = activeIndex + 1;
        }
    } else {
        insertIndex = items.length;
    }

    // Check if trying to insert after Archive
    const archiveIndex = ItemUtils.findArchiveIndex(items);
    if (archiveIndex !== -1 && insertIndex > archiveIndex) {
        insertIndex = archiveIndex;
    }

    // Deep copy items from clipboard with new IDs
    const pastedItems = ItemUtils.deepCopyItems(clipboard, true);

    // Adjust orphaned indent if needed
    ItemUtils.adjustOrphanedIndent(pastedItems, items, insertIndex);

    // Insert items
    items.splice(insertIndex, 0, ...pastedItems);

    // Select the pasted items
    selectedIndices.clear();
    pastedItems.forEach((_, idx) => {
        selectedIndices.add(insertIndex + idx);
    });
    activeIndex = insertIndex;
    anchorIndex = insertIndex;

    render();
    selectItem(insertIndex);
    showNotification('Pasted', 'codicon-paste');
}

function duplicateItems() {
    if (selectedIndices.size === 0) return;

    saveState();

    // Get the last selected item's end position (including its children)
    const maxIndex = Math.max(...selectedIndices);
    let insertIndex = maxIndex + 1 + ItemUtils.getChildCount(items, maxIndex);

    // Collect items to duplicate using ItemUtils
    const itemsToProcess = ItemUtils.collectItemsToProcess(items, selectedIndices, { excludeHeadings: true });

    // Collect each item with its children
    const itemsToDuplicate = [];
    itemsToProcess.forEach(item => {
        const index = items.findIndex(i => i.id === item.id);
        if (index === -1) return;

        const { items: itemWithChildren } = ItemUtils.getItemWithChildren(items, index);
        itemsToDuplicate.push(...ItemUtils.deepCopyItems(itemWithChildren, false));
    });

    // Generate new IDs for duplicated items
    const duplicatedItems = ItemUtils.deepCopyItems(itemsToDuplicate, true);

    // Adjust orphaned indent if needed
    ItemUtils.adjustOrphanedIndent(duplicatedItems, items, insertIndex);

    // Insert after the last selected item and its children
    items.splice(insertIndex, 0, ...duplicatedItems);

    // Select the duplicated items
    selectedIndices.clear();
    duplicatedItems.forEach((_, idx) => {
        selectedIndices.add(insertIndex + idx);
    });
    activeIndex = insertIndex;
    anchorIndex = insertIndex;

    render();
    selectItem(insertIndex);
    showNotification('Duplicated', 'codicon-copy');
}

/**
 * Move selected items to Archive (Cmd+Shift+Right)
 * Items are added to the top of the archive list
 */
function moveToArchive() {
    if (selectedIndices.size === 0 && activeIndex >= 0) {
        selectedIndices.add(activeIndex);
    }
    if (selectedIndices.size === 0) return;

    saveState();

    // Identify items to move using ItemUtils (exclude headings)
    const itemsToMove = ItemUtils.collectItemsToProcess(items, selectedIndices, { excludeHeadings: true });
    if (itemsToMove.length === 0) return;

    // Store the minimum index to determine cursor position after move
    const minMovedIndex = Math.min(...Array.from(selectedIndices));

    // Record deleted types
    const deletedTypes = Array.from(selectedIndices)
        .map(idx => items[idx].indent === Constants.INDENT.PARENT ? 'parent' : 'child');

    // Sort Descending for processing (Bottom to Top) to avoid index shifting
    itemsToMove.sort((a, b) => {
        const indexA = items.findIndex(i => i.id === a.id);
        const indexB = items.findIndex(i => i.id === b.id);
        return indexB - indexA;
    });

    const movedItems = [];

    itemsToMove.forEach(item => {
        const index = items.findIndex(i => i.id === item.id);
        if (index === -1) return;

        // Get item with children
        const { items: movingItems, count } = ItemUtils.getItemWithChildren(items, index);

        // Remove from main items
        items.splice(index, count);

        // Prepare items for archive (checked, preserve indent)
        movingItems.forEach(mi => {
            mi.isChecked = true;
            // indent is preserved (not reset to 0)
        });

        // Collect for adding to archive (will add in reverse order later)
        movedItems.push(...movingItems);
    });

    // Add to top of archive (newest first)
    archivedItems.unshift(...movedItems);

    // Set cursor to the position where items were deleted
    if (minMovedIndex >= items.length && items.length > 0) {
        activeIndex = items.length - 1;
    } else if (items.length > 0) {
        activeIndex = minMovedIndex;
    } else {
        activeIndex = -1;
    }

    // Apply the same cursor adjustment logic as deletion
    activeIndex = DeleteManager.adjustCursorAfterDeletion(activeIndex, deletedTypes);

    selectedIndices.clear();
    if (activeIndex >= 0) {
        selectedIndices.add(activeIndex);
    }
    anchorIndex = -1;

    render();
    renderInspector();
    showNotification(`${movedItems.length} item(s) archived`, 'codicon-archive');
}

/**
 * Move selected items from Archive back to main list (Cmd+Shift+Left)
 * Items are added to the end of the main items list
 * Parent-child relationships are preserved: selecting parent includes children, selecting child includes parent and siblings
 */
function moveFromArchive() {
    if (archivedSelectedIndices.size === 0) return;

    saveState();

    // Collect all indices to restore (including parent-child relationships)
    const indicesToRestore = new Set();
    const sortedIndices = Array.from(archivedSelectedIndices).sort((a, b) => a - b);

    sortedIndices.forEach(index => {
        if (indicesToRestore.has(index)) return;

        const item = archivedItems[index];

        if (item.indent === Constants.INDENT.PARENT) {
            // Parent selected: include all children
            indicesToRestore.add(index);
            for (let i = index + 1; i < archivedItems.length; i++) {
                if (archivedItems[i].indent === Constants.INDENT.PARENT) break;
                indicesToRestore.add(i);
            }
        } else {
            // Child selected: find parent and include all siblings
            let parentIndex = -1;
            for (let i = index - 1; i >= 0; i--) {
                if (archivedItems[i].indent === Constants.INDENT.PARENT) {
                    parentIndex = i;
                    break;
                }
            }

            if (parentIndex !== -1) {
                // Include parent
                indicesToRestore.add(parentIndex);
                // Include all children of this parent
                for (let i = parentIndex + 1; i < archivedItems.length; i++) {
                    if (archivedItems[i].indent === Constants.INDENT.PARENT) break;
                    indicesToRestore.add(i);
                }
            } else {
                // Orphaned child (no parent found), just restore it
                indicesToRestore.add(index);
            }
        }
    });

    // Get indices to remove (sorted descending to avoid index shifting)
    const indicesToRemove = Array.from(indicesToRestore).sort((a, b) => b - a);
    const movedItems = [];

    indicesToRemove.forEach(index => {
        if (index >= 0 && index < archivedItems.length) {
            const [item] = archivedItems.splice(index, 1);
            // Reset item state (unchecked, preserve indent)
            item.isChecked = false;
            // indent is preserved (not reset to 0)
            movedItems.push(item);
        }
    });

    // Add to end of main items (before any archive section would have been)
    items.push(...movedItems.reverse());

    // Clear archive selection and switch to main items
    archivedSelectedIndices.clear();
    isArchiveActive = false;

    // Select the moved items in main list
    selectedIndices.clear();
    const startIndex = items.length - movedItems.length;
    for (let i = 0; i < movedItems.length; i++) {
        selectedIndices.add(startIndex + i);
    }
    activeIndex = startIndex;
    anchorIndex = startIndex;

    render();
    renderInspector();
    showNotification(`${movedItems.length} item(s) restored`, 'codicon-discard');
}

function moveToNextHeading() {
    if (selectedIndices.size === 0 && activeIndex >= 0) {
        selectedIndices.add(activeIndex);
    }
    if (selectedIndices.size === 0) return;

    saveState();

    // Capture state before move using SelectionManager
    const capturedState = SelectionManager.captureState(items);

    // Identify items to move using ItemUtils
    const itemsToMove = ItemUtils.collectItemsToProcess(items, selectedIndices, { excludeHeadings: true });

    // Sort Descending for processing (Bottom to Top)
    itemsToMove.reverse();

    const movedIds = new Set(itemsToMove.map(i => i.id));
    const allDisplacedItems = [];
    let anyMoved = false;

    itemsToMove.forEach(item => {
        const index = items.findIndex(i => i.id === item.id);
        if (index === -1) return;

        // Get item with children
        const { items: movingItems, count } = ItemUtils.getItemWithChildren(items, index);

        // Find next heading (but not Archive)
        let nextHeadingIndex = -1;
        for (let i = index + count; i < items.length; i++) {
            if (items[i].type === 'heading') {
                // Skip Archive heading
                if (ItemUtils.isArchiveHeading(items[i])) {
                    return;
                }
                nextHeadingIndex = i;
                break;
            }
        }

        if (nextHeadingIndex === -1) return;

        const displacedItems = items.slice(index + count, nextHeadingIndex + 1);
        const realDisplacedItems = displacedItems.filter(dItem => !movedIds.has(dItem.id));
        allDisplacedItems.push(...realDisplacedItems);

        if (item.indent === Constants.INDENT.CHILD) {
            movingItems[0].indent = Constants.INDENT.PARENT;
        }

        items.splice(index, count);
        const newHeadingIndex = nextHeadingIndex - count;
        const insertIndex = newHeadingIndex + 1;

        items.splice(insertIndex, 0, ...movingItems);
        anyMoved = true;
    });

    if (!anyMoved) return;

    // Restore selection using SelectionManager
    SelectionManager.restoreState(items, capturedState);

    render();

    // Scroll to active
    const renderedItems = document.querySelectorAll('.item');
    if (activeIndex >= 0 && renderedItems[activeIndex]) {
        renderedItems[activeIndex].scrollIntoView({ block: 'nearest' });
    }
    renderInspector();

    // Check if any moved item ended up in Archive (when hidden)
    let anyInArchive = false;
    const { selectedIds } = capturedState;
    items.forEach((item, idx) => {
        if (ItemUtils.isArchiveHeading(item)) {
            anyInArchive = true;
        } else if (anyInArchive && selectedIds.has(item.id) && isArchiveHidden) {
            selectArchiveHeading();
            return;
        }
    });

    animateDisplacedItems(allDisplacedItems, 'down');
}

function moveToPrevHeading() {
    if (selectedIndices.size === 0 && activeIndex >= 0) {
        selectedIndices.add(activeIndex);
    }
    if (selectedIndices.size === 0) return;

    saveState();

    // Capture state before move using SelectionManager
    const capturedState = SelectionManager.captureState(items);

    // Identify items to move using ItemUtils
    const itemsToMove = ItemUtils.collectItemsToProcess(items, selectedIndices, { excludeHeadings: true });

    // Sort Descending for processing (Bottom to Top)
    itemsToMove.reverse();

    const movedIds = new Set(itemsToMove.map(i => i.id));
    const allDisplacedItems = [];
    let anyMoved = false;

    itemsToMove.forEach(item => {
        const index = items.findIndex(i => i.id === item.id);
        if (index === -1) return;

        // Get item with children
        const { items: movingItems, count } = ItemUtils.getItemWithChildren(items, index);

        // Find all headings above
        const headingsAbove = [];
        for (let i = index - 1; i >= 0; i--) {
            if (items[i].type === 'heading') {
                headingsAbove.push({ index: i, item: items[i] });
            }
        }

        let insertIndex = 0;
        if (headingsAbove.length === 1) {
            insertIndex = headingsAbove[0].index + 1;
        } else if (headingsAbove.length > 1) {
            insertIndex = headingsAbove[1].index + 1;
        }

        // Check if we are already at the target position
        if (insertIndex === index) return;

        if (item.indent === Constants.INDENT.CHILD) {
            movingItems[0].indent = Constants.INDENT.PARENT;
        }

        const displacedItems = items.slice(insertIndex, index);
        const realDisplacedItems = displacedItems.filter(dItem => !movedIds.has(dItem.id));
        allDisplacedItems.push(...realDisplacedItems);

        items.splice(index, count);
        items.splice(insertIndex, 0, ...movingItems);
        anyMoved = true;
    });

    if (!anyMoved) return;

    // Restore selection using SelectionManager
    SelectionManager.restoreState(items, capturedState);

    render();

    const renderedItems = document.querySelectorAll('.item');
    if (activeIndex >= 0 && renderedItems[activeIndex]) {
        renderedItems[activeIndex].scrollIntoView({ block: 'nearest' });
    }
    renderInspector();

    animateDisplacedItems(allDisplacedItems, 'up');
}

function animateDisplacedItems(displacedItems, direction) {
    // direction is the user's move direction ('up' or 'down')
    // If user moves UP, displaced items move DOWN. User wants them to start at "slightly lower position" (+10px) -> offset-down
    // If user moves DOWN, displaced items move UP. User wants them to start at "slightly upper position" (-10px) -> offset-up

    const offsetClass = direction === 'up' ? 'offset-down' : 'offset-up';

    // Batch DOM reads/writes to minimize reflow
    requestAnimationFrame(() => {
        displacedItems.forEach(dItem => {
            const el = document.querySelector(`.item[data-id="${dItem.id}"]`);
            if (el) {
                el.classList.add('moving', offsetClass);
            }
        });

        // Remove classes after animation completes
        requestAnimationFrame(() => {
            displacedItems.forEach(dItem => {
                const el = document.querySelector(`.item[data-id="${dItem.id}"]`);
                if (el) {
                    el.classList.remove('moving', offsetClass);
                }
            });
        });
    });
}

function startEditing(id, isNew) {
    editingId = id;
    isNewItem = isNew;
    render(false); // Don't save just because we started editing (though render() is called by addItem with false already)

    const input = document.querySelector(`input[data-edit-id="${id}"]`);
    if (input) {
        input.focus();
    }
}

function stopEditing(save) {
    if (isUndoingRedoing) return;
    if (!editingId) return;

    const itemIndex = items.findIndex(i => i.id === editingId);
    if (itemIndex === -1) {
        editingId = null;
        return;
    }

    const input = document.querySelector(`input[data-edit-id="${editingId}"]`);
    const newTitle = input ? input.value.trim() : '';

    if (save) {
        EditingManager.saveEdit(itemIndex, newTitle);
    } else {
        EditingManager.cancelEdit(itemIndex);
    }
}

function render(notify = true) {
    const listContainer = document.getElementById('item-list');
    listContainer.innerHTML = '';

    if (notify) {
        vscode.postMessage({
            type: 'updateItems',
            items: items,
            archivedItems: archivedItems
        });
    }

    // Render main items (no archive heading or items in this loop)
    items.forEach((item, index) => {
        // Create base item div
        const itemDiv = RenderUtils.createItemDiv(item, index);
        const contentDiv = document.createElement('div');
        contentDiv.className = 'item-content';

        // Add checkbox for todo items
        if (item.type === 'todo') {
            const checkbox = RenderUtils.createCheckbox(item, itemDiv, () => {
                vscode.postMessage({ type: 'updateItems', items: items, archivedItems: archivedItems });
            });
            contentDiv.appendChild(checkbox);
        }

        // Title or Edit Input
        if (editingId === item.id) {
            const input = RenderUtils.createEditInput(item, {
                onTab: (isShift, inputEl) => {
                    item.title = inputEl.value;
                    ignoreBlur = true;
                    const newIndent = item.indent + (isShift ? -1 : 1);
                    if (newIndent >= Constants.INDENT.PARENT && newIndent <= Constants.INDENT.MAX) {
                        if (!isShift) {
                            if (index > 0 && items[index - 1].type !== 'heading') {
                                item.indent = newIndent;
                                render();
                            }
                        } else {
                            item.indent = newIndent;
                            render();
                        }
                    }
                    ignoreBlur = false;
                },
                onEnter: (inputEl) => {
                    item.title = inputEl.value;
                    stopEditing(true);
                },
                onEscape: () => stopEditing(false),
                onBlur: () => {
                    if (!ignoreBlur) stopEditing(true);
                }
            });
            contentDiv.appendChild(input);
            itemDiv.classList.add('editing');
        } else {
            // Display mode
            const titleSpan = RenderUtils.createTitleSpan(item, index, items);
            contentDiv.appendChild(titleSpan);

            // Click handlers
            itemDiv.onmousedown = (e) => {
                // Deselect archived items when clicking on main items
                archivedSelectedIndices.clear();
                archivedActiveIndex = -1;
                archivedAnchorIndex = -1;
                isArchiveActive = false;
                isArchiveHeaderSelected = false;

                if (e.shiftKey) {
                    selectItem(index, false, true);
                } else if (e.metaKey || e.ctrlKey) {
                    selectItem(index, true, false);
                } else {
                    selectItem(index);
                }
            };

            itemDiv.ondblclick = (e) => {
                e.stopPropagation();
                startEditing(item.id, false);
            };

            // Note icon
            const noteIcon = RenderUtils.createNoteIcon(item);
            if (noteIcon) contentDiv.appendChild(noteIcon);
        }

        itemDiv.appendChild(contentDiv);
        listContainer.appendChild(itemDiv);
    });

    // Render Archive section (only if there are archived items)
    if (archivedItems.length > 0) {
        renderArchiveSection(listContainer);
    }

    // Restore selection classes for main items
    if (activeIndex >= 0 && activeIndex < items.length && !isArchiveActive) {
        RenderUtils.applySelectionClasses(listContainer, selectedIndices, isPreSelected);
    }

    // Restore focus if editing
    RenderUtils.focusEditInput(editingId);
}

/**
 * Render the Archive section
 * @param {HTMLElement} listContainer - The container to append to
 */
function renderArchiveSection(listContainer) {
    // Archive header
    const archiveHeader = document.createElement('div');
    archiveHeader.className = 'item item-archive';
    archiveHeader.dataset.index = 'archive-header';

    // Add selected class if archive header is selected
    if (isArchiveHeaderSelected) {
        archiveHeader.classList.add('selected');
    }

    const archiveContent = document.createElement('div');
    archiveContent.className = 'item-content';

    // Archive toggle icon (moved to left)
    const archiveIcon = document.createElement('div');
    archiveIcon.className = 'archive-icon';
    const icon = document.createElement('i');
    icon.className = isArchiveHidden ? 'codicon codicon-chevron-right' : 'codicon codicon-chevron-down';
    archiveIcon.appendChild(icon);
    archiveContent.appendChild(archiveIcon);

    const archiveTitle = document.createElement('span');
    archiveTitle.className = 'item-title';
    archiveTitle.textContent = `Archive [${archivedItems.length}]`;
    archiveContent.appendChild(archiveTitle);

    // Clear archive button
    const clearButton = document.createElement('button');
    clearButton.className = 'archive-clear-btn';
    clearButton.title = 'Clear all archived items';
    const clearIcon = document.createElement('i');
    clearIcon.className = 'codicon codicon-trash';
    clearButton.appendChild(clearIcon);
    clearButton.onmousedown = (e) => {
        e.stopPropagation();
        if (archivedItems.length > 0) {
            vscode.postMessage({
                type: 'clearArchiveConfirm'
            });
        }
    };
    archiveContent.appendChild(clearButton);

    archiveHeader.appendChild(archiveContent);

    // Click handler for archive header - toggle open/close
    archiveHeader.onmousedown = (e) => {
        e.stopPropagation();
        isArchiveHidden = !isArchiveHidden;
        render(false);
    };

    listContainer.appendChild(archiveHeader);

    // Render archived items if expanded
    if (!isArchiveHidden) {
        archivedItems.forEach((item, index) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = `item archived-item item-${item.type} indent-${item.indent}`;
            itemDiv.dataset.archivedIndex = index;
            itemDiv.style.paddingLeft = `${RenderUtils.calculatePadding(item)}px`;

            // Add selected class if selected
            if (archivedSelectedIndices.has(index)) {
                itemDiv.classList.add('selected');
            }

            const contentDiv = document.createElement('div');
            contentDiv.className = 'item-content';

            // Checkbox (always checked, disabled)
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = true;
            checkbox.disabled = true;
            checkbox.className = 'item-checkbox';
            contentDiv.appendChild(checkbox);

            // Title
            const titleSpan = document.createElement('span');
            titleSpan.className = 'item-title';
            titleSpan.textContent = item.title;
            contentDiv.appendChild(titleSpan);

            // Note icon
            if (item.note && item.note.trim().length > 0) {
                const noteIcon = document.createElement('i');
                noteIcon.className = 'codicon codicon-note';
                contentDiv.appendChild(noteIcon);
            }

            itemDiv.appendChild(contentDiv);

            // Click handler for archived items
            itemDiv.onmousedown = (e) => {
                // Deselect main items when clicking on archived items
                selectedIndices.clear();
                activeIndex = -1;
                anchorIndex = -1;
                isArchiveActive = true;
                isArchiveHeaderSelected = false;

                if (e.shiftKey) {
                    // Range selection - expand existing selection (same as main items)
                    if (archivedAnchorIndex === -1) {
                        archivedAnchorIndex = archivedSelectedIndices.size > 0 ? Math.min(...archivedSelectedIndices) : index;
                    }
                    const start = Math.min(archivedAnchorIndex, index);
                    const end = Math.max(archivedAnchorIndex, index);
                    for (let i = start; i <= end; i++) {
                        archivedSelectedIndices.add(i);
                    }
                    archivedActiveIndex = index;
                } else if (e.metaKey || e.ctrlKey) {
                    // Toggle selection
                    if (archivedSelectedIndices.has(index)) {
                        archivedSelectedIndices.delete(index);
                        if (archivedActiveIndex === index) {
                            archivedActiveIndex = archivedSelectedIndices.size > 0 ? Math.min(...archivedSelectedIndices) : -1;
                        }
                    } else {
                        archivedSelectedIndices.add(index);
                        archivedActiveIndex = index;
                        archivedAnchorIndex = index;
                    }
                } else {
                    // Single selection
                    archivedSelectedIndices.clear();
                    archivedSelectedIndices.add(index);
                    archivedActiveIndex = index;
                    archivedAnchorIndex = index;
                }

                render(false);
                renderInspector();
            };

            listContainer.appendChild(itemDiv);
        });
    }
}

function showNotification(message, iconClass) {
    const container = document.getElementById('notification-area');
    if (!container) return;

    // Clear existing notifications
    container.innerHTML = '';

    const toast = document.createElement('div');
    toast.className = 'notification-toast';

    if (iconClass) {
        const icon = document.createElement('i');
        icon.className = `codicon ${iconClass}`;
        toast.appendChild(icon);
    }

    const text = document.createElement('span');
    text.textContent = message;
    toast.appendChild(text);

    container.appendChild(toast);

    // Remove after animation
    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, Constants.NOTIFICATION_DURATION);
}


// Inspector Logic
const inspectorNoteDisplay = document.getElementById('inspector-note-display');
const inspectorNote = document.getElementById('inspector-note');
// We need to track note changes for undo/redo.
// Input event fires on every keystroke. We don't want to save state on every keystroke.
// Save state on focus (before changes) and maybe debounce?
// Or save on blur if changed?

let noteOriginalValue = '';
let isEditingNote = false;

// Click on display to edit
inspectorNoteDisplay.addEventListener('click', () => {
    if (!isEditingNote) {
        startEditingNote();
    }
});

function startEditingNote() {
    isEditingNote = true;
    if (activeIndex >= 0 && activeIndex < items.length) {
        noteOriginalValue = items[activeIndex].note || '';
        inspectorNote.value = noteOriginalValue;
    }
    inspectorNoteDisplay.style.display = 'none';
    inspectorNote.style.display = '';
    inspectorNote.focus();
}

function stopEditingNote(save = true) {
    if (!isEditingNote) return;
    isEditingNote = false;

    if (save && activeIndex >= 0 && activeIndex < items.length) {
        const item = items[activeIndex];
        let newValue = inspectorNote.value;
        if (newValue.trim().length === 0) {
            newValue = '';
        }

        if (newValue !== noteOriginalValue) {
            item.note = noteOriginalValue;
            saveState();
            item.note = newValue;
            inspectorNote.value = newValue;
        }

        const itemDiv = document.querySelector(`.item[data-index="${activeIndex}"]`);
        if (itemDiv) {
            const contentDiv = itemDiv.querySelector('.item-content');
            const existingIcon = contentDiv.querySelector('.item-note-icon');
            const hasNote = item.note && item.note.trim().length > 0;
            if (hasNote && !existingIcon) {
                const noteIcon = document.createElement('span');
                noteIcon.className = 'codicon codicon-note item-note-icon';
                contentDiv.appendChild(noteIcon);
            } else if (!hasNote && existingIcon) {
                existingIcon.remove();
            }
        }

        // Always send update to extension if note was edited
        render(true);
    }

    inspectorNote.style.display = 'none';
    inspectorNoteDisplay.style.display = '';
    renderNoteDisplay();
}

function renderNoteDisplay() {
    if (activeIndex >= 0 && activeIndex < items.length) {
        const item = items[activeIndex];
        const noteContent = item.note || '';

        if (noteContent.trim().length === 0) {
            inspectorNoteDisplay.textContent = 'Add a note...';
            inspectorNoteDisplay.style.color = 'var(--vscode-input-placeholderForeground)';
        } else {
            inspectorNoteDisplay.textContent = noteContent;
            inspectorNoteDisplay.style.color = '';
        }
    } else {
        inspectorNoteDisplay.textContent = '';
    }
}

inspectorNote.addEventListener('focus', (e) => {
    if (activeIndex >= 0 && activeIndex < items.length) {
        noteOriginalValue = items[activeIndex].note || '';
    }
});

inspectorNote.addEventListener('input', (e) => {
    if (activeIndex >= 0 && activeIndex < items.length) {
        items[activeIndex].note = e.target.value;
    }
});

inspectorNote.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        e.preventDefault();
        stopEditingNote(true);
    }
});

inspectorNote.addEventListener('blur', () => {
    stopEditingNote(true);
});

// Inspector Folding Logic
const inspectorHeader = document.getElementById('inspector-header');
const inspectorContent = document.getElementById('inspector-content');
const inspectorIcon = document.getElementById('inspector-toggle-icon');
const inspector = document.getElementById('inspector');

let isInspectorCollapsed = false; // Default to expanded

function updateInspectorState() {
    if (isInspectorCollapsed) {
        inspector.classList.add('collapsed');
        inspectorContent.style.display = 'none';
        inspectorIcon.classList.remove('codicon-chevron-down');
        inspectorIcon.classList.add('codicon-chevron-right');
    } else {
        inspector.classList.remove('collapsed');
        inspectorContent.style.display = 'flex';
        inspectorIcon.classList.remove('codicon-chevron-right');
        inspectorIcon.classList.add('codicon-chevron-down');
    }
}

// Initialize state
updateInspectorState();

inspectorHeader.addEventListener('click', () => {
    isInspectorCollapsed = !isInspectorCollapsed;
    updateInspectorState();
});

function renderInspector() {
    const inspector = document.getElementById('inspector');

    // Hide inspector when archive items are selected
    if (isArchiveActive || isArchiveHeaderSelected) {
        inspector.style.display = 'none';
        if (isEditingNote) {
            stopEditingNote(true);
        }
        return;
    }

    // Re-enable click for main items
    inspectorNoteDisplay.style.pointerEvents = '';

    if (activeIndex >= 0 && activeIndex < items.length) {
        inspector.style.display = 'flex';
        const item = items[activeIndex];

        // Update display and textarea
        if (!isEditingNote) {
            renderNoteDisplay();
        }

        // Only update textarea value if we switched items or if it's not focused
        if (inspectorNote.dataset.itemId !== item.id) {
            inspectorNote.value = item.note || '';
            inspectorNote.dataset.itemId = item.id;
        } else if (!isEditingNote) {
            // If not editing, sync the value
            inspectorNote.value = item.note || '';
        }
    } else {
        inspector.style.display = 'none';
        if (isEditingNote) {
            stopEditingNote(true);
        }
    }
}

// Handle focus loss from ArchyTask view
window.addEventListener('blur', () => {
    // When focus leaves the ArchyTask view, enter pre-selection state
    enterPreSelectionState();
});

// Handle focus regain to ArchyTask view
window.addEventListener('focus', () => {
    // Exit pre-selection state when focus returns
    exitPreSelectionState();
});

// Disable context menu (right-click) in ArchyTask
document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
});

// Signal that we are ready
vscode.postMessage({ type: 'ready' });
