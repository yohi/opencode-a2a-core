import type { A2APluginInterface } from './plugin-interface.js';

export function defineA2APlugin<TConfig>(
  def: A2APluginInterface<TConfig>
): A2APluginInterface<TConfig> {
  return def;
}
