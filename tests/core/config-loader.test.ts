import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/core/config-loader.js';

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
    const cfg = await loadConfig('/tmp/does-not-exist-opencode-a2a.json');
    expect(cfg.plugins).toEqual({});
  });

  it('supports lowercase environment variables', async () => {
    process.env.my_api_key = 'lower-secret';
    try {
      const tempFile = '/tmp/test-config-lower.json';
      await import('node:fs/promises').then((fs) =>
        fs.writeFile(
          tempFile,
          JSON.stringify({
            plugins: { test: { key: '${env:my_api_key}' } },
          })
        )
      );
      const cfg = await loadConfig(tempFile);
      expect((cfg.plugins.test as any).key).toBe('lower-secret');
    } finally {
      delete process.env.my_api_key;
    }
  });

  it('supports partial placeholders', async () => {
    process.env.API_HOST = 'example.com';
    try {
      const tempFile = '/tmp/test-config-partial.json';
      await import('node:fs/promises').then((fs) =>
        fs.writeFile(
          tempFile,
          JSON.stringify({
            plugins: { test: { url: 'https://${env:API_HOST}/v1' } },
          })
        )
      );
      const cfg = await loadConfig(tempFile);
      expect((cfg.plugins.test as any).url).toBe('https://example.com/v1');
    } finally {
      delete process.env.API_HOST;
    }
  });

  it('provides descriptive error for invalid JSON', async () => {
    const tempFile = '/tmp/test-config-invalid.json';
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(tempFile, '{ invalid json }')
    );
    await expect(loadConfig(tempFile)).rejects.toThrow(
      /Failed to parse config file at/
    );
    await expect(loadConfig(tempFile)).rejects.toThrow(tempFile);
  });
});
