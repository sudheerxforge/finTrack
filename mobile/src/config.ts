// App configuration. No secrets here: the Gemini API key is a Cloudflare
// Worker secret, and the phone only ever gets short-lived tokens from it.

// Your deployed Worker (cloudflare/). The GitHub workflow deploys it on every
// push; its URL is printed in the workflow log, and looks like
//   https://fintrack-api.<your-subdomain>.workers.dev
// Find your subdomain at dash.cloudflare.com -> Workers & Pages.
export const API_URL = 'https://fintrack-api.sudheerxforge.workers.dev';

// One Worker serves everything (Gemini token, AI parsing, backup, receipts).
export const BACKEND_URL = API_URL;
export const STORAGE_URL = API_URL;

// If you set the APP_KEY secret on the Worker, put the same value here. It only
// deters casual abuse (anything inside an app can be extracted).
export const APP_KEY = '';
