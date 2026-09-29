// Relays track info from the SoundCloud tab to the local SCPresence server.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'scp-update') {
    fetch('http://127.0.0.1:47800/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg.payload),
    }).catch(() => {}); // server not running: ignore
  }
});
