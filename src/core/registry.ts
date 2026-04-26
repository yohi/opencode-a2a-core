import type { A2APluginInterface } from "./plugin-interface.js";

export class PluginRegistry {
  private readonly plugins = new Map<string, A2APluginInterface>();

  register(plugin: A2APluginInterface): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`duplicate plugin id: ${plugin.id}`);
    }
    this.plugins.set(plugin.id, plugin);
  }

  get(id: string): A2APluginInterface | undefined {
    return this.plugins.get(id);
  }

  list(): A2APluginInterface[] {
    return [...this.plugins.values()];
  }

  async initializeAll(configs: Record<string, unknown>): Promise<void> {
    for (const plugin of this.plugins.values()) {
      const raw = configs[plugin.id] ?? {};
      const parsed = plugin.configSchema.parse(raw);
      await plugin.initialize(parsed);
    }
  }

  async disposeAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      await plugin.dispose();
    }
  }
}
