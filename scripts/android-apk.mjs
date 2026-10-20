#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';
const args = process.argv.slice(2);
if (args.some(arg => !['--check', '--help'].includes(arg))) {
  console.error('Usage: node scripts/android-apk.mjs [--check | --help]');
  process.exit(2);
}
if (args.includes('--help')) {
  console.log('EngX = React/TypeScript + Capacitor, NOT Flutter.\nFrom the project root: npm ci && npm run android:apk\n--check checks prerequisites without building.\nRequires Node 22+, JDK 21, Android SDK platform 35 and build-tools 35.0.0.\nOutput: android/app/build/outputs/apk/debug/app-debug.apk (debug only).');
  process.exit(0);
}
const errors = [];
const check = (ok, message) => { console.log(`${ok ? 'OK' : 'MISSING'}: ${message}`); if (!ok) errors.push(message); };
console.log(`EngX Capacitor Android build\nProject root: ${root}\nDo not run flutter pub get or flutter build apk for this project.`);
check(Number(process.versions.node.split('.')[0]) >= 22, 'Node.js 22 or newer');
for (const file of ['package.json', 'package-lock.json', 'capacitor.config.ts', 'android/settings.gradle', 'android/gradle/wrapper/gradle-wrapper.jar']) {
  check(existsSync(join(root, file)), file);
}
check(existsSync(join(root, 'node_modules/@capacitor/android/capacitor/build.gradle')) && existsSync(join(root, 'node_modules/@capacitor/cli/bin/capacitor')), 'npm dependencies (run npm ci first)');
const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', windows ? 'java.exe' : 'java') : 'java';
const version = spawnSync(java, ['-version'], { encoding: 'utf8' });
const javaText = `${version.stdout || ''}\n${version.stderr || ''}`;
const major = Number(javaText.match(/version\s+"(\d+)/)?.[1]);
check(version.status === 0 && major === 21, 'JDK 21 (set JAVA_HOME and the IDE Gradle JDK to the same JDK)');
let localSDK = '';
const properties = join(root, 'android/local.properties');
if (existsSync(properties)) {
  localSDK = (readFileSync(properties, 'utf8').match(/^sdk\.dir\s*=\s*(.+)$/m)?.[1] || '').trim().replace(/\\:/g, ':').replace(/\\\\/g, '\\');
}
// Gradle's project-local sdk.dir takes priority over environment variables.
const sdk = localSDK || process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '';
check(Boolean(sdk) && existsSync(sdk), 'Android SDK directory (ANDROID_HOME or android/local.properties sdk.dir)');
check(Boolean(sdk) && existsSync(join(sdk, 'platforms/android-35/android.jar')), 'Android SDK platform 35');
check(Boolean(sdk) && existsSync(join(sdk, 'build-tools/35.0.0')), 'Android SDK build-tools 35.0.0');
if (errors.length) {
  console.error('\nPrerequisites are incomplete; no build was started. See docs/KLENCOD-APK.ar.md.');
  process.exit(1);
}
if (args.includes('--check')) {
  console.log('\nPrerequisite checks passed; APK compilation has NOT been tested by this check.');
  process.exit(0);
}
function run(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, { cwd, stdio: 'inherit', shell: windows });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status || 1);
}
run(windows ? 'npm.cmd' : 'npm', ['run', 'android:sync'], root);
run(windows ? 'gradlew.bat' : 'sh', windows ? ['--no-daemon', 'assembleDebug'] : ['./gradlew', '--no-daemon', 'assembleDebug'], join(root, 'android'));
const output = join(root, 'android/app/build/outputs/apk/debug/app-debug.apk');
if (!existsSync(output)) {
  console.error(`Gradle ended without the expected APK: ${output}`);
  process.exit(1);
}
console.log(`\nDebug APK ready: ${output}\nDebug signing is for testing, not production distribution.`);
