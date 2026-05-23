Major bug: When you stop the session while its running, it keeps running in the background even when the UI indicates that it stopped. When I try to start it back up again I come against a bunch of errors when clicking the start button....

Error occurred in handler for 'session:start': Error: Cannot transition session from stopped to active
    at /Users/ken/Documents/workspace/Exva/.vite/build/index-BEa-St-5.cjs:9457:23
    at async WebContents.<anonymous> (node:electron/js2c/browser_init:2:87023) {
  code: 'INVALID_TRANSITION'
}