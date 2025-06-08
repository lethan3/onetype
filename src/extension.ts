import { watch } from 'fs';
import { userInfo } from 'os';
import * as vscode from 'vscode';
import * as vsls from 'vsls';

let inSession = false;
let host: string | null = null;
let editor: string | null = null;
let users: string[] = [];
let idToUsername: Map<number, string> = new Map();
let lastEditErrorTime = 0;
const ERROR_INTERVAL_MS = 50;
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
        console.log('----------------------------');
    }

    type NotifyHandler<T = any> = (data: T) => void;

    // Utility for host to "watch" their own events
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

    function getMyId() {
        return liveshare?.session.peerNumber;
    }

    const localEvents = makeNamedLocalEvent();

    // General function to send a mass notif
    async function sendMassNotif(name: string, data: any) {
        if (isHost()) {
            // Am host -- if not request to send to all (this shouldn't happen), send to everyone
            console.log("As host, broadcasting %s.", name);
            if (!name.startsWith(SEND_ALL_PREF)) {
                await myNotifier!.notify(name, data);
            }

            // Do function myself when host
            console.log("As host, self-notifying %s.", name);
            localEvents.notify(name, data);
        } else {
            // Am not host -- send request to host to send to everyone
            console.log("As guest, requesting host to broadcast %s.", name);
            await myNotifier!.notify(SEND_ALL_PREF + name, data);
        }
    }

    // General function to watch a mass notif
    async function watchMassNotif(name: string, handler: vsls.NotifyHandler) {
        if (isHost()) {
            // Help a guest broadcast to all, and do the function myself
            myNotifier!.onNotify(SEND_ALL_PREF + name, async (data: any) => {
                console.log("As host, received request to broadcast %s.", name);
                await myNotifier!.notify(name, data);
                handler(data);
            });

            // Set up to do function myself when host
            localEvents.watch(name, (data: any) => {
                handler(data);
            });
        } else {
            // Am not host -- just do the function
            myNotifier!.onNotify(name, (data: any) => {
                console.log("As guest, received notification for %s.", name);
                handler(data);
            });
        }
    }

    // Leave the session by resetting all variables.
    function leave() {
        inSession = false;
        host = null;
        editor = null;
        users = [];
        idToUsername = new Map<number, string>();
        lastEditErrorTime = 0;
        myUsername = null;
        liveshare = null;
        myNotifier = null;
    }

    // Initialize notifications that anyone can send and everyone will receive
    function initMassNotifs() {
        // Call all of the watchMassNotifs with the corresponding actions

        watchMassNotif('transferAccess', (data: any) => {
            console.log("Received transferAccess command from %s to %s.", data.from, data.to);
            editor = data.to;
            vscode.window.showInformationMessage(`✅ ${editor} now holds edit permissions.`);
        });

        watchMassNotif('detectChange', (data: any) => {
            if (data.perpetratorID === getMyId() && myUsername !== editor) {
                // It was me and I am not the editor

                const now = Date.now();
                if (now - lastEditErrorTime > ERROR_INTERVAL_MS) {
                    lastEditErrorTime = now;
                    setTimeout(() => {
                        vscode.window.showErrorMessage('❌ Stop editing. You do not currently hold edit permissions.', { modal: true });
                    }, 0);
                }

                // Unfortunately this doesn't quite work as intended, possibly we could tell host to save a copy every edit and revert
                // But this could lead to issues when simultaneously typing, for now we just spam the perpetrator with popups 
                // vscode.commands.executeCommand('workbench.action.files.revert');
            }
        });

        watchMassNotif('endSession', (data: any) => {
            leave();
            vscode.window.showInformationMessage(`The OneType session has been ended by the host.`, { modal: true });
        });

        // Watch when someone leaves
        watchMassNotif('leave', (data: any) => {
            if (data.username === editor) {
                // If the user who left was editing, transfer edit permission to the host.
                editor = host;
            }

            users = users.filter(x => x !== data.username);
            idToUsername.delete( data.id );
            vscode.window.showInformationMessage(`✅ ${data.username} left.`, { modal: true });
        });

        watchMassNotif('requestAccess', async (data: any) => {
            if (myUsername === editor) {
                const result = await vscode.window.showInformationMessage(
                    `🔔 ${data.from} is requesting edit access.`,
                    { modal: true },
                    'Accept'
                );

                if (result === 'Accept') {
                    sendMassNotif('transferAccess', { from: data.from, to: data.to });
                }
            } else {
                vscode.window.showInformationMessage(
                    `🔔 ${data.from} requested edit access from ${data.to}.`
                );
            }
        });
    }

    // The API has a bug where even if you don't edit, it will still show that you edited the workspace
    // But if another person detects that you edited it it's probably your fault
    // So this is just to blame whoever did it and send a message to that person to stop
    // This probably introduces some latency but I have no idea how to do it any other way
    
    // Watch for document changes
    vscode.workspace.onDidChangeTextDocument(async event => {
        if (!inSession) {
            return;
        }

        const editorInstance = vscode.window.activeTextEditor;
        const peer = await liveshare?.getPeerForTextDocumentChangeEvent(event);
        console.log("Change detected: My peer number is " + getMyId() + " and the peer responsible is " + peer?.peerNumber + ".");
        
        if (peer?.peerNumber === getMyId()) {
            // This was me, ignore 
            return;
        }
        
        console.log("Sending blame with peerNumber " + peer?.peerNumber + ".");
        sendMassNotif('detectChange', { perpetratorID: peer?.peerNumber });
    });

    // Host a session as the host of the Live Share session.
    context.subscriptions.push(vscode.commands.registerCommand('onetype.hostSession', async () => {
        if (inSession) {
            vscode.window.showErrorMessage('Already in a session.');
            return;
        }

        liveshare = await vsls.getApi();
        if (!liveshare) {
            vscode.window.showErrorMessage('Live Share not detected.');
            return;
        }

        if (liveshare?.session.role !== vsls.Role.Host) {
            vscode.window.showErrorMessage('You must be the host of the Live Share session to host the OneType session.');
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

        // Watch for joins to broadcast to guests.
        service.onNotify('join', async (data: any) => {
            console.log("Received join notification of %s as host.", data.username);
            if (!users.includes(data.username)) {
                users.push(data.username);
                debugSessionState();
                await service.notify('initiateJoin', { host, editor, users, idToUsername });
                vscode.window.showInformationMessage("✅ User " + data.username + " joined.");
                console.log("Sent initiateJoin to all users.");
            }
        });

        // Watch for leaves (only by Live Share) to broadcast to guests.
        liveshare.onDidChangePeers( async (e) => {
            for (const peer of e.removed) {
                const username = idToUsername.get(peer?.peerNumber);
                console.log(`Detected ${username} leave via Live Share.`);

                await sendMassNotif('leave', { username: username, id: peer?.peerNumber });
            }
        });

        // service.onNotify('initiateJoin', (data: any) => {
        //     console.log("Received my own initiateJoin notification.");
        // });

        initMassNotifs();

        vscode.window.showInformationMessage('✅ OneType session started. Share your Live Share link to others to join the session.');
        console.log("Hosting started.");
        debugSessionState();
    }));

    // Join a session as a guest of the Live Share session.
    context.subscriptions.push(vscode.commands.registerCommand('onetype.joinSession', async () => {
        if (inSession) {
            vscode.window.showErrorMessage('Already in a session.');
            return;
        }

        liveshare = await vsls.getApi();
        if (!liveshare) {
            vscode.window.showErrorMessage('Live Share not detected.');
            return;
        }

        if (liveshare?.session.role !== vsls.Role.Guest) {
            vscode.window.showErrorMessage('You must be a guest of the Live Share session to join the OneType session.');
            return;
        }

        const username = await vscode.window.showInputBox({ prompt: 'Enter your username:' });
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

        await proxy.notify('join', { username: username, peerNumber: getMyId() });
        console.log("Sent join notification as guest.");

        proxy.onNotify('initiateJoin', (data: any) => {
            console.log("Received initiateJoin as guest.");

            let updUsers;
            ({ host, editor, users: updUsers, idToUsername } = data);
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

    // As host, end the session for all users.
    context.subscriptions.push(vscode.commands.registerCommand('onetype.endSession', async () => {
        await sendMassNotif('endSession', {});
    }));

    // As guest, leave the session. Need to take care of directly exiting Live Share separately.
    context.subscriptions.push(vscode.commands.registerCommand('onetype.leaveSession', async () => {
        await sendMassNotif('leave', { username: myUsername, id: getMyId() });
        leave();
        vscode.window.showInformationMessage('✅ Left the OneType session.'); 
    }));

    // As editor, give access to another individual.
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

    // As non-editor, force take access.
    context.subscriptions.push(vscode.commands.registerCommand('onetype.forceAccess', async () => {
        if (!inSession) {
            vscode.window.showErrorMessage('You must be in a session to use this command.');
            return;
        }

        if (myUsername === editor) {
            vscode.window.showInformationMessage('You are already the editor.');
            return;
        }

        console.log("Posting transferAccess notification from %s to %s.", editor, myUsername);
        await sendMassNotif('transferAccess', { from: editor, to: myUsername });
    }));

    // As non-editor, request access.
    context.subscriptions.push(vscode.commands.registerCommand('onetype.requestAccess', async () => {
        if (!inSession) {
            vscode.window.showErrorMessage('You must be in a session to use this command.');
            return;
        }

        if (myUsername === editor) {
            vscode.window.showInformationMessage('You are already the editor.');
            return;
        }

        console.log("Posting requestAccess notification from %s to %s.", editor, myUsername);
        await sendMassNotif('requestAccess', { from: editor, to: myUsername });
    }));
}

export function deactivate() {}
