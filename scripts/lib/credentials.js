const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const credentialStore = require("./credential-store");

const ROOT = path.resolve(__dirname, "..", "..");
const CONFIG_DIR = path.join(ROOT, "config", "credentials");
const SUPPORTED_PORTALS = ["linkedin", "workday", "greenhouse", "lever"];

function configPathFor(portal) {
  if (!SUPPORTED_PORTALS.includes(portal)) {
    throw new Error(`Unsupported portal: ${portal}. Choose ${SUPPORTED_PORTALS.join(", ")}.`);
  }
  return path.join(CONFIG_DIR, `${portal}.json`);
}

function loadCredentialConfig(portal) {
  const config = JSON.parse(fs.readFileSync(configPathFor(portal), "utf8"));
  if (typeof config.email !== "string" || typeof config.credentialName !== "string" || !config.credentialName.trim()) {
    throw new Error(`Credential config for ${portal} must contain only a valid email and credentialName.`);
  }
  return { email: config.email.trim(), credentialName: config.credentialName.trim() };
}

function saveCredentialConfig(portal, config) {
  fs.writeFileSync(configPathFor(portal), `${JSON.stringify({
    email: config.email,
    credentialName: config.credentialName
  }, null, 2)}\n`, "utf8");
}

async function promptForEmail(portal) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`Set config/credentials/${portal}.json email before running non-interactively.`);
  }

  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const email = (await prompt.question(`Email for ${portal}: `)).trim();
    if (!email) throw new Error("Email cannot be empty.");
    return email;
  } finally {
    prompt.close();
  }
}

function promptForPassword(portal) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Run this command in an interactive terminal to enter the credential securely.");
  }

  process.stdout.write(`Password for ${portal} (input hidden): `);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve, reject) => {
    let password = "";
    const finish = (error, value) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = chunk => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") return finish(new Error("Credential entry cancelled."));
        if (character === "\r" || character === "\n") {
          if (!password) return finish(new Error("Password cannot be empty."));
          return finish(null, password);
        }
        if (character === "\u007f" || character === "\b") {
          password = password.slice(0, -1);
        } else {
          password += character;
        }
      }
    };
    process.stdin.on("data", onData);
  });
}

async function getCredentials(portal) {
  const config = loadCredentialConfig(portal);
  let credential = credentialStore.getCredential(config.credentialName);

  if (credential && config.email) {
    return {
      portal,
      email: config.email,
      credentialName: config.credentialName,
      password: credential.password
    };
  }

  const email = config.email || await promptForEmail(portal);
  const password = credential?.password || await promptForPassword(portal);
  if (!config.email) saveCredentialConfig(portal, { ...config, email });
  if (!credential) {
    credentialStore.setCredential({
      target: config.credentialName,
      username: email,
      password
    });
    credential = { password };
  }

  return {
    portal,
    email,
    credentialName: config.credentialName,
    password: credential.password
  };
}

async function main() {
  const portal = process.argv[2];
  if (!portal) throw new Error(`Usage: node scripts/lib/credentials.js <${SUPPORTED_PORTALS.join("|")}>`);

  const credentials = await getCredentials(portal.toLowerCase());
  console.log(`Credential ready for ${credentials.portal}; password stored in Windows Credential Manager.`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Credential Manager failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { getCredentials, loadCredentialConfig, saveCredentialConfig };
