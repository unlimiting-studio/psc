#!/usr/bin/env node

import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const PLAY_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const API_BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const UPLOAD_BASE = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3';

const parseArgs = (argv) => {
  const positional = [];
  const options = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }

    const normalized = token.slice(2);
    const [rawKey, rawInlineValue] = normalized.split('=', 2);
    const key = rawKey.trim();
    if (!key) continue;

    const next = argv[i + 1];
    if (rawInlineValue !== undefined) {
      options[key] = rawInlineValue;
      continue;
    }

    if (next && !next.startsWith('--')) {
      options[key] = next;
      i += 1;
      continue;
    }

    options[key] = true;
  }

  return { positional, options };
};

const boolOpt = (value, fallback = undefined) => {
  if (value === undefined) return fallback;
  const v = String(value).toLowerCase().trim();
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  throw new Error(`boolean parse failed: ${value}`);
};

const required = (options, key, envKey) => {
  const value = options[key] ?? (envKey ? process.env[envKey] : undefined);
  if (!value || String(value).trim().length === 0) {
    throw new Error(`missing required option: --${key}${envKey ? ` or ${envKey}` : ''}`);
  }
  return String(value).trim();
};

const toBase64Url = (input) =>
  Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const buildJwt = ({ header, payload, privateKeyPem }) => {
  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKeyPem);

  return `${signingInput}.${toBase64Url(signature)}`;
};

const normalizePrivateKey = (raw) => (raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw);

const readServiceAccount = async (options) => {
  const fromFile = options['service-account-json'] ?? process.env.PLAY_SERVICE_ACCOUNT_JSON_PATH;
  if (fromFile) {
    const raw = await readFile(path.resolve(String(fromFile)), 'utf8');
    return JSON.parse(raw);
  }

  const inline = options['service-account-json-inline'] ?? process.env.PLAY_SERVICE_ACCOUNT_JSON;
  if (inline) {
    return JSON.parse(String(inline));
  }

  throw new Error(
    'service account JSON is required: --service-account-json or PLAY_SERVICE_ACCOUNT_JSON_PATH',
  );
};

const exchangeAccessToken = async (serviceAccount) => {
  const now = Math.floor(Date.now() / 1000);
  const assertion = buildJwt({
    header: { alg: 'RS256', typ: 'JWT' },
    payload: {
      iss: serviceAccount.client_email,
      scope: PLAY_SCOPE,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    privateKeyPem: normalizePrivateKey(serviceAccount.private_key),
  });

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`oauth token exchange failed (${response.status}): ${detail}`);
  }

  return response.json();
};

const jsonRequest = async (url, init = {}) => {
  const res = await fetch(url, init);
  const contentType = res.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
    throw new Error(`HTTP ${res.status} ${res.statusText}\n${detail}`);
  }

  return body;
};

const withAuth = (accessToken, contentType = 'application/json') => ({
  Authorization: `Bearer ${accessToken}`,
  Accept: 'application/json',
  ...(contentType ? { 'Content-Type': contentType } : {}),
});

const editsCreate = ({ packageName, accessToken }) =>
  jsonRequest(`${API_BASE}/applications/${packageName}/edits`, {
    method: 'POST',
    headers: withAuth(accessToken),
    body: JSON.stringify({}),
  });

const editsValidate = ({ packageName, editId, accessToken }) =>
  jsonRequest(`${API_BASE}/applications/${packageName}/edits/${editId}:validate`, {
    method: 'POST',
    headers: withAuth(accessToken),
    body: JSON.stringify({}),
  });

const editsCommit = ({ packageName, editId, accessToken, changesNotSentForReview }) => {
  const url = new URL(`${API_BASE}/applications/${packageName}/edits/${editId}:commit`);
  if (changesNotSentForReview !== undefined) {
    url.searchParams.set('changesNotSentForReview', String(changesNotSentForReview));
  }

  return jsonRequest(url.toString(), {
    method: 'POST',
    headers: withAuth(accessToken),
    body: JSON.stringify({}),
  });
};

const bundlesUpload = async ({ packageName, editId, aabPath, accessToken }) => {
  const buffer = await readFile(path.resolve(aabPath));
  return jsonRequest(
    `${UPLOAD_BASE}/applications/${packageName}/edits/${editId}/bundles?uploadType=media`,
    {
      method: 'POST',
      headers: withAuth(accessToken, 'application/octet-stream'),
      body: buffer,
    },
  );
};

const tracksGet = ({ packageName, editId, track, accessToken }) =>
  jsonRequest(`${API_BASE}/applications/${packageName}/edits/${editId}/tracks/${encodeURIComponent(track)}`, {
    method: 'GET',
    headers: withAuth(accessToken),
  });

const tracksUpdate = ({
  packageName,
  editId,
  track,
  versionCodes,
  status,
  releaseName,
  releaseNotes,
  userFraction,
  inAppUpdatePriority,
  accessToken,
}) => {
  const release = {
    status,
    versionCodes: versionCodes.map((v) => String(v)),
    ...(releaseName ? { name: releaseName } : {}),
    ...(releaseNotes ? { releaseNotes: [{ language: 'ko-KR', text: releaseNotes }] } : {}),
    ...(userFraction !== undefined ? { userFraction } : {}),
    ...(inAppUpdatePriority !== undefined ? { inAppUpdatePriority } : {}),
  };

  return jsonRequest(
    `${API_BASE}/applications/${packageName}/edits/${editId}/tracks/${encodeURIComponent(track)}`,
    {
      method: 'PUT',
      headers: withAuth(accessToken),
      body: JSON.stringify({ track, releases: [release] }),
    },
  );
};

const print = (value) => console.log(JSON.stringify(value, null, 2));

const help = () => {
  console.log(`psc - Play Store Connect CLI (ASC style)\n\nUSAGE\n  psc <group> <command> [flags]\n\nGROUPS\n  auth      token/auth check\n  edits     create/validate/commit edits\n  bundles   upload AAB\n  tracks    get/update tracks\n  publish   one-shot submit (create->upload->track->validate->commit)\n\nCOMMON FLAGS\n  --service-account-json / PLAY_SERVICE_ACCOUNT_JSON_PATH\n  --service-account-json-inline / PLAY_SERVICE_ACCOUNT_JSON\n\nCOMMANDS\n  auth token\n  auth status --package-name <packageName>\n\n  edits create --package-name <packageName>\n  edits validate --package-name <packageName> --edit-id <editId>\n  edits commit --package-name <packageName> --edit-id <editId> [--changes-not-sent-for-review=true|false]\n\n  bundles upload --package-name <packageName> --edit-id <editId> --aab <path/to/app.aab>\n\n  tracks get --package-name <packageName> --edit-id <editId> --track internal\n  tracks update --package-name <packageName> --edit-id <editId> --track internal --version-codes 1234 --status completed\n\n  publish submit --package-name <packageName> --aab <path> --track internal [--status completed]\n`);
};

const parseVersionCodes = (raw) =>
  String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const main = async () => {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const [group, command] = positional;

  if (!group || options.help || options.h) {
    help();
    return;
  }

  const serviceAccount = await readServiceAccount(options);
  const tokenResult = await exchangeAccessToken(serviceAccount);
  const accessToken = tokenResult.access_token;

  if (!accessToken) {
    throw new Error('could not obtain access token');
  }

  if (group === 'auth' && command === 'token') {
    print({
      tokenType: tokenResult.token_type,
      expiresIn: tokenResult.expires_in,
      accessToken: String(accessToken).slice(0, 12) + '...',
    });
    return;
  }

  if (group === 'auth' && command === 'status') {
    const packageName = required(options, 'package-name', 'PLAY_PACKAGE_NAME');
    const edit = await editsCreate({ packageName, accessToken });
    print({ ok: true, packageName, editId: edit.id, auth: 'valid' });
    return;
  }

  if (group === 'edits' && command === 'create') {
    const packageName = required(options, 'package-name', 'PLAY_PACKAGE_NAME');
    print(await editsCreate({ packageName, accessToken }));
    return;
  }

  if (group === 'edits' && command === 'validate') {
    const packageName = required(options, 'package-name', 'PLAY_PACKAGE_NAME');
    const editId = required(options, 'edit-id');
    print(await editsValidate({ packageName, editId, accessToken }));
    return;
  }

  if (group === 'edits' && command === 'commit') {
    const packageName = required(options, 'package-name', 'PLAY_PACKAGE_NAME');
    const editId = required(options, 'edit-id');
    const changesNotSentForReview = boolOpt(options['changes-not-sent-for-review']);
    print(await editsCommit({ packageName, editId, accessToken, changesNotSentForReview }));
    return;
  }

  if (group === 'bundles' && command === 'upload') {
    const packageName = required(options, 'package-name', 'PLAY_PACKAGE_NAME');
    const editId = required(options, 'edit-id');
    const aabPath = required(options, 'aab');
    print(await bundlesUpload({ packageName, editId, aabPath, accessToken }));
    return;
  }

  if (group === 'tracks' && command === 'get') {
    const packageName = required(options, 'package-name', 'PLAY_PACKAGE_NAME');
    const editId = required(options, 'edit-id');
    const track = required(options, 'track');
    print(await tracksGet({ packageName, editId, track, accessToken }));
    return;
  }

  if (group === 'tracks' && command === 'update') {
    const packageName = required(options, 'package-name', 'PLAY_PACKAGE_NAME');
    const editId = required(options, 'edit-id');
    const track = required(options, 'track');
    const versionCodes = parseVersionCodes(required(options, 'version-codes'));
    const status = options.status ? String(options.status) : 'completed';
    const releaseName = options['release-name'] ? String(options['release-name']) : undefined;
    const releaseNotes = options['release-notes'] ? String(options['release-notes']) : undefined;
    const userFraction = options['user-fraction'] ? Number(options['user-fraction']) : undefined;
    const inAppUpdatePriority = options['in-app-update-priority']
      ? Number(options['in-app-update-priority'])
      : undefined;

    print(
      await tracksUpdate({
        packageName,
        editId,
        track,
        versionCodes,
        status,
        releaseName,
        releaseNotes,
        userFraction,
        inAppUpdatePriority,
        accessToken,
      }),
    );
    return;
  }

  if (group === 'publish' && command === 'submit') {
    const packageName = required(options, 'package-name', 'PLAY_PACKAGE_NAME');
    const aabPath = required(options, 'aab');
    const track = options.track ? String(options.track) : 'internal';
    const status = options.status ? String(options.status) : 'completed';
    const releaseName = options['release-name'] ? String(options['release-name']) : undefined;
    const releaseNotes = options['release-notes'] ? String(options['release-notes']) : undefined;
    const userFraction = options['user-fraction'] ? Number(options['user-fraction']) : undefined;
    const inAppUpdatePriority = options['in-app-update-priority']
      ? Number(options['in-app-update-priority'])
      : undefined;
    const changesNotSentForReview = boolOpt(options['changes-not-sent-for-review']);

    const edit = await editsCreate({ packageName, accessToken });
    const editId = edit.id;
    if (!editId) throw new Error('edit create failed: missing editId');

    const uploaded = await bundlesUpload({ packageName, editId, aabPath, accessToken });
    const versionCode = uploaded.versionCode;
    if (!versionCode) throw new Error('bundle upload failed: missing versionCode');

    const trackResult = await tracksUpdate({
      packageName,
      editId,
      track,
      versionCodes: [versionCode],
      status,
      releaseName,
      releaseNotes,
      userFraction,
      inAppUpdatePriority,
      accessToken,
    });

    const validateResult = await editsValidate({ packageName, editId, accessToken });
    const commitResult = await editsCommit({
      packageName,
      editId,
      accessToken,
      changesNotSentForReview,
    });

    print({
      editId,
      upload: uploaded,
      track: trackResult,
      validate: validateResult,
      commit: commitResult,
    });
    return;
  }

  throw new Error(`unsupported command: ${group} ${command ?? ''}`.trim());
};

main().catch((error) => {
  console.error('[psc] failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
