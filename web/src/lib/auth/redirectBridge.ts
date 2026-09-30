import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';

// Entry for /blank.html, the registered `redirectUri`. MSAL v5 popups return here; the page hands
// the response to the main window and MSAL closes the popup. The SPA itself is not loaded.
void broadcastResponseToMainFrame().catch((e: unknown) => {
  console.error('MSAL redirect bridge failed', e);
});
