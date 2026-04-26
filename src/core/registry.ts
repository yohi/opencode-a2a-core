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
    const initialized: A2APluginInterface[] = [];
    try {
      for (const plugin of this.plugins.values()) {
        const raw = Object.prototype.hasOwnProperty.call(configs, plugin.id)
          ? configs[plugin.id]
          : {};
        const parsed = plugin.configSchema ? plugin.configSchema.parse(raw) : raw;
        await plugin.initialize?.(parsed);
        initialized.push(plugin);
      }
    } catch (err) {
      for (let i = initialized.length - 1; i >= 0; i--) {
        try {
          await initialized[i].dispose?.();
        } catch (disposeErr) {
          // Log dispose errors during rollback to preserve the original error
          console.error(
            `Failed to dispose plugin ${initialized[i].id} during rollback:`,
            disposeErr
          );
        }
      }
      throw err;
    }
  }

  async disposeAll(): Promise<void> {
    const errors: unknown[] = [];
    for (const plugin of this.plugins.values()) {
      try {
        await plugin.dispose?.();
      } catch (err) {
        errors.push(err);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "One or more plugins failed to dispose");
    }
  }
}
