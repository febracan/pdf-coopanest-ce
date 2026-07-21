import type { AppConfig } from '@/types';

const disabledTools = new Set<string>(__DISABLED_TOOLS__);
let configLoaded = false;
let editorDisabledCategories: string[] = [];

export async function loadRuntimeConfig(): Promise<void> {
  if (configLoaded) return;
  configLoaded = true;

  try {
    const response = await fetch(`${import.meta.env.BASE_URL}config.json`, {
      cache: 'no-cache',
    });
    if (!response.ok) return;

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) return;

    const config: AppConfig = await response.json();

    if (Array.isArray(config.disabledTools)) {
      for (const toolId of config.disabledTools) {
        if (typeof toolId === 'string') disabledTools.add(toolId);
      }
    }

    if (Array.isArray(config.editorDisabledCategories)) {
      editorDisabledCategories = config.editorDisabledCategories.filter(
        (c): c is string => typeof c === 'string'
      );
    }
  } catch (err) {
    console.warn('[LOAD_RUNTIME_CONFIG] Skipped runtime config:', err);
  }
}

export function isToolDisabled(toolId: string): boolean {
  return disabledTools.has(toolId);
}

export function getToolIdFromPath(): string | null {
  const path = window.location.pathname;
  const withExtension = path.match(/\/([^/]+)\.html$/);
  if (withExtension) return withExtension[1];
  return path.match(/\/([^/]+)\/?$/)?.[1] ?? null;
}

export function getEditorDisabledCategories(): string[] {
  return editorDisabledCategories;
}

export function isCurrentPageDisabled(): boolean {
  const toolId = getToolIdFromPath();
  return toolId ? isToolDisabled(toolId) : false;
}
