# SCPresence

Show what you're listening to on **SoundCloud** as your **Discord** status: "Listening to", with the track title, artist, cover art, a live progress bar and a "Listen on SoundCloud" button.

Free, open source, no accounts or tokens handed to anyone. It uses Discord's official Rich Presence connection on your own machine.

> Unofficial project. Not affiliated with or endorsed by SoundCloud or Discord.

## How it works

```
soundcloud.com tab          local helper (Node)            Discord desktop app
+------------------+  HTTP  +------------------+   IPC    +------------------+
| browser extension| -----> | server.js        | -------> | Rich Presence    |
| reads the player |  127.0 | 127.0.0.1:47800  |  (local  | "Listening to..."|
+------------------+  .0.1  +------------------+   pipe)  +------------------+
```

A browser extension can't talk to Discord directly (Discord's Rich Presence only accepts connections from desktop programs on the same machine), so a tiny local helper sits in the middle. Everything stays on your PC. Nothing is sent to any server other than Discord's own app on your machine.

## Requirements

- Discord **desktop app** (the browser version can't show Rich Presence)
- A Chromium-based browser: Chrome, Edge, Brave, Opera, Vivaldi
- [Node.js](https://nodejs.org) 18 or newer (LTS is fine)
- Windows, macOS or Linux (developed and tested on Windows; macOS/Linux paths are implemented but less tested)

## Setup

### 1. Get the code

Download this repository (Code -> Download ZIP) and extract it somewhere permanent, e.g. `C:\apps\scpresence`. Don't move the folder afterwards, the extension loads from it.

### 2. Create your Discord application

1. Go to <https://discord.com/developers/applications> and click **New Application**.
2. Name it **SoundCloud**. This is the name Discord shows in your profile ("Listening to SoundCloud").
3. On **General Information**, copy the **Application ID**.

### 3. Add your Application ID

Open `config.json` and replace the placeholder:

```json
{
  "clientId": "123456789012345678",
  "port": 47800
}
```

(You can also set the `DISCORD_CLIENT_ID` environment variable instead.) The Application ID is not a secret.

### 4. Turn on activity sharing in Discord

**User Settings -> Activity Privacy -> Share my activity** must be on.

### 5. Load the extension

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder.

### 6. Start the helper

In a terminal opened in the project folder:

```
npm start
```

You should see `SCPresence listening on http://127.0.0.1:47800`. Leave it running.

Windows tip: open the folder in File Explorer, click the address bar, type `cmd` and press Enter.

### 7. Play something

Open <https://soundcloud.com> (refresh the tab if it was already open) and press play. The terminal prints `Now playing: ...` and `Connected to Discord`, and your Discord profile updates. Pausing or closing the tab clears the status.

## What shows on Discord

| Where | What you see |
|---|---|
| Member list | Track title (`status_display_type: 2`) |
| Profile card | "Listening to SoundCloud", title, artist, artwork, progress bar |
| Button | "Listen on SoundCloud" linking to the track (visible to others, not to you) |

To show the artist instead of the track title in the member list, change `status_display_type: 2` to `1` in `server.js`.

## Low resource usage

- **Extension:** no fast polling. It watches only the play button and track badge with MutationObservers, plus one 5-second tick. It messages the helper only when the track or play state changes, and once every 30 seconds as a heartbeat while playing.
- **Helper:** when nothing is playing it has no timers and no open Discord connection (about 0% CPU). It connects to Discord when playback starts and disconnects when you pause. RAM is Node's baseline, roughly 30-40 MB.
- Presence updates are only sent on real changes, which keeps you inside Discord's rate limits.

## Troubleshooting

| Problem | Fix |
|---|---|
| `'npm' is not recognized` | Install Node.js, then close and reopen your terminal (restart Windows if needed). |
| Error about the config on start | `config.json` still contains the placeholder Application ID. |
| Nothing prints when you press play | Refresh the SoundCloud tab after loading the extension. Check the extension is enabled. |
| `Now playing` prints but Discord shows nothing | Use the desktop Discord app, enable **Share my activity**, and check the log says `Connected to Discord`. |
| Member list still shows the app name | Update and fully restart Discord (or Ctrl+R). Make sure `status_display_type` is present in `server.js`. |
| You can't see your own button | Discord hides Rich Presence buttons from the person who owns the status. Ask a friend or check with an alt account. |
| Track info is empty or wrong | SoundCloud may have changed its page layout. The selectors are all in `extension/content.js`. |
| Port already in use | Change `port` in `config.json`, the URL in `extension/background.js`, and `host_permissions` in `extension/manifest.json`. |

## Project layout

```
server.js               local helper: HTTP endpoint + Discord IPC client (no dependencies)
config.json             your Discord Application ID and port
extension/
  manifest.json         Manifest V3
  content.js            reads the SoundCloud player bar
  background.js         forwards updates to the helper
```

## Limitations

- Reads SoundCloud's web page, since SoundCloud has no public "now playing" API. Layout changes on their side can break it until the selectors are updated.
- Chromium browsers only for now. The helper has to be running (`npm start`).
- Only the SoundCloud website is supported, not the desktop or mobile apps.

## Privacy

Track title, artist, artwork URL and playback position are read from the SoundCloud tab and sent only to `127.0.0.1` on your own machine, then to your local Discord app. There is no telemetry and no external server.

## License

MIT, see [LICENSE](LICENSE).
