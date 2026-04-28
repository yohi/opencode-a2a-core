import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/core/config-loader.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';

const FIXTURE = fileURLToPath(
  new URL('../fixtures/config.test.json', import.meta.url)
);

describe('loadConfig', () => {
  const original = process.env.FAKE_GEMINI_API_KEY;

  beforeEach(() => {
    process.env.FAKE_GEMINI_API_KEY = 'secret-123';
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.FAKE_GEMINI_API_KEY;
      return;
    }
    process.env.FAKE_GEMINI_API_KEY = original;
  });

  it('reads JSON and resolves ${env:VAR} placeholders', async () => {
    const cfg = await loadConfig(FIXTURE);
    const pluginCfg = cfg.plugins['gemini-cli'] as {
      apiKey?: string;
      model?: string;
    };
    expect(pluginCfg.apiKey).toBe('secret-123');
    expect(pluginCfg.model).toBe('gemini-2.5-pro');
  });

  it('throws when ${env:VAR} is not set', async () => {
    delete process.env.FAKE_GEMINI_API_KEY;
    await expect(loadConfig(FIXTURE)).rejects.toThrow(/FAKE_GEMINI_API_KEY/);
  });

  it('returns an empty plugins map for a missing file', async () => {
    const cfg = await loadConfig(
      join(tmpdir(), `non-existent-${randomUUID()}.json`)
    );
    expect(cfg.plugins).toEqual({});
  });

  it('supports lowercase environment variables', async () => {
    process.env.my_api_key = 'lower-secret';
    const tempFile = join(tmpdir(), `test-config-lower-${randomUUID()}.json`);
    try {
      await writeFile(
        tempFile,
        JSON.stringify({
          plugins: { test: { key: '${env:my_api_key}' } },
        })
      );
      const cfg = await loadConfig(tempFile);
      expect((cfg.plugins.test as any).key).toBe('lower-secret');
    } finally {
      delete process.env.my_api_key;
      await unlink(tempFile).catch(() => {});
    }
  });

  it('supports partial placeholders', async () => {
    process.env.API_HOST = 'example.com';
    const tempFile = join(tmpdir(), `test-config-partial-${randomUUID()}.json`);
    try {
      await writeFile(
        tempFile,
        JSON.stringify({
          plugins: { test: { url: 'https://${env:API_HOST}/v1' } },
        })
      );
      const cfg = await loadConfig(tempFile);
      expect((cfg.plugins.test as any).url).toBe('https://example.com/v1');
    } finally {
      delete process.env.API_HOST;
      await unlink(tempFile).catch(() => {});
    }
  });

  it('provides descriptive error for invalid JSON', async () => {
    const tempFile = join(tmpdir(), `test-config-invalid-${randomUUID()}.json`);
    try {
      await writeFile(tempFile, '{ invalid json }');
      await expect(loadConfig(tempFile)).rejects.toThrow(
        /Failed to parse config file at/
      );
      await expect(loadConfig(tempFile)).rejects.toThrow(tempFile);
    } finally {
      await unlink(tempFile).catch(() => {});
    }
  });
});
