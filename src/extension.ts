import * as vscode from 'vscode';
import { SidebarProvider } from './SidebarProvider';
import { ShortcutsPanel } from './ShortcutsPanel';

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "archy-task" is now active!');

	const sidebarProvider = new SidebarProvider(context.extensionUri, context);
	
	// Register webview view provider with error handling
	try {
		context.subscriptions.push(
			vscode.window.registerWebviewViewProvider(
				"archyTaskView",
				sidebarProvider
			)
		);
	} catch (error) {
		console.error('Error registering webview view provider:', error);
		// Provider might already be registered, continue anyway
	}

	// Initialize donation banner date if not set
	const initializeDonationBannerDate = async () => {
		const hiddenUntil = context.globalState.get<string>('donationBannerHiddenUntil');
		if (!hiddenUntil) {
			const date = new Date();
			date.setDate(date.getDate() + 3);
			await context.globalState.update('donationBannerHiddenUntil', date.toISOString());
		}
	};

	initializeDonationBannerDate();

	// Helper function to get the archytask file path
	const getArchyTaskFilePath = (): string | null => {
		if (!vscode.workspace.workspaceFolders) return null;
		const workspaceRoot = vscode.workspace.workspaceFolders[0];
		const config = vscode.workspace.getConfiguration('archyTask');
		const filePath = config.get<string>('filePath') || 'archytask.md';
		
		// If absolute path, use as-is; otherwise, relative to workspace root
		if (vscode.Uri.file(filePath).scheme === 'file' && /^\//.test(filePath)) {
			return filePath;
		}
		return vscode.Uri.joinPath(workspaceRoot.uri, filePath).fsPath;
	};

	// File Watcher - only active when the file is open in editor
	let watcher: vscode.FileSystemWatcher | undefined;
	let fileOpenCount = 0;

	const startWatcher = () => {
		if (watcher) return; // Already watching

		const filePath = getArchyTaskFilePath();
		if (!filePath) return;

		// Create watcher with glob pattern matching the specific file path
		const pattern = new vscode.RelativePattern(vscode.workspace.workspaceFolders![0], '**/*');
		watcher = vscode.workspace.createFileSystemWatcher(pattern);

		watcher.onDidChange((uri) => {
			if (uri.fsPath === filePath) {
				sidebarProvider.refresh();
			}
		});

		watcher.onDidCreate((uri) => {
			if (uri.fsPath === filePath) {
				sidebarProvider.refresh();
			}
		});

		watcher.onDidDelete((uri) => {
			if (uri.fsPath === filePath) {
				sidebarProvider.refresh();
			}
		});

		context.subscriptions.push(watcher);
	};

	const stopWatcher = () => {
		if (watcher && fileOpenCount === 0) {
			watcher.dispose();
			const index = context.subscriptions.indexOf(watcher);
			if (index > -1) {
				context.subscriptions.splice(index, 1);
			}
			watcher = undefined;
		}
	};

	// Track when archytask file is opened/closed in editor
	context.subscriptions.push(
		vscode.window.onDidChangeVisibleTextEditors((editors) => {
			const filePath = getArchyTaskFilePath();
			if (!filePath) return;

			// Count how many editors have the archytask file open
			const openCount = editors.filter(e => e.document.uri.fsPath === filePath).length;

			if (openCount > fileOpenCount) {
				// File opened
				fileOpenCount = openCount;
				startWatcher();
			} else if (openCount < fileOpenCount) {
				// File closed
				fileOpenCount = openCount;
				if (fileOpenCount === 0) {
					stopWatcher();
				}
			}
		})
	);

	// Also check on initial activation
	fileOpenCount = vscode.window.visibleTextEditors.filter(
		e => e.document.uri.fsPath === getArchyTaskFilePath()
	).length;
	if (fileOpenCount > 0) {
		startWatcher();
	}

	// Command to sync/reload items from MD file
	const syncFileCommand = vscode.commands.registerCommand('archyTask.syncFile', async () => {
		await sidebarProvider.refresh();
		vscode.window.showInformationMessage('Tasks reloaded from file');
	});

	context.subscriptions.push(syncFileCommand);

	// Command to show keyboard shortcuts
	const showKeyboardShortcutsCommand = vscode.commands.registerCommand('archyTask.showKeyboardShortcuts', () => {
		ShortcutsPanel.createOrShow(context.extensionUri);
	});

	context.subscriptions.push(showKeyboardShortcutsCommand);

	// Developer command to clear donation banner date
	const clearDonationBannerCommand = vscode.commands.registerCommand('archyTask.clearDonationBannerDate', async () => {
		await context.globalState.update('donationBannerHiddenUntil', undefined);
		await context.globalState.update('donationBannerLastAction', undefined);
		vscode.window.showInformationMessage('Donation banner date cleared!');
	});

	context.subscriptions.push(clearDonationBannerCommand);

	// Developer command to check donation banner date
	const checkDonationBannerCommand = vscode.commands.registerCommand('archyTask.checkDonationBannerDate', async () => {
		const hiddenUntil = context.globalState.get<string>('donationBannerHiddenUntil');
		const lastAction = context.globalState.get<string>('donationBannerLastAction');
		
		if (!hiddenUntil) {
			vscode.window.showInformationMessage('Donation banner date: Not set');
		} else {
			const date = new Date(hiddenUntil);
			const action = lastAction || 'unknown';
			vscode.window.showInformationMessage(`Donation banner hidden until: ${date.toLocaleString()} (Last action: ${action})`);
		}
	});

	context.subscriptions.push(checkDonationBannerCommand);

	// Developer command to rewind donation banner date by 3 days
    const rewindThreeDaysCommand = vscode.commands.registerCommand('archyTask.rewindDonationBannerThreeDays', async () => {
        const hiddenUntil = context.globalState.get<string>('donationBannerHiddenUntil');
        if (!hiddenUntil) {
            vscode.window.showWarningMessage('Donation banner date is not set');
        } else {
            const date = new Date(hiddenUntil);
            date.setDate(date.getDate() - 3);
            await context.globalState.update('donationBannerHiddenUntil', date.toISOString());
            vscode.window.showInformationMessage(`Donation banner date rewound to: ${date.toLocaleString()}`);
        }
    });

    context.subscriptions.push(rewindThreeDaysCommand);

	// Developer command to rewind donation banner date by 1 month
	const rewindOneMonthCommand = vscode.commands.registerCommand('archyTask.rewindDonationBannerOneMonth', async () => {
		const hiddenUntil = context.globalState.get<string>('donationBannerHiddenUntil');
		
		if (!hiddenUntil) {
			vscode.window.showWarningMessage('Donation banner date is not set');
		} else {
			const date = new Date(hiddenUntil);
			date.setMonth(date.getMonth() - 1);
			await context.globalState.update('donationBannerHiddenUntil', date.toISOString());
			vscode.window.showInformationMessage(`Donation banner date rewound to: ${date.toLocaleString()}`);
		}
	});

	context.subscriptions.push(rewindOneMonthCommand);

	// Developer command to rewind donation banner date by 1 year
	const rewindOneYearCommand = vscode.commands.registerCommand('archyTask.rewindDonationBannerOneYear', async () => {
		const hiddenUntil = context.globalState.get<string>('donationBannerHiddenUntil');
		
		if (!hiddenUntil) {
			vscode.window.showWarningMessage('Donation banner date is not set');
		} else {
			const date = new Date(hiddenUntil);
			date.setFullYear(date.getFullYear() - 1);
			await context.globalState.update('donationBannerHiddenUntil', date.toISOString());
			vscode.window.showInformationMessage(`Donation banner date rewound to: ${date.toLocaleString()}`);
		}
	});

	context.subscriptions.push(rewindOneYearCommand);

}

export function deactivate() {}
