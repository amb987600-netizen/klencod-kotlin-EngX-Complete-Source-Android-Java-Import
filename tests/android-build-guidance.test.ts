import { describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = resolve(process.cwd());
const script = join(root, 'scripts/android-apk.mjs');

describe('Capacitor Android build entry point', () => {
  it('uses Capacitor instead of Flutter in the workflow', () => {
    const workflow = readFileSync(join(root, '.github/workflows/android-apk.yml'), 'utf8');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(workflow).not.toMatch(/flutter-action|flutter pub get|flutter build apk/);
    expect(workflow).toContain("java-version: '21'");
    expect(workflow).toContain("node-version: '22'");
    expect(workflow).toContain('npm run android:apk');
    expect(workflow).toContain('cache-dependency-path:');
    expect(workflow).toContain("root='EngX'");
    expect(pkg.scripts['android:sync']).toBe('npm run build && cap sync android');
    expect(pkg.scripts['android:apk']).toBe('node scripts/android-apk.mjs');
  });

  it('prints help when launched outside the source directory', () => {
    const result = spawnSync(process.execPath, [script, '--help'], { cwd: tmpdir(), encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NOT Flutter');
    expect(result.stdout).toContain('app-debug.apk');
  });

  it('fails clearly before building if the SDK is missing', () => {
    const missing = join(tmpdir(), 'engx-sdk-intentionally-missing');
    const result = spawnSync(process.execPath, [script, '--check'], {
      cwd: tmpdir(), encoding: 'utf8',
      env: { ...process.env, ANDROID_HOME: missing, ANDROID_SDK_ROOT: missing },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`Project root: ${root}`);
    expect(result.stdout).toContain('MISSING: Android SDK');
    expect(result.stderr).toContain('no build was started');
    expect(result.stdout).not.toContain('> engx@');
  });

  it('checks SDK structure without claiming compilation (mock SDK and Java)', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'engx-prereq-test-'));
    try {
      mkdirSync(join(fixture, 'platforms/android-35'), { recursive: true });
      writeFileSync(join(fixture, 'platforms/android-35/android.jar'), 'mock');
      mkdirSync(join(fixture, 'build-tools/35.0.0'), { recursive: true });
      mkdirSync(join(fixture, 'jdk/bin'), { recursive: true });
      writeFileSync(join(fixture, 'jdk/bin/java'), '#!/bin/sh\necho \'openjdk version "21.0.1"\' >&2\n', { mode: 0o755 });
      const result = spawnSync(process.execPath, [script, '--check'], {
        cwd: tmpdir(), encoding: 'utf8',
        env: { ...process.env, JAVA_HOME: join(fixture, 'jdk'), ANDROID_HOME: fixture, ANDROID_SDK_ROOT: fixture },
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('APK compilation has NOT been tested');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
