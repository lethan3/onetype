import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const LOCK_FILENAME = '.editlock';
const ERROR_INTERVAL_MS = 1500;

let lastEditErrorTime = 0;
let isSessionActive = false;
let userName = '';
let lockPath = '';

export function activate(context: vscode.ExtensionContext) {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const rootWritable = root && (() => {
        try {
            fs.accessSync(root, fs.constants.W_OK);
            return true;
        } catch {
            return false;
        }
    })();
  
    function getLockPath(): string {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const rootWritable = root && (() => {
            try {
                fs.accessSync(root, fs.constants.W_OK);
                return true;
            } catch {
                return false;
            }
        })();

        return rootWritable ? path.join(root!, LOCK_FILENAME) : path.join(context.globalStorageUri.fsPath, LOCK_FILENAME);
    }

    function readLock(): any {
        const pathToUse = getLockPath();
        if (!fs.existsSync(pathToUse)) return null;
        try {
            return JSON.parse(fs.readFileSync(pathToUse, 'utf-8'));
        } catch {
            return null;
        }
    }

    function writeLock(data: any) {
        const pathToUse = getLockPath();
        fs.mkdirSync(path.dirname(pathToUse), { recursive: true });
        fs.writeFileSync(pathToUse, JSON.stringify(data, null, 2));
    }

    function hasEditLock(): boolean {
        const lock = readLock();
        return lock && lock.owner === userName;
    }

    function notifyOwnershipTransfer(from: string, to: string) {
        vscode.window.showInformationMessage(`🔄 Ownership transferred from ${from} to ${to}`);
    }

    vscode.workspace.createFileSystemWatcher(lockPath).onDidChange(() => {
        if (!isSessionActive) return;

        const lock = readLock();
        if (!lock) return;

        if (lock.owner !== userName) {
            vscode.window.showWarningMessage('🔒 Ownership has been transferred away from you.');
        } else if (lock.requests.length > 0) {
            const requester = lock.requests[0];
            vscode.window.showInformationMessage(
                `User "${requester}" is requesting edit access. Approve?`,
                { modal: true },
                'Approve',
                'Deny'
            ).then(choice => {
                if (choice === 'Approve') {
                    lock.requests.shift();
                    const prev = lock.owner;
                    lock.owner = requester;
                    writeLock(lock);
                    notifyOwnershipTransfer(prev, requester);
                } else {
                    lock.requests.shift();
                    writeLock(lock);
                }
            });
        }
    });

    vscode.workspace.onDidChangeTextDocument(event => {
        if (!isSessionActive || hasEditLock()) return;

        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document !== event.document) return;

        const now = Date.now();
        if (now - lastEditErrorTime > ERROR_INTERVAL_MS) {
            lastEditErrorTime = now;
            setTimeout(() => {
                vscode.window.showErrorMessage('❌ Edit denied. You do not hold the lock.', { modal: true });
            }, 0);
        }

        vscode.commands.executeCommand('workbench.action.files.revert');
    });

    vscode.workspace.onWillSaveTextDocument(event => {
        if (!isSessionActive || hasEditLock()) return;
        event.waitUntil(Promise.reject('You do not have edit permission.'));
        vscode.window.showErrorMessage('❌ Save blocked. You do not hold the lock.');
    });

    context.subscriptions.push(vscode.commands.registerCommand('onetype.forceAccess', () => {
        const lock = readLock() || { owner: '', users: [], requests: [] };
        const prev = lock.owner;
        lock.owner = userName;
        if (!lock.users.includes(userName)) lock.users.push(userName);
        writeLock(lock);
        vscode.window.showInformationMessage('✅ You now hold the edit lock.');
        if (prev !== userName) notifyOwnershipTransfer(prev, userName);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('onetype.requestAccess', () => {
        const lock = readLock();
        if (!lock) {
            vscode.window.showErrorMessage('❌ No session found. Host must start a session first.');
            return;
        }
        if (lock.requests.includes(userName)) {
            vscode.window.showErrorMessage('❌ You are already in the requests list.');
            return;
        }
        lock.requests.push(userName);
        if (!lock.users.includes(userName)) lock.users.push(userName);
        writeLock(lock);
        vscode.window.showInformationMessage('🔒 You have requested access.');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('onetype.hostSession', async () => {
        const input = await vscode.window.showInputBox({ prompt: 'Enter a username to host session' });
        if (!input) return;
        const name = input.trim();

        const existingLock = readLock();
        if (existingLock && existingLock.users.includes(name)) {
            vscode.window.showErrorMessage('❌ Username already taken. Please choose a different one.');
            return;
        }

        userName = name;
        const lock = {
            owner: userName,
            users: [userName],
            requests: []
        };
        writeLock(lock);
        isSessionActive = true;
        vscode.window.showInformationMessage(`🟢 OneType session started as host: ${userName}`);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('onetype.joinSession', async () => {
        if (!fs.existsSync(getLockPath())) {
            vscode.window.showErrorMessage('❌ No session found. Use "Host Session" to start.');
            return;
        }

        while (true) {
            const input = await vscode.window.showInputBox({ prompt: 'Enter a username to join session' });
            if (!input) return;
            const name = input.trim();
            const existingLock = readLock();
            if (!existingLock) {
                vscode.window.showErrorMessage('❌ Failed to join session. Try again.');
                return;
            }
            if (existingLock.users.includes(name)) {
                vscode.window.showErrorMessage('❌ Username already taken. Please choose a different one.');
            } else {
                userName = name;
                existingLock.users.push(userName);
                writeLock(existingLock);
                isSessionActive = true;
                vscode.window.showInformationMessage(`🟢 Joined OneType session as ${userName}`);
                break;
            }
        }
    }));
}

export function deactivate() {}
