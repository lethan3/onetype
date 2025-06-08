import { userInfo } from 'os';
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
let myNotifier: vsls.SharedService | vsls.SharedServiceProxy | null = null;

const SERVICE_NAME = 'onetype';
const SEND_ALL_PREF = 'sendToAll-';

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
    vscode.workspace.onDidChangeTextDocument(async event => {
        if (!inSession || editor === myUsername) {
            return;
        }

        const editorInstance = vscode.window.activeTextEditor;
        const peer = await liveshare?.getPeerForTextDocumentChangeEvent(event);
        if (!editorInstance || editorInstance.document !== event.document || peer?.peerNumber !== liveshare?.session.peerNumber) {
            // If the edit was not made by me
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

    type NotifyHandler<T = any> = (data: T) => void;

    function makeNamedLocalEvent() {
        const handlers: Record<string, NotifyHandler[]> = {};

        return {
            watch(name: string, handler: NotifyHandler) {
                if (!handlers[name]) {
                    handlers[name] = [];
                }
                handlers[name].push(handler);
            },

            notify(name: string, data: any) {
                const hs = handlers[name];
                if (hs) {
                    for (const h of hs) {
                        h(data);
                    }
                }
            }
        };
    }

    function isHost() {
        return myUsername === host;
    }

    const localEvents = makeNamedLocalEvent();

    async function sendMassNotif(name: string, data: any) {
        if (isHost()) {
            // Am host -- if not request to send to all (this shouldn't happen), send to everyone
            if (!name.startsWith(SEND_ALL_PREF)) {
                await myNotifier!.notify(name, data);
            }

            // Do function myself when host
            localEvents.notify(name, data);
        } else {
            // Am not host -- send request to host to send to everyone
            await myNotifier!.notify(SEND_ALL_PREF + name, data);
        }
    }

    async function watchMassNotif(name: string, handler: vsls.NotifyHandler) {
        if (isHost()) {
            // Help a guest broadcast to all, and do the function myself
            myNotifier!.onNotify(SEND_ALL_PREF + name, async (data: any) => {
                await myNotifier!.notify(name.slice(SEND_ALL_PREF.length), handler);
                handler(data);
            });

            // Set up to do function myself when host
            localEvents.watch(name, (data: any) => {
                handler(data);
            });
        } else {
            // Am not host -- just do the function
            myNotifier!.onNotify(name, (data: any) => {
                handler(data);
            });
        }
    }

    // Initialize notifications that anyone can send and everyone will receive
    function initMassNotifs() {
        // Call all of the watchMassNotifs with the corresponding actions

        watchMassNotif('transferAccess', (data: any) => {
            console.log("Received transferAccess command from %s to %s.", data.from, data.to);
            editor = data.to;
            vscode.window.showInformationMessage(`✅ ${editor} now holds edit permissions.`);
        });
    }

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

        myNotifier = service;

        const username = await vscode.window.showInputBox({ prompt: 'Enter your username' });
        if (!username) {
            return;
        }

        myUsername = username;
        inSession = true;
        host = editor = username;
        users = [username];
        requests = [];

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

        // service.onNotify('initiateJoin', (data: any) => {
        //     console.log("Received my own initiateJoin notification.");
        // });

        initMassNotifs();

        vscode.window.showInformationMessage('✅ OneType session started. Share your LiveShare link to others to join the session.');
        console.log("Hosting started.");
        debugSessionState();
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

        myNotifier = proxy;

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

        initMassNotifs();
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

        console.log("Posting transferAccess notification from %s to %s.", myUsername, target);
        await sendMassNotif('transferAccess', { from: myUsername, to: target });
    }));
}

export function deactivate() {}
