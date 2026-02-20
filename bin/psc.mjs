#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { google } from 'googleapis';

const ANDROID_PUBLISHER_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

function readPackageVersion() {
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const packageJsonPath = path.resolve(currentDir, '../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return packageJson.version || '0.1.0';
  } catch {
    return '0.1.0';
  }
}

function maskValue(value, visiblePrefix = 8, visibleSuffix = 4) {
  if (!value || typeof value !== 'string') {
    return '(none)';
  }

  if (value.length <= visiblePrefix + visibleSuffix) {
    return '*'.repeat(value.length);
  }

  return `${value.slice(0, visiblePrefix)}...${value.slice(-visibleSuffix)}`;
}

function resolvePackageName(candidate) {
  const packageName = candidate || process.env.PSC_PACKAGE_NAME;
  if (!packageName) {
    throw new CliError('패키지명을 찾을 수 없습니다. --package-name 또는 PSC_PACKAGE_NAME을 설정하세요.');
  }

  return packageName;
}

function loadServiceAccountCredentials(explicitPath) {
  const rawJson = process.env.PSC_SERVICE_ACCOUNT_JSON;
  if (rawJson) {
    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      throw new CliError('PSC_SERVICE_ACCOUNT_JSON 값이 유효한 JSON이 아닙니다.');
    }

    validateServiceAccount(parsed);
    return {
      credentials: parsed,
      source: 'PSC_SERVICE_ACCOUNT_JSON',
    };
  }

  const credentialsPath =
    explicitPath ||
    process.env.PSC_SERVICE_ACCOUNT_JSON_PATH ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!credentialsPath) {
    throw new CliError(
      '서비스 계정 자격증명을 찾을 수 없습니다. --credentials, PSC_SERVICE_ACCOUNT_JSON_PATH, GOOGLE_APPLICATION_CREDENTIALS 중 하나를 설정하세요.',
    );
  }

  const resolvedPath = path.resolve(credentialsPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new CliError(`서비스 계정 파일이 존재하지 않습니다: ${resolvedPath}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  } catch {
    throw new CliError(`서비스 계정 파일 JSON 파싱 실패: ${resolvedPath}`);
  }

  validateServiceAccount(parsed);

  return {
    credentials: parsed,
    source: resolvedPath,
  };
}

function validateServiceAccount(credentials) {
  if (!credentials || typeof credentials !== 'object') {
    throw new CliError('서비스 계정 자격증명 형식이 유효하지 않습니다.');
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new CliError('서비스 계정 자격증명에 client_email 또는 private_key가 없습니다.');
  }
}

async function createContext(options = {}, requirePackage = false) {
  const { credentials, source } = loadServiceAccountCredentials(options.credentials);

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [ANDROID_PUBLISHER_SCOPE],
    subject: options.subject || process.env.PSC_IMPERSONATE_SUBJECT || undefined,
  });

  await auth.authorize();

  const api = google.androidpublisher({
    version: 'v3',
    auth,
  });

  return {
    api,
    auth,
    credentials,
    credentialsSource: source,
    packageName: requirePackage ? resolvePackageName(options.packageName) : options.packageName || process.env.PSC_PACKAGE_NAME || null,
  };
}

async function getAccessToken(auth) {
  const fromCredentials = auth.credentials?.access_token;
  if (fromCredentials) {
    return fromCredentials;
  }

  const tokenResponse = await auth.getAccessToken();

  if (typeof tokenResponse === 'string') {
    return tokenResponse;
  }

  if (tokenResponse && typeof tokenResponse === 'object' && typeof tokenResponse.token === 'string') {
    return tokenResponse.token;
  }

  return null;
}

function collectValues(value, previous) {
  if (!previous) {
    return [value];
  }

  previous.push(value);
  return previous;
}

function parseVersionCodes(rawValues) {
  const values = Array.isArray(rawValues) ? rawValues : [rawValues];
  const versionCodes = [];

  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    for (const item of value.split(',')) {
      const trimmed = item.trim();
      if (!trimmed) {
        continue;
      }

      if (!/^\d+$/.test(trimmed)) {
        throw new CliError(`유효하지 않은 versionCode: ${trimmed}`);
      }

      versionCodes.push(trimmed);
    }
  }

  if (versionCodes.length === 0) {
    throw new CliError('최소 1개 이상의 --version-code가 필요합니다.');
  }

  return [...new Set(versionCodes)];
}

function parseUserFraction(raw) {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new CliError('--user-fraction은 0보다 크고 1보다 작은 값이어야 합니다.');
  }

  return value;
}

function parseInAppUpdatePriority(raw) {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 5) {
    throw new CliError('--in-app-update-priority는 0~5 정수여야 합니다.');
  }

  return value;
}

function loadReleaseNotes(filePath) {
  if (!filePath) {
    return undefined;
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new CliError(`release notes 파일이 존재하지 않습니다: ${resolvedPath}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  } catch {
    throw new CliError(`release notes JSON 파싱 실패: ${resolvedPath}`);
  }

  if (Array.isArray(parsed)) {
    const notes = parsed.map((entry) => ({
      language: entry?.language,
      text: entry?.text,
    }));

    for (const note of notes) {
      if (!note.language || !note.text) {
        throw new CliError('release notes 배열 항목은 language, text를 모두 포함해야 합니다.');
      }
    }

    return notes;
  }

  if (parsed && typeof parsed === 'object') {
    const notes = Object.entries(parsed).map(([language, text]) => ({
      language,
      text: String(text),
    }));

    if (notes.length === 0) {
      throw new CliError('release notes 객체가 비어 있습니다.');
    }

    return notes;
  }

  throw new CliError('release notes는 배열 또는 객체(JSON) 형식이어야 합니다.');
}

function buildReleaseFromOptions(options, versionCodes) {
  const status = options.status || 'completed';
  const allowedStatuses = new Set(['draft', 'inProgress', 'halted', 'completed']);

  if (!allowedStatuses.has(status)) {
    throw new CliError(`유효하지 않은 release status: ${status}`);
  }

  const release = {
    status,
    versionCodes,
  };

  if (options.releaseName) {
    release.name = options.releaseName;
  }

  const userFraction = parseUserFraction(options.userFraction);
  if (userFraction !== undefined) {
    release.userFraction = userFraction;
  }

  if (status === 'inProgress' && userFraction === undefined) {
    throw new CliError('status가 inProgress인 경우 --user-fraction이 필요합니다.');
  }

  const updatePriority = parseInAppUpdatePriority(options.inAppUpdatePriority);
  if (updatePriority !== undefined) {
    release.inAppUpdatePriority = updatePriority;
  }

  const releaseNotes = loadReleaseNotes(options.releaseNotesFile);
  if (releaseNotes) {
    release.releaseNotes = releaseNotes;
  }

  return release;
}

function ensureAabFile(aabPath) {
  if (!aabPath) {
    throw new CliError('--aab 옵션이 필요합니다.');
  }

  const resolvedPath = path.resolve(aabPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new CliError(`AAB 파일이 존재하지 않습니다: ${resolvedPath}`);
  }

  const stats = fs.statSync(resolvedPath);
  if (!stats.isFile()) {
    throw new CliError(`AAB 경로가 파일이 아닙니다: ${resolvedPath}`);
  }

  return resolvedPath;
}

function normalizeGoogleApiError(error) {
  if (error instanceof CliError) {
    return error;
  }

  const status = error?.response?.status;
  const responseError = error?.response?.data?.error;
  const apiMessage = responseError?.message;

  let message = apiMessage || error?.message || '알 수 없는 오류가 발생했습니다.';

  if (status) {
    message = `[HTTP ${status}] ${message}`;
  }

  return new CliError(message);
}

function addAuthOptions(command) {
  return command
    .option('--credentials <path>', '서비스 계정 JSON 파일 경로')
    .option('--subject <email>', '도메인 전체 위임 시 impersonation 대상 이메일');
}

function addPackageOption(command) {
  return command.option('--package-name <name>', 'Android package name (예: com.example.app)');
}

const program = new Command();
program
  .name('psc')
  .description('Google Play Developer API CLI (Edits workflow)')
  .version(readPackageVersion())
  .showHelpAfterError();

const authCommand = program.command('auth').description('인증 관련 명령');

addAuthOptions(
  authCommand
    .command('token')
    .description('액세스 토큰 발급 상태 확인 (토큰은 마스킹 출력)')
    .action(async (options) => {
      const { auth, credentials, credentialsSource } = await createContext(options, false);
      const token = await getAccessToken(auth);
      if (!token) {
        throw new CliError('액세스 토큰 발급에 실패했습니다.');
      }

      const expiresAt = auth.credentials?.expiry_date
        ? new Date(auth.credentials.expiry_date).toISOString()
        : '(unknown)';

      console.log(`serviceAccount: ${credentials.client_email}`);
      console.log(`credentialsSource: ${credentialsSource}`);
      console.log(`accessToken: ${maskValue(token, 10, 6)}`);
      console.log(`expiresAt: ${expiresAt}`);
    }),
);

addPackageOption(
  addAuthOptions(
    authCommand
      .command('status')
      .description('인증 및 패키지 접근 권한 확인')
      .action(async (options) => {
        const { auth, api, credentials, credentialsSource, packageName } = await createContext(options, false);
        const token = await getAccessToken(auth);

        console.log(`serviceAccount: ${credentials.client_email}`);
        console.log(`credentialsSource: ${credentialsSource}`);
        console.log(`tokenIssued: ${token ? 'yes' : 'no'}`);
        if (token) {
          console.log(`accessToken: ${maskValue(token, 10, 6)}`);
        }

        const expiresAt = auth.credentials?.expiry_date
          ? new Date(auth.credentials.expiry_date).toISOString()
          : '(unknown)';
        console.log(`expiresAt: ${expiresAt}`);

        if (!packageName) {
          console.log('packageAccess: skipped (--package-name 또는 PSC_PACKAGE_NAME 필요)');
          return;
        }

        const response = await api.edits.insert({
          packageName,
          requestBody: {},
        });

        console.log('packageAccess: ok');
        console.log(`packageName: ${packageName}`);
        console.log(`probeEditId: ${response.data.id || '(none)'}`);
        console.log(`probeEditExpiry: ${response.data.expiryTimeSeconds || '(none)'}`);
        console.log('note: probe edit는 commit하지 않았습니다.');
      }),
  ),
);

const editsCommand = program.command('edits').description('Google Play edits 관리');

addPackageOption(
  addAuthOptions(
    editsCommand
      .command('create')
      .description('새 edit 생성')
      .action(async (options) => {
        const { api, packageName } = await createContext(options, true);

        const response = await api.edits.insert({
          packageName,
          requestBody: {},
        });

        console.log(`packageName: ${packageName}`);
        console.log(`editId: ${response.data.id || '(none)'}`);
        console.log(`expiryTimeSeconds: ${response.data.expiryTimeSeconds || '(none)'}`);
      }),
  ),
);

addPackageOption(
  addAuthOptions(
    editsCommand
      .command('validate')
      .description('edit validate')
      .requiredOption('--edit-id <id>', 'edit id')
      .action(async (options) => {
        const { api, packageName } = await createContext(options, true);

        const response = await api.edits.validate({
          packageName,
          editId: options.editId,
        });

        console.log(`packageName: ${packageName}`);
        console.log(`editId: ${options.editId}`);
        console.log(`validated: ${response.data.id ? 'yes' : 'yes'}`);
      }),
  ),
);

addPackageOption(
  addAuthOptions(
    editsCommand
      .command('commit')
      .description('edit commit')
      .requiredOption('--edit-id <id>', 'edit id')
      .option('--changes-not-sent-for-review', 'Google Play 검토 제출 없이 변경 반영')
      .action(async (options) => {
        const { api, packageName } = await createContext(options, true);

        const response = await api.edits.commit({
          packageName,
          editId: options.editId,
          changesNotSentForReview: Boolean(options.changesNotSentForReview),
        });

        console.log(`packageName: ${packageName}`);
        console.log(`editId: ${response.data.id || options.editId}`);
        console.log(`committed: yes`);
      }),
  ),
);

const bundlesCommand = program.command('bundles').description('AAB 업로드');

addPackageOption(
  addAuthOptions(
    bundlesCommand
      .command('upload')
      .description('edit에 AAB 업로드')
      .requiredOption('--edit-id <id>', 'edit id')
      .requiredOption('--aab <path>', '.aab 파일 경로')
      .action(async (options) => {
        const { api, packageName } = await createContext(options, true);
        const aabPath = ensureAabFile(options.aab);

        const response = await api.edits.bundles.upload({
          packageName,
          editId: options.editId,
          media: {
            mimeType: 'application/octet-stream',
            body: fs.createReadStream(aabPath),
          },
        });

        console.log(`packageName: ${packageName}`);
        console.log(`editId: ${options.editId}`);
        console.log(`aabPath: ${aabPath}`);
        console.log(`versionCode: ${response.data.versionCode || '(none)'}`);
        if (response.data.sha1) {
          console.log(`sha1: ${response.data.sha1}`);
        }
        if (response.data.sha256) {
          console.log(`sha256: ${response.data.sha256}`);
        }
      }),
  ),
);

const tracksCommand = program.command('tracks').description('트랙 조회/업데이트');

addPackageOption(
  addAuthOptions(
    tracksCommand
      .command('get')
      .description('트랙 정보 조회')
      .requiredOption('--edit-id <id>', 'edit id')
      .requiredOption('--track <track>', '트랙 (internal, alpha, beta, production 등)')
      .action(async (options) => {
        const { api, packageName } = await createContext(options, true);

        const response = await api.edits.tracks.get({
          packageName,
          editId: options.editId,
          track: options.track,
        });

        console.log(JSON.stringify(response.data, null, 2));
      }),
  ),
);

addPackageOption(
  addAuthOptions(
    tracksCommand
      .command('update')
      .description('트랙 릴리스 업데이트')
      .requiredOption('--edit-id <id>', 'edit id')
      .requiredOption('--track <track>', '트랙 (internal, alpha, beta, production 등)')
      .option('--version-code <code>', '배포할 versionCode (반복 또는 comma 구분)', collectValues, [])
      .option('--status <status>', 'release status (draft|inProgress|halted|completed)', 'completed')
      .option('--release-name <name>', 'release name')
      .option('--user-fraction <fraction>', 'inProgress 비율 (0~1 사이, 0/1 제외)')
      .option('--in-app-update-priority <priority>', 'in-app update priority (0~5)')
      .option('--release-notes-file <path>', 'release notes JSON 파일')
      .action(async (options) => {
        const { api, packageName } = await createContext(options, true);
        const versionCodes = parseVersionCodes(options.versionCode);
        const release = buildReleaseFromOptions(options, versionCodes);

        const response = await api.edits.tracks.update({
          packageName,
          editId: options.editId,
          track: options.track,
          requestBody: {
            track: options.track,
            releases: [release],
          },
        });

        console.log(JSON.stringify(response.data, null, 2));
      }),
  ),
);

const publishCommand = program.command('publish').description('전체 배포 플로우');

addPackageOption(
  addAuthOptions(
    publishCommand
      .command('submit')
      .description('create -> upload -> track update -> validate -> commit')
      .requiredOption('--aab <path>', '.aab 파일 경로')
      .requiredOption('--track <track>', '트랙 (internal, alpha, beta, production 등)')
      .option('--status <status>', 'release status (draft|inProgress|halted|completed)', 'completed')
      .option('--release-name <name>', 'release name')
      .option('--user-fraction <fraction>', 'inProgress 비율 (0~1 사이, 0/1 제외)')
      .option('--in-app-update-priority <priority>', 'in-app update priority (0~5)')
      .option('--release-notes-file <path>', 'release notes JSON 파일')
      .option('--changes-not-sent-for-review', 'Google Play 검토 제출 없이 변경 반영')
      .action(async (options) => {
        const { api, packageName } = await createContext(options, true);
        const aabPath = ensureAabFile(options.aab);

        const createResponse = await api.edits.insert({
          packageName,
          requestBody: {},
        });
        const editId = createResponse.data.id;

        if (!editId) {
          throw new CliError('edit 생성에 실패했습니다. editId가 없습니다.');
        }

        const uploadResponse = await api.edits.bundles.upload({
          packageName,
          editId,
          media: {
            mimeType: 'application/octet-stream',
            body: fs.createReadStream(aabPath),
          },
        });

        const uploadedVersionCode = uploadResponse.data.versionCode;
        if (!uploadedVersionCode) {
          throw new CliError('AAB 업로드 응답에 versionCode가 없습니다.');
        }

        const release = buildReleaseFromOptions(options, [String(uploadedVersionCode)]);

        const trackResponse = await api.edits.tracks.update({
          packageName,
          editId,
          track: options.track,
          requestBody: {
            track: options.track,
            releases: [release],
          },
        });

        await api.edits.validate({
          packageName,
          editId,
        });

        const commitResponse = await api.edits.commit({
          packageName,
          editId,
          changesNotSentForReview: Boolean(options.changesNotSentForReview),
        });

        console.log(`packageName: ${packageName}`);
        console.log(`editId: ${editId}`);
        console.log(`aabPath: ${aabPath}`);
        console.log(`uploadedVersionCode: ${uploadedVersionCode}`);
        console.log(`track: ${options.track}`);
        console.log(`releaseStatus: ${release.status}`);
        console.log(`validated: yes`);
        console.log(`committed: yes`);

        const committedEditId = commitResponse.data.id || editId;
        console.log(`committedEditId: ${committedEditId}`);

        if (trackResponse.data?.releases?.length) {
          console.log(`trackReleases: ${trackResponse.data.releases.length}`);
        }
      }),
  ),
);

async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    const normalized = normalizeGoogleApiError(error);
    console.error(`Error: ${normalized.message}`);
    process.exit(normalized.exitCode || 1);
  }
}

main();
