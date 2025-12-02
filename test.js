// google_oauth.js
import fetch from "node-fetch";
import readline from "readline";

const CLIENT_ID = "945434649624-ckkq4d739tc0vtr7hknddpg3b69rouau.apps.googleusercontent.com"; // replace
const CLIENT_SECRET = "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"; // replace
const REDIRECT_URI = "http://localhost:8000"; // for manual copy/paste
const SCOPE = "https://www.googleapis.com/auth/gmail.send";

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

// Step 1 → Generate OAuth URL
function getAuthUrl() {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent"
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// Step 2 → Exchange code for token
async function exchangeCode(code) {
  const body = new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code"
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const data = await res.json();

  if (data.expires_in) data.expiry_date = Date.now() + data.expires_in * 1000;

  console.log("Token JSON:\n", JSON.stringify(data, null, 2));
}

async function main() {
  const url = getAuthUrl();
  console.log("Visit this URL in your browser:\n", url);
  const code = await prompt("Paste the code you received here: ");
  await exchangeCode(code.trim());
}

main();
