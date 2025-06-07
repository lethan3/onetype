// extension.ts
import * as vscode from 'vscode';
import * as vsls from 'vsls';

let inSession = false;
let host: string | null = null;
let editor: string | null = null;
let users: string[] = [];
let requests: string[] = [];
let lastEditErrorTime = 0;
const ERROR_INTERVAL_MS = 5000;
let myUsername: string | null = null;

export async function activate(context: vscode.ExtensionContext) {
    const liveshare = (await vsls.getApi())!;
    if (!liveshare) {
        vscode.window.showErrorMessage('Live Share API not available.');
        return;
    }

<<<<<<< HEAD
=======
    function debugSessionState() {
        console.log('--- Session State Debug ---');
        console.log('inSession:', inSession);
        console.log('host:', host);
        console.log('editor:', editor);
        console.log('users:', users);
        console.log('requests:', requests);
        console.log('----------------------------');
    }
>>>>>>> da8cc6ad12ae74eed5eb925472312caf5ebce0e1

    // LiveShare activity handler
    (liveshare.onActivity)!((e: any) => {
        const { timestamp, name, data } = e;

        if (name === 'join' && liveshare.session && liveshare.session.role === vsls.Role.Host) {
            console.log("Received join activity as host.");
            debugSessionState();

            if (!users.includes(data.username)) {
                users.push(data.username);
                (liveshare.postActivity)!({
                    timestamp: new Date(Date.now()),
                    name: 'initiateJoin',
                    data: { host, editor, users, requests }
                });
            }

            console.log("Sent initiateJoin activity as host.");
            debugSessionState();
        } else if (name === 'initiateJoin' && liveshare.session && liveshare.session.role !== vsls.Role.Host) {
            console.log("Received initiateJoin activity as non-host.");
            debugSessionState();

            ({ host, editor, users, requests } = data);

            inSession = true;

            console.log("Initialized / Updated session variables as non-host.");
            debugSessionState();
        } else if (name === 'transferAccess') {
            console.log("Received transfer command from %s to %s.", e.from, e.to);

            editor = e.to;
            vscode.window.showInformationMessage(`✅ Edit access granted to ${editor}.`);

            console.log("Edit access transferred to %s.", e.to);
        }
    });

    // Revert unauthorized edits and show popup
    vscode.workspace.onDidChangeTextDocument(event => {
        if (!inSession || editor === myUsername) {
            return;
        }

        const editorInstance = vscode.window.activeTextEditor;
        if (!editorInstance || editorInstance.document !== event.document) {
            return;
        }

        const now = Date.now();
        if (now - lastEditErrorTime > ERROR_INTERVAL_MS) {
            lastEditErrorTime = now;
            setTimeout(() => {
                vscode.window.showErrorMessage('❌ Edit denied. You do not hold the lock.', { modal: true });
            }, 0);
        }

        vscode.commands.executeCommand('workbench.action.files.revert');
    });

    // Command: Host a Session
    context.subscriptions.push(vscode.commands.registerCommand('onetype.hostSession', async () => {
        if (inSession) {
            vscode.window.showErrorMessage('Already in a session.');
            return;
        }

        const username = await vscode.window.showInputBox({ prompt: 'Enter your username' });
        if (!username) {
            return;
        }
        myUsername = username;

        inSession = true;
        host = editor = username;
        users = [username];
        requests = [];

        const session = await liveshare.share({});
        if (session) {
            await vscode.env.clipboard.writeText(session.toString()!);
            vscode.window.showInformationMessage('Live Share started. Invite link copied to clipboard.');
        } else {
            vscode.window.showErrorMessage('Failed to start Live Share session.');
        }
    }));

    // Command: Join a Session
    context.subscriptions.push(vscode.commands.registerCommand('onetype.joinSession', async () => {
        if (inSession) {
            vscode.window.showErrorMessage('Already in a session.');
            return;
        }

        const link = await vscode.window.showInputBox({ prompt: 'Enter Live Share join link' });
        if (!link) {
            return;
        }

        const username = await vscode.window.showInputBox({ prompt: 'Enter your username' });
        if (!username) {
            return;
        }
        myUsername = username;

        await liveshare.join(vscode.Uri.file(link));

        // Wait until session is fully joined
        liveshare.onDidChangeSession(e => {
            if (e.session && e.session.role !== vsls.Role.Host) {
                (liveshare.postActivity)!({ 
                    timestamp: new Date(Date.now()),
                    name: 'join', 
                    data: { username }
                });
            }
        });
    }));

    // Command: Give Edit Access
    context.subscriptions.push(vscode.commands.registerCommand('onetype.giveAccess', async () => {
        if (!inSession || myUsername !== editor) {
            vscode.window.showErrorMessage('Only the current editor can give access.');
            return;
        }

        const target = await vscode.window.showQuickPick(users.filter(u => u !== myUsername), {
            placeHolder: 'Select a user to give edit access to'
        });
        if (!target) {
            return;
        }

        editor = target;
        (liveshare.postActivity!)({ 
            timestamp: new Date(Date.now()),
            name: 'transferAccess', 
            data: { from: myUsername, to: target }
        });
    }));
}

export function deactivate() {}
