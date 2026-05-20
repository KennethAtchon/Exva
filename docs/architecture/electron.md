### Electron Explained Simply

Electron lets you build desktop apps (Windows, macOS, Linux) using HTML, CSS, and JavaScript.

#### Core Idea

Electron combines two technologies:

- **Chromium** → Renders your HTML/CSS/JS (the user interface)
- **Node.js** → Gives access to the computer’s file system, dialogs, menus, etc.

#### Two Main Processes

1. **Main Process**
   - The “brain” of the app.
   - Runs in full Node.js environment.
   - Responsible for: creating windows, app lifecycle, native menus, system features.
   - File: usually `main.js`

2. **Renderer Process**
   - Where your UI lives (your Vite + React/Vue/Svelte code).
   - Behaves like a browser tab.
   - Cannot directly access most Node.js features for security reasons.

#### How the UI Talks to the System (Safe Communication)

Because the renderer is restricted, Electron uses **IPC (Inter-Process Communication)** to let the UI and main process talk safely.

You create a safe bridge using a **preload script** + `contextBridge`.

**Pattern Used:**

- **Renderer (Client)** uses `ipcRenderer.invoke()` → makes a request
- **Main (Server)** uses `ipcMain.handle()` → handles the request and returns a response

#### Simple Mental Model

Think of it like this:

- **Renderer** = Frontend / Client (your Vite code)
- **Main Process** = Backend / Server (has full system access)

- `ipcRenderer.invoke('channel', data)` → like sending a request to the server
- `ipcMain.handle('channel', handler)` → like the server endpoint that responds

#### How It Works in Practice

1. **Main Process** creates a window and loads your `index.html`
2. **Preload Script** runs in the renderer and safely exposes only the functions you allow
3. Your Vite code calls `window.electronAPI.xxx()`
4. These calls go through `ipcRenderer.invoke()` to the main process
5. Main process does the work and returns the result

#### Example Structure

**In preload.js** (the bridge):

```js
contextBridge.exposeInMainWorld("electronAPI", {
  getVersion: () => ipcRenderer.invoke("get-app-version"),
  openFile: () => ipcRenderer.invoke("dialog:open-file"),
  saveData: (data) => ipcRenderer.invoke("save-data", data),
});
```

**In your Vite code** (React/Vue/etc.):

```js
const version = await window.electronAPI.getVersion();
const filePath = await window.electronAPI.openFile();
```

**In main.js** (the server side):

```js
ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('dialog:open-file', async () => {
  const result = await dialog.showOpenDialog(...);
  return result.filePaths[0];
});
```

### Summary (One-liner version)

Electron runs your UI in a secure renderer process. To safely access system features, the renderer sends requests using `ipcRenderer.invoke()` through a safe bridge (`contextBridge`), and the main process responds using `ipcMain.handle()`.

---

You can copy the entire block above. It’s short, clear, and covers everything we discussed.

Would you like me to also add a small section about one-way messaging (`send` + `on`) or tips for Vite setup? Just say the word.
