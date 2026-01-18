# OneType: VS Code Extension for Virtualing ICPC-Format Contests

Enforces the one-computer rule when virtualing ICPC-style contests. Works on top of VS Code Live Share to provide a shared workspace where only one user is permitted to type at a time.

## Features

Commands for managing and assigning edit permissions can be accessed through the Command Palette (`Ctrl + Shift + P` (Windows/Linux), `Shift + Command + P` (Mac)):

* `OneType: Host Session`: Hosts a new OneType session.
* `OneType: Join Session`: Joins a OneType session.
* `OneType: End Session`: As the host, ends a OneType session for all users.
* `OneType: Leave Session`: As a guest, leaves a OneType session.
* `OneType: Give Access to User`: Prompts for the user to give edit access to, then grants edit access for that user.
* `OneType: Request Access`: Notifies the current editor, and requests them to yield access.
* `OneType: Force Take Access`: Forcefully takes access from the current editor.

## Installation

Download the `.vsix` file, then navigate to the Command Palette and install with `Extensions: Install from VSIX...`.

## Usage

* Choose one person to host the extension. They should use the command `Ctrl + K, Ctrl + O` (`Command + K, Command + O` on Mac) to open and select a folder to share.
* They should then set up a VS Code Live Share, distribute the join link, then *once the Live Share session has started* use the `OneType: Host Session` command (`Ctrl + Shift + P` then type the command name) to start a new OneType session.
* Others can join at any time. They should **first join the Live Share**, then, *once the Live Share session has been completely joined* join the **OneType session** with the `OneType: Join Session` command. *If the OneType command does not appear after joining the Live Share, it may be necessary to reinstall the extension via VSIX again, then retry.*
* Edit permissions commands can be used by anyone in the OneType session, not just the host.
* At any time, guests may leave the OneType session, and the host can end the OneType session through the commands above.

## Requirements

VS Code Live Share: Can be downloaded from the Extensions Marketplace on VS Code.

## Known Issues

* Currently, editing by non-editors is not forcefully prohibited; instead, a pop-up appears preventing the user from making continuous edits. Obviously, the host may use another text editor to change the code on their device without being restricted by the OneType edit permissions.
* The publisher and extension ID are currently altered in order to grant access to the Live Share API (see [https://github.com/microsoft/live-share/issues/2896](https://github.com/microsoft/live-share/issues/2896) for other examples of this issue). As such, the extension appears as "Test Explorer Live Share" in the Extensions sidebar; DO NOT update from there or you will have to reinstall. If this gets enough support I may consider publishing and/or requesting access to the Live Share API.

## TODO

* Add method to notify/alert any user without requesting edit permissions.
* Add sidebar detailing status of each user (who is the host, who currently has edit permissions)
* Possibly add option to use as a more general competitive-programming teamwork extension, including the ability to disable the one-edit rule, and problem management:
  * Add problem statuses (read, solution idea, implementing, AC) to each problem
  * Auto-detect problem solution files to easily jump to problems
  * Auto-detect status of each user based on edit actions ("implementing K...")

## Release Notes

### 0.0.1

Initial release.
