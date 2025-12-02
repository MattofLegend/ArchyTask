/**
 * Unit tests for ItemUtils and SelectionManager
 * Run with: node media/main.test.js
 */

// ============================================================
// Mock dependencies for testing
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
// ItemUtils (copy from main.js for standalone testing)
// ============================================================
const ItemUtils = {
    generateId() {
        return Date.now().toString() + Math.random().toString(36).substr(2, 9);
    },

    findArchiveIndex(itemList) {
        return itemList.findIndex(i => i.type === 'heading' && i.title === 'Archive');
    },

    isArchiveHeading(item) {
        return item && item.type === 'heading' && item.title === 'Archive';
    },

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

    getItemWithChildren(itemList, index) {
        if (index < 0 || index >= itemList.length) return { items: [], count: 0 };
        
        const item = itemList[index];
        let count = 1;

        if (item.type === 'heading') {
            for (let i = index + 1; i < itemList.length; i++) {
                if (itemList[i].type === 'heading') break;
                count++;
            }
        } else if (item.indent === Constants.INDENT.PARENT) {
            for (let i = index + 1; i < itemList.length; i++) {
                if (itemList[i].indent <= Constants.INDENT.PARENT || itemList[i].type === 'heading') break;
                count++;
            }
        }

        return {
            items: itemList.slice(index, index + count),
            count
        };
    },

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

    collectItemsToProcess(itemList, selectedSet, options = {}) {
        const { excludeHeadings = true } = options;
        const result = [];
        const sortedIndices = Array.from(selectedSet).sort((a, b) => a - b);

        sortedIndices.forEach(index => {
            const item = itemList[index];
            if (!item) return;
            if (excludeHeadings && item.type === 'heading') return;

            if (item.indent === Constants.INDENT.CHILD && this.isParentSelected(itemList, index, selectedSet)) {
                return;
            }

            result.push(item);
        });

        return result;
    },

    deepCopyItems(itemList, generateNewIds = false) {
        return itemList.map(item => {
            const copy = JSON.parse(JSON.stringify(item));
            if (generateNewIds) {
                copy.id = this.generateId();
            }
            return copy;
        });
    },

    hasParentAbove(itemList, position) {
        for (let i = position - 1; i >= 0; i--) {
            if (itemList[i].indent === Constants.INDENT.PARENT && itemList[i].type !== 'heading') {
                return true;
            }
            if (itemList[i].type === 'heading') break;
        }
        return false;
    },

    adjustOrphanedIndent(itemsToInsert, targetList, insertPosition) {
        if (itemsToInsert.length === 0) return;
        if (itemsToInsert[0].indent !== Constants.INDENT.CHILD) return;

        if (insertPosition === 0 || !this.hasParentAbove(targetList, insertPosition)) {
            itemsToInsert[0].indent = Constants.INDENT.PARENT;
        }
    }
};

// ============================================================
// SelectionManager mock (for testing)
// ============================================================
let activeIndex = -1;
let anchorIndex = -1;
let selectedIndices = new Set();

const SelectionManager = {
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

    clear() {
        selectedIndices.clear();
        activeIndex = -1;
        anchorIndex = -1;
    },

    setSingle(index) {
        selectedIndices.clear();
        if (index >= 0) {
            selectedIndices.add(index);
        }
        activeIndex = index;
        anchorIndex = index;
    },

    validate(itemList) {
        if (activeIndex >= itemList.length) {
            activeIndex = -1;
            selectedIndices.clear();
            anchorIndex = -1;
        }
    }
};

// ============================================================
// Test Helper Functions
// ============================================================
let testsPassed = 0;
let testsFailed = 0;

function assertEqual(actual, expected, testName) {
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
        console.log(`  ✅ ${testName}`);
        testsPassed++;
    } else {
        console.log(`  ❌ ${testName}`);
        console.log(`     Expected: ${JSON.stringify(expected)}`);
        console.log(`     Actual:   ${JSON.stringify(actual)}`);
        testsFailed++;
    }
}

function assertTrue(condition, testName) {
    assertEqual(condition, true, testName);
}

function assertFalse(condition, testName) {
    assertEqual(condition, false, testName);
}

function createTestItem(id, type, title, indent = 0, isChecked = false) {
    return { id, type, title, indent, isChecked, note: '' };
}

// ============================================================
// Test Suites
// ============================================================

function testItemUtilsFindArchiveIndex() {
    console.log('\n📋 ItemUtils.findArchiveIndex tests:');
    
    const items1 = [
        createTestItem('1', 'todo', 'Task 1'),
        createTestItem('2', 'heading', 'Archive'),
    ];
    assertEqual(ItemUtils.findArchiveIndex(items1), 1, 'finds Archive at index 1');
    
    const items2 = [
        createTestItem('1', 'todo', 'Task 1'),
        createTestItem('2', 'heading', 'Section'),
    ];
    assertEqual(ItemUtils.findArchiveIndex(items2), -1, 'returns -1 when no Archive');
    
    const items3 = [];
    assertEqual(ItemUtils.findArchiveIndex(items3), -1, 'returns -1 for empty list');
}

function testItemUtilsIsArchiveHeading() {
    console.log('\n📋 ItemUtils.isArchiveHeading tests:');
    
    assertTrue(ItemUtils.isArchiveHeading({ type: 'heading', title: 'Archive' }), 'returns true for Archive heading');
    assertFalse(ItemUtils.isArchiveHeading({ type: 'heading', title: 'Section' }), 'returns false for other heading');
    assertFalse(ItemUtils.isArchiveHeading({ type: 'todo', title: 'Archive' }), 'returns false for todo named Archive');
    assertTrue(!ItemUtils.isArchiveHeading(null), 'returns falsy for null');
    assertTrue(!ItemUtils.isArchiveHeading(undefined), 'returns falsy for undefined');
}

function testItemUtilsGetChildCount() {
    console.log('\n📋 ItemUtils.getChildCount tests:');
    
    const items = [
        createTestItem('1', 'todo', 'Parent 1', 0),
        createTestItem('2', 'todo', 'Child 1', 1),
        createTestItem('3', 'todo', 'Child 2', 1),
        createTestItem('4', 'todo', 'Parent 2', 0),
        createTestItem('5', 'heading', 'Section'),
    ];
    
    assertEqual(ItemUtils.getChildCount(items, 0), 2, 'Parent 1 has 2 children');
    assertEqual(ItemUtils.getChildCount(items, 3), 0, 'Parent 2 has 0 children');
    assertEqual(ItemUtils.getChildCount(items, 1), 0, 'Child returns 0');
    assertEqual(ItemUtils.getChildCount(items, 4), 0, 'Heading returns 0');
    assertEqual(ItemUtils.getChildCount(items, -1), 0, 'Invalid index returns 0');
    assertEqual(ItemUtils.getChildCount(items, 100), 0, 'Out of bounds returns 0');
}

function testItemUtilsGetItemWithChildren() {
    console.log('\n📋 ItemUtils.getItemWithChildren tests:');
    
    const items = [
        createTestItem('1', 'todo', 'Parent 1', 0),
        createTestItem('2', 'todo', 'Child 1', 1),
        createTestItem('3', 'todo', 'Child 2', 1),
        createTestItem('4', 'todo', 'Parent 2', 0),
        createTestItem('5', 'heading', 'Section'),
        createTestItem('6', 'todo', 'Task under section', 0),
    ];
    
    let result = ItemUtils.getItemWithChildren(items, 0);
    assertEqual(result.count, 3, 'Parent 1 returns count 3');
    assertEqual(result.items.length, 3, 'Parent 1 returns 3 items');
    
    result = ItemUtils.getItemWithChildren(items, 1);
    assertEqual(result.count, 1, 'Child returns count 1');
    
    result = ItemUtils.getItemWithChildren(items, 4);
    assertEqual(result.count, 2, 'Heading returns count 2 (itself + following task)');
    
    result = ItemUtils.getItemWithChildren(items, -1);
    assertEqual(result.count, 0, 'Invalid index returns count 0');
}

function testItemUtilsIsParentSelected() {
    console.log('\n📋 ItemUtils.isParentSelected tests:');
    
    const items = [
        createTestItem('1', 'todo', 'Parent 1', 0),
        createTestItem('2', 'todo', 'Child 1', 1),
        createTestItem('3', 'todo', 'Parent 2', 0),
    ];
    
    const selected1 = new Set([0]); // Parent selected
    assertTrue(ItemUtils.isParentSelected(items, 1, selected1), 'child is child of selected parent');
    
    const selected2 = new Set([2]); // Different parent selected
    assertFalse(ItemUtils.isParentSelected(items, 1, selected2), 'child is not child of selected parent');
    
    assertFalse(ItemUtils.isParentSelected(items, 0, selected1), 'parent returns false');
}

function testItemUtilsCollectItemsToProcess() {
    console.log('\n📋 ItemUtils.collectItemsToProcess tests:');
    
    const items = [
        createTestItem('1', 'todo', 'Parent 1', 0),
        createTestItem('2', 'todo', 'Child 1', 1),
        createTestItem('3', 'todo', 'Parent 2', 0),
        createTestItem('4', 'heading', 'Section'),
    ];
    
    // Parent and child both selected - child should be excluded
    const selected1 = new Set([0, 1]);
    let result = ItemUtils.collectItemsToProcess(items, selected1);
    assertEqual(result.length, 1, 'filters out child when parent is selected');
    assertEqual(result[0].id, '1', 'keeps only parent');
    
    // Only child selected
    const selected2 = new Set([1]);
    result = ItemUtils.collectItemsToProcess(items, selected2);
    assertEqual(result.length, 1, 'keeps child when parent not selected');
    
    // Heading should be excluded
    const selected3 = new Set([3]);
    result = ItemUtils.collectItemsToProcess(items, selected3, { excludeHeadings: true });
    assertEqual(result.length, 0, 'excludes heading by default');
    
    result = ItemUtils.collectItemsToProcess(items, selected3, { excludeHeadings: false });
    assertEqual(result.length, 1, 'includes heading when excludeHeadings is false');
}

function testItemUtilsDeepCopyItems() {
    console.log('\n📋 ItemUtils.deepCopyItems tests:');
    
    const items = [
        createTestItem('1', 'todo', 'Task 1'),
    ];
    
    const copy1 = ItemUtils.deepCopyItems(items, false);
    assertEqual(copy1[0].id, '1', 'keeps original ID when generateNewIds is false');
    
    const copy2 = ItemUtils.deepCopyItems(items, true);
    assertTrue(copy2[0].id !== '1', 'generates new ID when generateNewIds is true');
    
    // Ensure deep copy
    copy1[0].title = 'Modified';
    assertEqual(items[0].title, 'Task 1', 'original is not modified');
}

function testItemUtilsHasParentAbove() {
    console.log('\n📋 ItemUtils.hasParentAbove tests:');
    
    const items = [
        createTestItem('1', 'todo', 'Parent 1', 0),
        createTestItem('2', 'todo', 'Child 1', 1),
        createTestItem('3', 'heading', 'Section'),
        createTestItem('4', 'todo', 'Task after heading', 0),
    ];
    
    assertTrue(ItemUtils.hasParentAbove(items, 2), 'position 2 has parent above');
    assertFalse(ItemUtils.hasParentAbove(items, 0), 'position 0 has no parent above');
    // Position 3 is after heading - the heading blocks the search, so no parent is found
    assertFalse(ItemUtils.hasParentAbove(items, 3), 'position after heading has no parent (heading blocks)');
}

function testItemUtilsAdjustOrphanedIndent() {
    console.log('\n📋 ItemUtils.adjustOrphanedIndent tests:');
    
    const targetItems = [
        createTestItem('1', 'heading', 'Section'),
        createTestItem('2', 'todo', 'Task 1', 0),
    ];
    
    // Child item being inserted at position 0
    const toInsert1 = [createTestItem('3', 'todo', 'Orphan', 1)];
    ItemUtils.adjustOrphanedIndent(toInsert1, targetItems, 0);
    assertEqual(toInsert1[0].indent, 0, 'adjusts to indent 0 when inserted at position 0');
    
    // Child item being inserted after parent
    const toInsert2 = [createTestItem('4', 'todo', 'Child', 1)];
    ItemUtils.adjustOrphanedIndent(toInsert2, targetItems, 2);
    assertEqual(toInsert2[0].indent, 1, 'keeps indent 1 when parent exists above');
    
    // Parent item - should not be modified
    const toInsert3 = [createTestItem('5', 'todo', 'Parent', 0)];
    ItemUtils.adjustOrphanedIndent(toInsert3, targetItems, 0);
    assertEqual(toInsert3[0].indent, 0, 'does not modify indent 0 items');
}

function testSelectionManagerCaptureAndRestore() {
    console.log('\n📋 SelectionManager.captureState/restoreState tests:');
    
    const items = [
        createTestItem('a', 'todo', 'Task A'),
        createTestItem('b', 'todo', 'Task B'),
        createTestItem('c', 'todo', 'Task C'),
    ];
    
    // Set up selection state
    selectedIndices.clear();
    selectedIndices.add(0);
    selectedIndices.add(2);
    activeIndex = 2;
    
    // Capture state
    const captured = SelectionManager.captureState(items);
    assertEqual(captured.selectedIds.size, 2, 'captures 2 selected IDs');
    assertTrue(captured.selectedIds.has('a'), 'captures ID a');
    assertTrue(captured.selectedIds.has('c'), 'captures ID c');
    assertEqual(captured.activeItemId, 'c', 'captures active item ID');
    
    // Simulate array mutation (move item b to front)
    const reordered = [items[1], items[0], items[2]]; // b, a, c
    
    // Restore state
    SelectionManager.restoreState(reordered, captured);
    assertTrue(selectedIndices.has(1), 'restores selection for item a at new index 1');
    assertTrue(selectedIndices.has(2), 'restores selection for item c at index 2');
    assertEqual(activeIndex, 2, 'restores activeIndex for item c');
}

function testSelectionManagerClearAndSetSingle() {
    console.log('\n📋 SelectionManager.clear/setSingle tests:');
    
    // Set up some state
    selectedIndices.add(0);
    selectedIndices.add(1);
    activeIndex = 1;
    anchorIndex = 0;
    
    SelectionManager.clear();
    assertEqual(selectedIndices.size, 0, 'clear empties selectedIndices');
    assertEqual(activeIndex, -1, 'clear sets activeIndex to -1');
    assertEqual(anchorIndex, -1, 'clear sets anchorIndex to -1');
    
    SelectionManager.setSingle(5);
    assertTrue(selectedIndices.has(5), 'setSingle adds index to selection');
    assertEqual(selectedIndices.size, 1, 'setSingle keeps only one index');
    assertEqual(activeIndex, 5, 'setSingle sets activeIndex');
    assertEqual(anchorIndex, 5, 'setSingle sets anchorIndex');
}

function testSelectionManagerValidate() {
    console.log('\n📋 SelectionManager.validate tests:');
    
    const items = [createTestItem('1', 'todo', 'Task 1')];
    
    // Set invalid state
    selectedIndices.add(5);
    activeIndex = 5;
    anchorIndex = 5;
    
    SelectionManager.validate(items);
    assertEqual(selectedIndices.size, 0, 'validate clears invalid selectedIndices');
    assertEqual(activeIndex, -1, 'validate resets invalid activeIndex');
    assertEqual(anchorIndex, -1, 'validate resets invalid anchorIndex');
}

// ============================================================
// MoveUtils (copy from main.js for standalone testing)
// ============================================================
const MoveUtils = {
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

    isContiguous(indices) {
        for (let i = 0; i < indices.length - 1; i++) {
            if (indices[i + 1] !== indices[i] + 1) {
                return false;
            }
        }
        return true;
    },

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

    updateSelectionByIds(itemList, movingIds) {
        selectedIndices.clear();
        itemList.forEach((item, idx) => {
            if (movingIds.has(item.id)) {
                selectedIndices.add(idx);
            }
        });
    },

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
// MoveUtils Tests
// ============================================================
function testMoveUtilsExpandSelectionWithChildren() {
    console.log('\n📋 MoveUtils.expandSelectionWithChildren tests:');
    
    const items = [
        createTestItem('1', 'todo', 'Parent 1', 0),
        createTestItem('2', 'todo', 'Child 1', 1),
        createTestItem('3', 'todo', 'Child 2', 1),
        createTestItem('4', 'todo', 'Parent 2', 0),
        createTestItem('5', 'todo', 'Child 3', 1)
    ];
    
    // Selecting parent 1 should include children 1 and 2
    let result = MoveUtils.expandSelectionWithChildren([0], items);
    assertEqual(result.length, 3, 'expands to include children');
    assertTrue(result.includes(0), 'includes parent');
    assertTrue(result.includes(1), 'includes child 1');
    assertTrue(result.includes(2), 'includes child 2');
    
    // Selecting just a child doesn't expand
    result = MoveUtils.expandSelectionWithChildren([1], items);
    assertEqual(result.length, 1, 'child alone does not expand');
    
    // Selecting multiple parents expands both
    result = MoveUtils.expandSelectionWithChildren([0, 3], items);
    assertEqual(result.length, 5, 'expands both parents with children');
}

function testMoveUtilsIsContiguous() {
    console.log('\n📋 MoveUtils.isContiguous tests:');
    
    assertTrue(MoveUtils.isContiguous([0, 1, 2]), 'contiguous indices return true');
    assertTrue(MoveUtils.isContiguous([5, 6, 7, 8]), 'another contiguous set');
    assertFalse(MoveUtils.isContiguous([0, 2, 3]), 'gap in indices returns false');
    assertFalse(MoveUtils.isContiguous([0, 1, 3]), 'another gap returns false');
    assertTrue(MoveUtils.isContiguous([0]), 'single index is contiguous');
    assertTrue(MoveUtils.isContiguous([]), 'empty array is contiguous');
}

function testMoveUtilsGetBlockCount() {
    console.log('\n📋 MoveUtils.getBlockCount tests:');
    
    const items = [
        createTestItem('1', 'heading', 'Section 1', 0),
        createTestItem('2', 'todo', 'Task 1', 0),
        createTestItem('3', 'todo', 'Task 2', 0),
        createTestItem('4', 'heading', 'Section 2', 0),
        createTestItem('5', 'todo', 'Parent', 0),
        createTestItem('6', 'todo', 'Child 1', 1),
        createTestItem('7', 'todo', 'Child 2', 1),
        createTestItem('8', 'todo', 'Task 3', 0)
    ];
    
    // Heading includes all items until next heading
    assertEqual(MoveUtils.getBlockCount(items, 0), 3, 'heading counts items until next heading');
    
    // Parent includes its children
    assertEqual(MoveUtils.getBlockCount(items, 4), 3, 'parent counts itself and children');
    
    // Child is just 1
    assertEqual(MoveUtils.getBlockCount(items, 5), 1, 'child counts only itself');
    
    // Task with no children
    assertEqual(MoveUtils.getBlockCount(items, 7), 1, 'single task counts as 1');
}

function testMoveUtilsCheckMovedIntoArchive() {
    console.log('\n📋 MoveUtils.checkMovedIntoArchive tests:');
    
    const items = [
        createTestItem('1', 'todo', 'Task 1', 0),
        createTestItem('2', 'heading', 'Archive', 0),
        createTestItem('3', 'todo', 'Archived Task', 0)
    ];
    
    // Task moved into archive (when hidden)
    assertTrue(
        MoveUtils.checkMovedIntoArchive(items, new Set(['3']), true),
        'detects item in hidden archive'
    );
    
    // Archive not hidden
    assertFalse(
        MoveUtils.checkMovedIntoArchive(items, new Set(['3']), false),
        'returns false when archive not hidden'
    );
    
    // Item not in archive
    assertFalse(
        MoveUtils.checkMovedIntoArchive(items, new Set(['1']), true),
        'returns false when item not in archive'
    );
}

// ============================================================
// HistoryManager (copy from main.js for standalone testing)
// ============================================================
let mockHistory = [];
let mockFuture = [];
let mockItems = [];
let mockIsUndoingRedoing = false;
let mockActiveIndex = -1;
let mockSelectedIndices = new Set();
let mockAnchorIndex = -1;

const HistoryManager = {
    save() {
        if (mockIsUndoingRedoing) return;
        const state = JSON.parse(JSON.stringify(mockItems));
        mockHistory.push(state);
        if (mockHistory.length > Constants.MAX_HISTORY_SIZE) mockHistory.shift();
        mockFuture = [];
    },

    popLast() {
        if (mockHistory.length > 0) {
            mockHistory.pop();
        }
    },

    undo() {
        if (mockIsUndoingRedoing || mockHistory.length === 0) return false;
        
        mockIsUndoingRedoing = true;
        try {
            mockFuture.push(JSON.parse(JSON.stringify(mockItems)));
            mockItems = mockHistory.pop();
            this._validateSelection();
            return true;
        } finally {
            mockIsUndoingRedoing = false;
        }
    },

    redo() {
        if (mockIsUndoingRedoing || mockFuture.length === 0) return false;
        
        mockIsUndoingRedoing = true;
        try {
            mockHistory.push(JSON.parse(JSON.stringify(mockItems)));
            mockItems = mockFuture.pop();
            this._validateSelection();
            return true;
        } finally {
            mockIsUndoingRedoing = false;
        }
    },

    _validateSelection() {
        if (mockActiveIndex >= mockItems.length) mockActiveIndex = -1;
        mockSelectedIndices.clear();
        if (mockActiveIndex >= 0) {
            mockSelectedIndices.add(mockActiveIndex);
            mockAnchorIndex = mockActiveIndex;
        }
    },

    canUndo() {
        return mockHistory.length > 0;
    },

    canRedo() {
        return mockFuture.length > 0;
    }
};

function resetHistoryMocks() {
    mockHistory = [];
    mockFuture = [];
    mockItems = [];
    mockIsUndoingRedoing = false;
    mockActiveIndex = -1;
    mockSelectedIndices = new Set();
    mockAnchorIndex = -1;
}

// ============================================================
// IndentManager (copy from main.js for standalone testing)
// ============================================================
const IndentManager = {
    canChangeIndent(item, index, delta, newIndent) {
        if (item.type === 'heading') return false;
        if (newIndent < Constants.INDENT.PARENT || newIndent > Constants.INDENT.MAX) return false;
        
        if (delta > 0) {
            if (index === 0) return false;
            if (mockItems[index - 1].type === 'heading') return false;
        }
        
        return true;
    }
};

// ============================================================
// HistoryManager Tests
// ============================================================
function testHistoryManagerSave() {
    console.log('\n📋 HistoryManager.save tests:');
    
    resetHistoryMocks();
    mockItems = [createTestItem('1', 'todo', 'Task 1', 0)];
    
    HistoryManager.save();
    assertEqual(mockHistory.length, 1, 'history has 1 entry after save');
    assertFalse(HistoryManager.canRedo(), 'future cleared after save');
    
    // Modify and save again
    mockItems[0].title = 'Modified';
    HistoryManager.save();
    assertEqual(mockHistory.length, 2, 'history has 2 entries after second save');
    assertEqual(mockHistory[0][0].title, 'Task 1', 'first history entry preserved');
}

function testHistoryManagerUndo() {
    console.log('\n📋 HistoryManager.undo tests:');
    
    resetHistoryMocks();
    mockItems = [createTestItem('1', 'todo', 'Original', 0)];
    
    // No undo when history empty
    assertFalse(HistoryManager.undo(), 'returns false when history empty');
    
    // Save and modify
    HistoryManager.save();
    mockItems[0].title = 'Modified';
    
    assertTrue(HistoryManager.undo(), 'returns true when undo performed');
    assertEqual(mockItems[0].title, 'Original', 'items restored to original');
    assertTrue(HistoryManager.canRedo(), 'redo available after undo');
}

function testHistoryManagerRedo() {
    console.log('\n📋 HistoryManager.redo tests:');
    
    resetHistoryMocks();
    mockItems = [createTestItem('1', 'todo', 'Original', 0)];
    
    // No redo when future empty
    assertFalse(HistoryManager.redo(), 'returns false when future empty');
    
    // Save, modify, undo, then redo
    HistoryManager.save();
    mockItems[0].title = 'Modified';
    HistoryManager.undo();
    
    assertTrue(HistoryManager.redo(), 'returns true when redo performed');
    assertEqual(mockItems[0].title, 'Modified', 'items restored to modified state');
}

function testHistoryManagerPopLast() {
    console.log('\n📋 HistoryManager.popLast tests:');
    
    resetHistoryMocks();
    mockItems = [createTestItem('1', 'todo', 'Task 1', 0)];
    
    HistoryManager.save();
    HistoryManager.save();
    assertEqual(mockHistory.length, 2, 'history has 2 entries');
    
    HistoryManager.popLast();
    assertEqual(mockHistory.length, 1, 'history has 1 entry after popLast');
    
    HistoryManager.popLast();
    assertEqual(mockHistory.length, 0, 'history empty after second popLast');
    
    // Should not error when empty
    HistoryManager.popLast();
    assertEqual(mockHistory.length, 0, 'no error when popping empty history');
}

// ============================================================
// IndentManager Tests
// ============================================================
function testIndentManagerCanChangeIndent() {
    console.log('\n📋 IndentManager.canChangeIndent tests:');
    
    resetHistoryMocks();
    mockItems = [
        createTestItem('1', 'heading', 'Section', 0),
        createTestItem('2', 'todo', 'Task 1', 0),
        createTestItem('3', 'todo', 'Task 2', 0)
    ];
    
    // Headings cannot change indent
    assertFalse(
        IndentManager.canChangeIndent(mockItems[0], 0, 1, 1),
        'heading cannot increase indent'
    );
    
    // Cannot indent at position 0
    assertFalse(
        IndentManager.canChangeIndent(mockItems[1], 1, 1, 1),
        'cannot indent item after heading'
    );
    
    // Can indent when previous is not heading
    assertTrue(
        IndentManager.canChangeIndent(mockItems[2], 2, 1, 1),
        'can indent when previous is task'
    );
    
    // Cannot exceed max indent
    const item = { ...mockItems[2], indent: 1 };
    assertFalse(
        IndentManager.canChangeIndent(item, 2, 1, 2),
        'cannot exceed max indent'
    );
    
    // Can dedent
    const childItem = { ...mockItems[2], indent: 1 };
    assertTrue(
        IndentManager.canChangeIndent(childItem, 2, -1, 0),
        'can dedent child to parent'
    );
    
    // Cannot dedent below 0
    assertFalse(
        IndentManager.canChangeIndent(mockItems[2], 2, -1, -1),
        'cannot dedent below 0'
    );
}

// ============================================================
// DeleteManager (copy from main.js for standalone testing)
// ============================================================
const DeleteManager = {
    collectIndicesToDelete(indices) {
        const indicesToDelete = new Set();
        const sortedIndices = Array.from(indices).sort((a, b) => a - b);

        sortedIndices.forEach(index => {
            if (indicesToDelete.has(index)) return;
            
            indicesToDelete.add(index);
            const item = mockItems[index];

            if (item.indent === Constants.INDENT.PARENT && item.type !== 'heading') {
                for (let i = index + 1; i < mockItems.length; i++) {
                    if (mockItems[i].indent === Constants.INDENT.PARENT || mockItems[i].type === 'heading') break;
                    indicesToDelete.add(i);
                }
            }
        });

        return indicesToDelete;
    }
};

// ============================================================
// DeleteManager Tests
// ============================================================
function testDeleteManagerCollectIndicesToDelete() {
    console.log('\n📋 DeleteManager.collectIndicesToDelete tests:');
    
    resetHistoryMocks();
    mockItems = [
        createTestItem('1', 'todo', 'Parent 1', 0),
        createTestItem('2', 'todo', 'Child 1', 1),
        createTestItem('3', 'todo', 'Child 2', 1),
        createTestItem('4', 'todo', 'Parent 2', 0),
        createTestItem('5', 'todo', 'Task', 0)
    ];
    
    // Deleting parent should include children
    let result = DeleteManager.collectIndicesToDelete(new Set([0]));
    assertEqual(result.size, 3, 'parent deletion includes 3 items');
    assertTrue(result.has(0), 'includes parent');
    assertTrue(result.has(1), 'includes child 1');
    assertTrue(result.has(2), 'includes child 2');
    
    // Deleting child only
    result = DeleteManager.collectIndicesToDelete(new Set([1]));
    assertEqual(result.size, 1, 'child deletion is only 1 item');
    assertTrue(result.has(1), 'includes only the child');
    
    // Deleting parent without children
    result = DeleteManager.collectIndicesToDelete(new Set([4]));
    assertEqual(result.size, 1, 'single parent is 1 item');
    
    // Multiple selections
    result = DeleteManager.collectIndicesToDelete(new Set([0, 4]));
    assertEqual(result.size, 4, 'multiple parents with children');
}

// ============================================================
// Run All Tests
// ============================================================
function runAllTests() {
    console.log('🧪 Running ItemUtils, SelectionManager and MoveUtils Tests\n');
    console.log('='.repeat(50));
    
    // ItemUtils tests
    testItemUtilsFindArchiveIndex();
    testItemUtilsIsArchiveHeading();
    testItemUtilsGetChildCount();
    testItemUtilsGetItemWithChildren();
    testItemUtilsIsParentSelected();
    testItemUtilsCollectItemsToProcess();
    testItemUtilsDeepCopyItems();
    testItemUtilsHasParentAbove();
    testItemUtilsAdjustOrphanedIndent();
    
    // SelectionManager tests
    testSelectionManagerCaptureAndRestore();
    testSelectionManagerClearAndSetSingle();
    testSelectionManagerValidate();
    
    // MoveUtils tests
    testMoveUtilsExpandSelectionWithChildren();
    testMoveUtilsIsContiguous();
    testMoveUtilsGetBlockCount();
    testMoveUtilsCheckMovedIntoArchive();
    
    // HistoryManager tests
    testHistoryManagerSave();
    testHistoryManagerUndo();
    testHistoryManagerRedo();
    testHistoryManagerPopLast();
    
    // IndentManager tests
    testIndentManagerCanChangeIndent();
    
    // DeleteManager tests
    testDeleteManagerCollectIndicesToDelete();
    
    console.log('\n' + '='.repeat(50));
    console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed`);
    
    if (testsFailed > 0) {
        process.exit(1);
    }
}

runAllTests();
