#!/usr/bin/env node

import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const DEFAULT_APP_ID = "2913321";
const DEFAULT_INSTALLATION_ID = "111456446";
const DEFAULT_PEM_PATH = "~/vault/unlimiting-sena_pk.pem";

const expandHome = (value) => {
  if (!value.startsWith("~/")) return value;
  return path.join(os.homedir(), value.slice(2));
};

const toBase64Url = (input) =>
  Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const parseArgs = (argv) => {
  const options = {};
  const ghArgs = [];
  let isGhArgs = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--") {
      isGhArgs = true;
      continue;
    }

    if (isGhArgs) {
      ghArgs.push(token);
      continue;
    }

    if (!token.startsWith("--")) {
      ghArgs.push(token);
      isGhArgs = true;
      continue;
    }

    const normalized = token.slice(2);
    const [key, inlineValue] = normalized.split("=", 2);

    if (inlineValue !== undefined) {
      options[key] = inlineValue;
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      i += 1;
      continue;
    }

    options[key] = true;
  }

  return { options, ghArgs };
};

const printHelp = () => {
  console.log(`psc-gh - Run gh CLI with GitHub App installation token

USAGE
  psc-gh [options] -- <gh args...>
  psc-gh <gh args...>

OPTIONS
  --app-id <id>             GitHub App ID
  --installation-id <id>    GitHub App Installation ID
  --pem-path <path>         Private key PEM path
  --token-only              Print masked token metadata only
  --help                    Show help

ENV
  UNLIMITING_SENA_APP_ID
  UNLIMITING_SENA_INSTALLATION_ID
  UNLIMITING_SENA_PRIVATE_KEY_PATH

EXAMPLE
  psc-gh repo view unlimiting-studio/psc
  psc-gh -- gh api /repos/unlimiting-studio/psc
`);
};

const signJwt = ({ appId, privateKeyPem }) => {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: now - 60,
    exp: now + 540,
    iss: Number(appId),
  };

  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(privateKeyPem);
  return `${unsignedToken}.${toBase64Url(signature)}`;
};

const issueInstallationToken = async ({ appId, installationId, privateKeyPem }) => {
  const jwt = signJwt({ appId, privateKeyPem });
  const response = await fetch(
    `https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
      },
    },
  );

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `토큰 발급 실패 (${response.status} ${response.statusText}): ${JSON.stringify(body)}`,
    );
  }

  if (!body.token) {
    throw new Error(`토큰 응답이 비정상입니다: ${JSON.stringify(body)}`);
  }

  return body;
};

const maskToken = (token) => `${token.slice(0, 6)}...${token.slice(-4)}`;

const runGhWithToken = async (ghArgs, token) => {
  const child = spawn("gh", ghArgs, {
    stdio: "inherit",
    env: {
      ...process.env,
      GH_TOKEN: token,
      GITHUB_TOKEN: "",
    },
  });

  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`gh exited with code ${code}`));
    });
  });
};

const main = async () => {
  const { options, ghArgs } = parseArgs(process.argv.slice(2));

  if (options.help || options.h) {
    printHelp();
    return;
  }

  const appId = String(options["app-id"] ?? process.env.UNLIMITING_SENA_APP_ID ?? DEFAULT_APP_ID);
  const installationId = String(
    options["installation-id"] ??
      process.env.UNLIMITING_SENA_INSTALLATION_ID ??
      DEFAULT_INSTALLATION_ID,
  );
  const pemPath = expandHome(
    String(options["pem-path"] ?? process.env.UNLIMITING_SENA_PRIVATE_KEY_PATH ?? DEFAULT_PEM_PATH),
  );

  const privateKeyPem = await readFile(path.resolve(pemPath), "utf8");
  const issued = await issueInstallationToken({
    appId,
    installationId,
    privateKeyPem,
  });

  if (options["token-only"]) {
    console.log(
      JSON.stringify(
        {
          appId,
          installationId,
          token: maskToken(issued.token),
          expiresAt: issued.expires_at,
          repositoriesCount: Array.isArray(issued.repositories)
            ? issued.repositories.length
            : undefined,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (ghArgs.length === 0) {
    printHelp();
    console.error("\n실행할 gh 인자가 없습니다. 예: psc-gh repo view unlimiting-studio/psc");
    process.exit(1);
  }

  await runGhWithToken(ghArgs, issued.token);
};

main().catch((error) => {
  console.error("[psc-gh] 실패");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
