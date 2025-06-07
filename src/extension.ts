import * as vscode from 'vscode';
import * as vsls from 'vsls';

let inSession = false;
let host: string | null = null;
let editor: string | null = null;
let users: string[] = [];
let requests: string[] = [];
let lastEditErrorTime = 0;
const ERROR_INTERVAL_MS = 500;
let myUsername: string | null = null;
let liveshare: vsls.LiveShare | null = null;

const SERVICE_NAME = 'onetype';

export async function activate(context: vscode.ExtensionContext) {
    function debugSessionState() {
        console.log('--- Session State Debug ---');
        console.log('inSession:', inSession);
        console.log('host:', host);
        console.log('editor:', editor);
        console.log('users:', users);
        console.log('requests:', requests);
        console.log('----------------------------');
    }

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

    context.subscriptions.push(vscode.commands.registerCommand('onetype.hostSession', async () => {
        if (inSession) {
            vscode.window.showErrorMessage('Already in a session.');
            return;
        }

        liveshare = await vsls.getApi();
        if (!liveshare) {
            vscode.window.showErrorMessage('LiveShare not detected.');
            return;
        }

        const service = await liveshare.shareService(SERVICE_NAME);
        if (!service) {
            vscode.window.showErrorMessage('Failed to share RPC service.');
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

        vscode.window.showInformationMessage('OneType session started. Share your LiveShare link to others to join the session.');
        console.log("Hosting started.");
        debugSessionState();

        service.onNotify('join', async (data: any) => {
            console.log("Received join notification of %s as host.", data.username);
            if (!users.includes(data.username)) {
                users.push(data.username);
                debugSessionState();
                await service.notify('initiateJoin', { host, editor, users, requests });
                vscode.window.showInformationMessage("✅ User " + data.username + " joined.");
                console.log("Sent initiateJoin to all users.");
            }
        });

        service.onNotify('initiateJoin', (data: any) => {
            console.log("Received my own initiateJoin notification.");
        });

        service.onNotify('transferAccess', (data: any) => {
            console.log("Received transferAccess command from %s to %s.", data.from, data.to);
            editor = data.to;
            vscode.window.showInformationMessage(`✅ Edit access granted to ${editor}.`);
        });

    }));

    context.subscriptions.push(vscode.commands.registerCommand('onetype.joinSession', async () => {
        if (inSession) {
            vscode.window.showErrorMessage('Already in a session.');
            return;
        }

        liveshare = await vsls.getApi();
        if (!liveshare) {
            vscode.window.showErrorMessage('LiveShare not detected.');
            return;
        }

        const username = await vscode.window.showInputBox({ prompt: 'Enter your username' });
        if (!username) {
            return;
        }

        myUsername = username;

        const proxy = await liveshare.getSharedService(SERVICE_NAME);
        if (!proxy) {
            vscode.window.showErrorMessage('Host has not started OneType session.');
            return;
        }

        await proxy.notify('join', { username });
        console.log("Sent join notification as guest.");

        proxy.onNotify('initiateJoin', (data: any) => {
            console.log("Received initiateJoin as guest.");
            let updUsers;
            ({ host, editor, users: updUsers, requests } = data);
            const newUsers = updUsers.filter((x: string) => !users.includes(x));

            if (newUsers.length === 1) {
                vscode.window.showInformationMessage("✅ User " + newUsers[0] + " joined.");
            } else {
                vscode.window.showInformationMessage("✅ Joined with users " + updUsers.join(', ') + ".");
            }

            users = updUsers;

            inSession = true;
            debugSessionState();
        });

        proxy.onNotify('transferAccess', (data: any) => {
            console.log("Recieved transferAccess notification: " + data);
            editor = data.to;
            vscode.window.showInformationMessage(`✅ Edit access granted to ${editor}.`);
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('onetype.giveAccess', async () => {
        if (!inSession || myUsername !== editor) {
            vscode.window.showErrorMessage('Only the current editor can give access.');
            return;
        }

        const target = await vscode.window.showQuickPick(users.filter(u => u !== myUsername), {
            placeHolder: 'Select a user to give edit access to:'
        });
        if (!target) {
            return;
        }

        editor = target;

        const proxy = await liveshare!.getSharedService(SERVICE_NAME);
        if (!proxy) {
            vscode.window.showErrorMessage('Cannot find host session.');
            return; 
        }

        console.log("Posting transferAccess notification from %s to %s.", myUsername, target);
        await proxy.notify('transferAccess', { from: myUsername, to: target });
    }));
}

export function deactivate() {}
