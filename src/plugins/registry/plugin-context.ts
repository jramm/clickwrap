import { Logger } from '@nestjs/common';
import type { ClickwrapPluginKind, PluginContext } from '../../plugin-sdk';

/**
 * Host implementation of the SDK {@link PluginContext}: env access over process.env (empty values
 * count as unset — matches the pre-plugin factories) and a namespaced Nest logger.
 */
export const createPluginContext = (plugin: { kind: ClickwrapPluginKind; key: string }): PluginContext => {
  const logger = new Logger(`plugin:${plugin.key}`);
  const read = (name: string): string | undefined => {
    const value = process.env[name];
    return value === undefined || value === '' ? undefined : value;
  };
  return {
    env: (name, fallback) => read(name) ?? fallback,
    requireEnv: (name) => {
      const value = read(name);
      if (value === undefined) {
        throw new Error(`${name} is required by the active ${plugin.kind} plugin "${plugin.key}"`);
      }
      return value;
    },
    logger: {
      log: (message) => logger.log(message),
      warn: (message) => logger.warn(message),
      error: (message) => logger.error(message),
    },
  };
};
