import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/core/config-loader.js';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

describe('loadConfig Security', () => {
  it('prevents prototype pollution', async () => {
    const tempFile = join(
      tmpdir(),
      `a2a-config-pollution-${randomUUID()}.json`
    );
    const maliciousJson = JSON.stringify({
      plugins: {
        test: {
          __proto__: { polluted: 'yes' },
          constructor: { prototype: { polluted: 'yes' } },
        },
      },
    });

    try {
      await writeFile(tempFile, maliciousJson);
      const cfg = await loadConfig(tempFile);

      const pluginCfg = cfg.plugins.test as any;

      // 1. プロトタイプが汚染されていないことを確認
      expect(({} as any).polluted).toBeUndefined();

      // 2. 返されたオブジェクトに悪意のある値が含まれていないことを確認
      // Zodがオブジェクトを再生成するため、__proto__自体は存在する（Object.prototypeを指す）が、
      // 入力された悪意のある値 ("polluted": "yes") は含まれないはず。
      expect(pluginCfg.polluted).toBeUndefined();

      // __proto__ というキー自体が自身のプロパティとして存在しないことを確認
      expect(Object.prototype.hasOwnProperty.call(pluginCfg, '__proto__')).toBe(
        false
      );
      expect(
        Object.prototype.hasOwnProperty.call(pluginCfg, 'constructor')
      ).toBe(false);
    } finally {
      await unlink(tempFile).catch(() => {});
    }
  });
});
