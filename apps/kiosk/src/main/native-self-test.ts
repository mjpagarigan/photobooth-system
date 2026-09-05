import { mkdtempSync, rmSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { app, safeStorage } from 'electron';
import sharp from 'sharp';

import { WorkerImageProcessor } from './image/image-worker-client.js';

type SelfTestResult = {
  ok: boolean;
  sqlite: boolean;
  sharp: boolean;
  worker: boolean;
  safeStorage: boolean;
  code?: string;
};

export async function runNativeSelfTest(workerUrl: URL): Promise<SelfTestResult> {
  const temporaryRoot = resolve(app.getPath('temp'));
  const temporaryDirectory = mkdtempSync(join(temporaryRoot, 'grace-booth-self-test-'));
  const result: SelfTestResult = {
    ok: false,
    sqlite: false,
    sharp: false,
    worker: false,
    safeStorage: false,
  };
  let stage = 'sqlite';
  try {
    const database = new BetterSqlite3(join(temporaryDirectory, 'native.sqlite3'));
    database.exec('CREATE TABLE test (value INTEGER NOT NULL); INSERT INTO test VALUES (1)');
    result.sqlite = database.prepare('SELECT value FROM test').pluck().get() === 1;
    database.close();

    stage = 'safe_storage';
    const protectedValue = safeStorage.encryptString('grace-booth-native-self-test');
    result.safeStorage =
      safeStorage.isEncryptionAvailable() &&
      safeStorage.decryptString(protectedValue) === 'grace-booth-native-self-test';

    stage = 'sharp';
    const photo = await sharp({
      create: { width: 120, height: 80, channels: 3, background: '#3159b8' },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
    const frame = await sharp({
      create: {
        width: 120,
        height: 360,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 0.001 },
      },
    })
      .png()
      .toBuffer();
    result.sharp = (await sharp(photo).metadata()).format === 'jpeg';

    stage = 'worker';
    const worker = new WorkerImageProcessor(workerUrl);
    try {
      const processed = await worker.process({
        captures: [photo, photo, photo],
        framePng: frame,
        slots: [
          {
          slotIndex: 1,
          zIndex: 0,
            name: '1',
            x: 0,
            y: 0,
            width: 1,
            height: 1 / 3,
            cropMode: 'crop-to-fill',
          },
          {
          slotIndex: 2,
          zIndex: 1,
            name: '2',
            x: 0,
            y: 1 / 3,
            width: 1,
            height: 1 / 3,
            cropMode: 'crop-to-fill',
          },
          {
          slotIndex: 3,
          zIndex: 2,
            name: '3',
            x: 0,
            y: 2 / 3,
            width: 1,
            height: 1 / 3,
            cropMode: 'crop-to-fill',
          },
        ],
        frameAspectRatio: 1 / 3,
      });
      result.worker =
        processed.width === 120 && processed.height === 360 && processed.byteSize > 0;
    } finally {
      await worker.close();
    }
    result.ok = result.sqlite && result.sharp && result.worker && result.safeStorage;
    return result;
  } catch (error) {
    const detail =
      error instanceof Error && 'code' in error && typeof error.code === 'string'
        ? `_${error.code.replace(/[^a-z0-9_]/gi, '').slice(0, 40)}`
        : '';
    return { ...result, ok: false, code: `${stage}_failed${detail}` };
  } finally {
    const resolved = resolve(temporaryDirectory);
    const relation = relative(temporaryRoot, resolved);
    if (
      dirname(resolved) === temporaryRoot &&
      basename(resolved).startsWith('grace-booth-self-test-') &&
      relation !== '' &&
      !relation.startsWith('..')
    ) {
      rmSync(resolved, { recursive: true, force: true });
    }
  }
}
