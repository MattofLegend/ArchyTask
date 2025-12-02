import * as vscode from "vscode";
import { parseMarkdown, stringifyItems } from './parser';

export class SidebarProvider implements vscode.WebviewViewProvider {
  _view?: vscode.WebviewView;
  _doc?: vscode.TextDocument;

  constructor(private readonly _extensionUri: vscode.Uri, private readonly _context: vscode.ExtensionContext) {}

	private _getHtmlForWebview(webview: vscode.Webview) {
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "style.css"));
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "main.js"));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "codicons", "codicon.css"));

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link href="${styleUri}" rel="stylesheet">
                <link href="${codiconsUri}" rel="stylesheet">
				<title>ArchyTask</title>
			</head>
			<body>
                <div class="header">
                  <div class="header-left">
                    <button id="btn-add-todo" data-tooltip="Add Task">
                      <i class="codicon codicon-plus"></i>
                    </button>
                    <button id="btn-add-heading" data-tooltip="Add Heading">
                      <i class="codicon codicon-list-flat"></i>
                    </button>
                  </div>
                  <div class="header-right">
                    <button id="btn-open-file" data-tooltip="Open md File">
                      <i class="codicon codicon-go-to-file"></i>
                    </button>
                  </div>
                </div>
				<div id="donation-banner" class="donation-banner" style="display: none;">
                    <div class="donation-text">
                        Enjoying ArchyTask? Support the project!
                    </div>
                    <div class="donation-buttons">
                        <button id="btn-donate">❤️ Support ArchyTask</button>
                        <button id="btn-dismiss">Dismiss</button>
                    </div>
                </div>
				<div id="item-list"></div>
                <div id="inspector" class="inspector">
                    <div class="inspector-header" id="inspector-header">
                        <i id="inspector-toggle-icon" class="codicon codicon-chevron-right"></i>
                        <span class="inspector-title">NOTE</span>
                    </div>
                    <div id="inspector-content" class="inspector-content">
                        <div id="inspector-note-display" class="inspector-note-display"></div>
                        <textarea id="inspector-note" placeholder="Add a note..." style="display: none;"></textarea>
                    </div>
                </div>
                <div id="notification-area" class="notification-area"></div>
				<script src="${scriptUri}"></script>
			</body>
			</html>`;
	}

    private _items: any[] = [];
    private _archivedItems: any[] = [];
    private _debounceTimer: NodeJS.Timeout | undefined;

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this._extensionUri, "media")
			],
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case "ready": {
                    await this._loadFromFile();
                    break;
                }
                case "updateItems": {
                    this._items = data.items;
                    this._archivedItems = data.archivedItems || [];
                    this._triggerSave();
                    break;
                }
                case "requestSync": {
                    await this._loadFromFile();
                    break;
                }
                case "openFile": {
                    if (vscode.workspace.workspaceFolders) {
                        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri;
                        const config = vscode.workspace.getConfiguration('archyTask');
                        const filePath = config.get<string>('filePath') || 'archytask.md';
                        const fileUri = this._resolveFilePath(workspaceRoot, filePath);
                        try {
                            // Ensure file exists, create if not
                            await this._ensureFileExists(fileUri);
                            const doc = await vscode.workspace.openTextDocument(fileUri);
                            await vscode.window.showTextDocument(doc);
                        } catch (e) {
                            vscode.window.showErrorMessage(`Could not open ${filePath}`);
                        }
                    }
                    break;
                }
                case "info": {
                    vscode.window.showInformationMessage(data.value);
                    break;
                }
                case "error": {
                    vscode.window.showErrorMessage(data.value);
                    break;
                }
                case "hideDonationBanner": {
                    const buttonType = data.buttonType || 'dismiss'; // 'dismiss' or 'support'
                    const date = new Date();
                    
                    if (buttonType === 'support') {
                        // Support button: hide for 1 year
                        date.setFullYear(date.getFullYear() + 1);
                    } else {
                        // Dismiss button: hide for 1 month
                        date.setMonth(date.getMonth() + 1);
                    }
                    
                    await this._context.globalState.update('donationBannerHiddenUntil', date.toISOString());
                    await this._context.globalState.update('donationBannerLastAction', buttonType);
                    break;
                }
                case "openUrl": {
                    if (data.url) {
                        vscode.env.openExternal(vscode.Uri.parse(data.url));
                    }
                    break;
                }
                case "clearArchiveConfirm": {
                    const confirmed = await vscode.window.showWarningMessage(
                        'Are you sure you want to clear all archived items?',
                        { modal: true },
                        'Clear'
                    );
                    
                    if (confirmed === 'Clear') {
                        this._view?.webview.postMessage({ type: 'clearArchiveConfirmed' });
                    }
                    break;
                }
            }
        });
	}

    private async _loadFromFile() {
        if (!vscode.workspace.workspaceFolders) {
            // Fallback to test data if no workspace
             this._view?.webview.postMessage({
                type: "update",
                items: [
                    { type: 'heading', title: 'Test Heading 1', indent: 0, id: '1' },
                    { type: 'todo', title: 'Test Task 1', indent: 0, isChecked: false, id: '2' },
                    { type: 'todo', title: 'Test Task 2', indent: 1, isChecked: true, id: '3' },
                ],
                archivedItems: []
            });
            this._sendSettings();
            this._checkDonationBanner();
            return;
        }

        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri;
        const config = vscode.workspace.getConfiguration('archyTask');
        const filePath = config.get<string>('filePath') || 'archytask.md';
        const fileUri = this._resolveFilePath(workspaceRoot, filePath);

        try {
            const fileData = await vscode.workspace.fs.readFile(fileUri);
            const content = Buffer.from(fileData).toString('utf8');
            const { items, archivedItems } = parseMarkdown(content);
            this._items = items;
            this._archivedItems = archivedItems;
            
            this._view?.webview.postMessage({
                type: "update",
                items: items,
                archivedItems: archivedItems
            });

            this._sendSettings();
            this._checkDonationBanner();

        } catch {
            // File might not exist - try to create it with default content
            console.log(`File not found at ${filePath}, attempting to create with default content`);
            
            try {
                await this._ensureFileExists(fileUri);
                // Now load the newly created file
                const fileData = await vscode.workspace.fs.readFile(fileUri);
                const content = Buffer.from(fileData).toString('utf8');
                const { items, archivedItems } = parseMarkdown(content);
                this._items = items;
                this._archivedItems = archivedItems;
                
                this._view?.webview.postMessage({
                    type: "update",
                    items: items,
                    archivedItems: archivedItems
                });
            } catch (createError) {
                // Failed to create file with default content, use empty
                console.log(`Failed to create file with default content: ${createError}`);
                this._items = [];
                this._archivedItems = [];
                this._view?.webview.postMessage({
                    type: "update",
                    items: [],
                    archivedItems: []
                });
            }
            
            this._sendSettings();
            this._checkDonationBanner();
        }
    }

    private _triggerSave() {
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }
        this._debounceTimer = setTimeout(async () => {
            await this._saveToFile();
        }, 1000);
    }

    private _ignoreNextChange = false;
    private _refreshDebounceTimer: NodeJS.Timeout | undefined;

    public async refresh() {
        if (this._refreshDebounceTimer) {
            clearTimeout(this._refreshDebounceTimer);
        }
        
        this._refreshDebounceTimer = setTimeout(async () => {
            if (this._ignoreNextChange) {
                this._ignoreNextChange = false;
                return;
            }
            await this._loadFromFile();
        }, 100); // Small debounce to coalesce multiple events (edit + save)
    }

    private async _saveToFile() {
        if (!vscode.workspace.workspaceFolders) return;

        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri;
        const config = vscode.workspace.getConfiguration('archyTask');
        const filePath = config.get<string>('filePath') || 'archytask.md';
        const fileUri = this._resolveFilePath(workspaceRoot, filePath);
        
        const content = stringifyItems(this._items, this._archivedItems);
        
        try {
            // Ensure parent directory exists
            await this._ensureParentDirectory(fileUri);
            
            this._ignoreNextChange = true;
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
            // Flag will be reset by file watcher's refresh() call
            // Add a timeout fallback to ensure flag is reset even if file watcher doesn't fire
            setTimeout(() => {
                if (this._ignoreNextChange) {
                    this._ignoreNextChange = false;
                }
            }, 500);
        } catch (e) {
            this._ignoreNextChange = false;
            vscode.window.showErrorMessage(`Failed to save ${filePath}`);
        }
    }
    private _sendSettings() {
        const config = vscode.workspace.getConfiguration('archyTask');
        const taskMoveModifier = config.get<string>('taskMoveModifier') || 'cmd';
        const newItemTrigger = config.get<string>('newItemTrigger') || 'shift+enter';
        const isMac = process.platform === 'darwin';

        this._view?.webview.postMessage({
            type: "settings",
            taskMoveModifier: taskMoveModifier,
            newItemTrigger: newItemTrigger,
            isMac: isMac
        });
    }

    private _checkDonationBanner() {
        const hiddenUntil = this._context.globalState.get<string>('donationBannerHiddenUntil');
        let showBanner = true;

        if (hiddenUntil) {
            const hiddenUntilDate = new Date(hiddenUntil);
            if (hiddenUntilDate > new Date()) {
                showBanner = false;
            }
        }

        if (showBanner) {
            this._view?.webview.postMessage({
                type: "showDonationBanner"
            });
        }
    }

    /**
     * Resolve file path to URI, supporting both relative and absolute paths
     * @param {vscode.Uri} workspaceRoot - Workspace root URI
     * @param {string} filePath - File path (relative to workspace or absolute)
     * @returns {vscode.Uri} Resolved file URI
     */
    private _resolveFilePath(workspaceRoot: vscode.Uri, filePath: string): vscode.Uri {
        // Check if path is absolute (starts with /)
        if (filePath.startsWith('/')) {
            return vscode.Uri.file(filePath);
        }
        // Otherwise treat as relative to workspace root
        return vscode.Uri.joinPath(workspaceRoot, filePath);
    }

    /**
     * Ensure file and its parent directories exist, creating them if necessary
     * If file doesn't exist, create it with default content
     * @param {vscode.Uri} fileUri - File URI to ensure exists
     */
    private async _ensureFileExists(fileUri: vscode.Uri): Promise<void> {
        try {
            await vscode.workspace.fs.stat(fileUri);
            // File exists
        } catch {
            // File doesn't exist, create parent directory and file
            await this._ensureParentDirectory(fileUri);
            
            // Default content
            const defaultContent = `## ToDo
- [ ] select task and "enter" to edit.
- [ ] "shift + enter" to create new task.
- [ ] "space" to toggle checkbox.
- [ ] "tab" to increase indent.
- [ ] "shift + tab" to decrease indent.
	- [ ] this is subtask.
	- [ ] this is also subtask.
	- [ ] There are no sub-subtasks.
- [ ] "ctrl + down/up" to move task.
- [ ] move me!
## Doing
- [ ] "ctrl + right/left" to move task to the next heading.
- [ ] "delete/backspace" to delete task.
- [ ] delete me!
## Done
- [ ] "ctrl + shift + right" to archive.
- [ ] archive me!
- [ ] "ctrl + shift + left" to restore from archive.
- [ ] Note (look at the bottom)
    \`\`\`plane
    This is a note.
    Notes can be attached to tasks, subtasks, and headings.
    A note icon is displayed on items with attached notes.
    \`\`\`
- [ ] Menu button is at the top right.
    \`\`\`plane
    You can check other keyboard shortcuts from the menu button.
    The menu button (three-dot icon) is at the top right corner.
    \`\`\`
`;
            
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(defaultContent, 'utf8'));
        }
    }

    /**
     * Ensure parent directory of a file exists, creating it if necessary
     * @param {vscode.Uri} fileUri - File URI whose parent directory to ensure exists
     */
    private async _ensureParentDirectory(fileUri: vscode.Uri): Promise<void> {
        const parentUri = vscode.Uri.joinPath(fileUri, '..');
        try {
            await vscode.workspace.fs.stat(parentUri);
        } catch {
            // Parent directory doesn't exist, create it recursively
            await vscode.workspace.fs.createDirectory(parentUri);
        }
    }
}
