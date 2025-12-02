import * as vscode from "vscode";

export class ShortcutsPanel {
  public static currentPanel: ShortcutsPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
  }

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it.
    if (ShortcutsPanel.currentPanel) {
      ShortcutsPanel.currentPanel._panel.reveal(column);
      return;
    }

    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      "archyTaskShortcuts",
      "ArchyTask Shortcuts",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      }
    );

    ShortcutsPanel.currentPanel = new ShortcutsPanel(panel, extensionUri);
  }

  public dispose() {
    ShortcutsPanel.currentPanel = undefined;

    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "shortcuts.css")
    );

    const config = vscode.workspace.getConfiguration('archyTask');
    const newItemTrigger = config.get<string>('newItemTrigger') || 'shift+enter';
    const taskMoveModifier = config.get<string>('taskMoveModifier') || 'ctrl';

    const addItemKeys = newItemTrigger === 'shift+enter' ? ["Shift", "Enter"] : ["Enter"];
    const editItemKeys = newItemTrigger === 'shift+enter' ? ["Enter"] : ["Shift", "Enter"];

    const winMod = taskMoveModifier === 'ctrl' ? "Ctrl" : "Alt";
    const macMod = taskMoveModifier === 'ctrl' ? "Cmd" : "Option";

    const shortcuts = [
      {
        category: "Navigation",
        items: [
          { action: "Move cursor up / down", windows: [["↑"], ["↓"]], mac: [["↑"], ["↓"]] },
        ],
      },
      {
        category: "Editing",
        items: [
          { action: "Edit item", windows: [editItemKeys], mac: [editItemKeys] },
          { action: "Add new item", windows: [addItemKeys], mac: [addItemKeys] },
          { action: "Toggle checkbox", windows: [["Space"]], mac: [["Space"]] },
          { action: "Delete item", windows: [["Backspace"], ["Delete"]], mac: [["Backspace"], ["Delete"]] },
        ],
      },
      {
        category: "Moving Items",
        items: [
          { action: "Move item up / down", windows: [[winMod, "↑"], [winMod, "↓"]], mac: [[macMod, "↑"], [macMod, "↓"]] },
          { action: "Increase / Decrease indent", windows: [["Tab"], ["Shift", "Tab"]], mac: [["Tab"], ["Shift", "Tab"]] },
          { action: "Move to next / prev heading", windows: [[winMod, "→"], [winMod, "←"]], mac: [[macMod, "→"], [macMod, "←"]] },
          { action: "Move to archive", windows: [[winMod, "Shift", "→"]], mac: [[macMod, "Shift", "→"]] },
          { action: "Restore from archive", windows: [[winMod, "Shift", "←"]], mac: [[macMod, "Shift", "←"]] },
        ],
      },
      {
        category: "Clipboard",
        items: [
          { action: "Copy", windows: [["Ctrl", "C"]], mac: [["Cmd", "C"]] },
          { action: "Cut", windows: [["Ctrl", "X"]], mac: [["Cmd", "X"]] },
          { action: "Paste", windows: [["Ctrl", "V"]], mac: [["Cmd", "V"]] },
          { action: "Duplicate", windows: [["Ctrl", "D"]], mac: [["Cmd", "D"]] },
        ],
      },
      {
        category: "History",
        items: [
          { action: "Undo", windows: [["Ctrl", "Z"]], mac: [["Cmd", "Z"]] },
          { action: "Redo", windows: [["Ctrl", "Shift", "Z"]], mac: [["Cmd", "Shift", "Z"]] },
        ],
      },
      {
        category: "Selection",
        items: [
          { action: "Extend selection", windows: [["Shift", "↑"], ["Shift", "↓"]], mac: [["Shift", "↑"], ["Shift", "↓"]] },
          { action: "Select All", windows: [["Ctrl", "A"]], mac: [["Cmd", "A"]] },
        ],
      },
    ];

    const generateKeysHtml = (keyGroups: string[][]) => {
      return keyGroups
        .map(group => group.map(key => `<span class="key">${key}</span>`).join(' '))
        .join('<span class="separator">/</span>');
    };

    const generateRowsHtml = () => {
      let html = "";
      for (const group of shortcuts) {
        html += `<tr class="category-row"><td colspan="3">${group.category}</td></tr>`;
        for (const item of group.items) {
          html += `
            <tr>
              <td class="action-col">${item.action}</td>
              <td class="keys-col">${generateKeysHtml(item.windows)}</td>
              <td class="keys-col">${generateKeysHtml(item.mac)}</td>
            </tr>
          `;
        }
      }
      return html;
    };

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleUri}" rel="stylesheet">
        <title>ArchyTask Shortcuts</title>
      </head>
      <body>
        <div class="container">
          <h1>ArchyTask Keyboard Shortcuts</h1>
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>Windows</th>
                <th>Mac</th>
              </tr>
            </thead>
            <tbody>
              ${generateRowsHtml()}
            </tbody>
          </table>
        </div>
      </body>
      </html>`;
  }
}
