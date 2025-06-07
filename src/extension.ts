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
    const liveshare = await vsls.getApi();
    if (!liveshare) {
        vscode.window.showErrorMessage('Live Share API not available.');
        return;
    }

    function debugSessionState() {
        console.log('--- Session State Debug ---');
        console.log('inSession:', inSession);
        console.log('host:', host);
        console.log('editor:', editor);
        console.log('users:', users);
        console.log('requests:', requests);
        console.log('----------------------------');
    }

    let sharedService: vsls.SharedService | null = null;
    let sharedProxy: vsls.SharedServiceProxy | null = null;

    liveshare.onDidChangeSession(async (e) => {
        if (e.session && myUsername === host) {
            sharedService = await liveshare.shareService('onetype-sync');
            if (!sharedService) return;

            sharedService.onNotify('join', (data: any) => {
                console.log(`Received join from ${data.username}`);
                if (!users.includes(data.username)) {
                    users.push(data.username);
                    sharedService!.notify('initiateJoin', { host, editor, users, requests });
                }
            });

            sharedService.onNotify('transferAccess', (data: any) => {
                console.log(`Transfer edit access from ${data.from} to ${data.to}`);
                editor = data.to;
                vscode.window.showInformationMessage(`✅ Edit access granted to ${editor}`);
                debugSessionState();
            });

            console.log("Shared service initialized as host.");
        }

        if (e.session && myUsername !== host) {
            sharedProxy = await liveshare.getSharedService('onetype-sync');
            if (!sharedProxy) return;

            sharedProxy.onNotify('initiateJoin', (data: any) => {
                ({ host, editor, users, requests } = data);
                inSession = true;
                console.log("Received initiateJoin as guest.");
                debugSessionState();
            });

            console.log("Shared service proxy initialized as guest.");
        }
    });

    // Protect files from unauthorized edits
    vscode.workspace.onDidChangeTextDocument(event => {
        if (!inSession || editor === myUsername) return;

        const editorInstance = vscode.window.activeTextEditor;
        if (!editorInstance || editorInstance.document !== event.document) return;

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
        if (!username) return;
        myUsername = username;

        inSession = true;
        host = editor = username;
        users = [username];
        requests = [];

        // Need to host Live Share first THEN host OneType session

        // const sessionUri = await liveshare.share({});
        // console.log("Live Share attempted to start. Returned URI: %s", sessionUri?.path);
        // if (sessionUri) {
        //     await vscode.env.clipboard.writeText(sessionUri.toString());
        //     vscode.window.showInformationMessage('Live Share started. Invite link copied to clipboard.');
        // } else {
        //     vscode.window.showErrorMessage('Failed to start Live Share session.');
        // }

        debugSessionState();
    }));

    // Command: Join a Session
    context.subscriptions.push(vscode.commands.registerCommand('onetype.joinSession', async () => {
        if (inSession) {
            vscode.window.showErrorMessage('Already in a session.');
            return;
        }

        const username = await vscode.window.showInputBox({ prompt: 'Enter your username' });
        if (!username) return;
        myUsername = username;

        // Wait for session to connect and service to be available
        const waitForProxy = async (): Promise<vsls.SharedServiceProxy | null> => {
            const proxy = await liveshare.getSharedService('onetype-sync');
            if (proxy && proxy.isServiceAvailable) {
                return proxy;
            }
            return new Promise(resolve => {
                const temp = liveshare.getSharedService('onetype-sync');
                temp.then(proxy => {
                    if (proxy) {
                        proxy.onDidChangeIsServiceAvailable(() => {
                            if (proxy.isServiceAvailable) {
                                resolve(proxy);
                            }
                        });
                    } else {
                        resolve(null);
                    }
                });
            });
        };

        sharedProxy = await waitForProxy();
        if (sharedProxy) {
            sharedProxy.notify('join', { username });
            console.log("Posted join request to host.");
        } else {
            vscode.window.showErrorMessage('Unable to connect to host service.');
        }
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
        if (!target) return;

        editor = target;
        debugSessionState();

        if (sharedService) {
            sharedService.notify('transferAccess', { from: myUsername, to: target });
        } else if (sharedProxy) {
            sharedProxy.notify('transferAccess', { from: myUsername, to: target });
        } else {
            vscode.window.showErrorMessage('No messaging service available.');
        }
    }));
}

export function deactivate() {}
