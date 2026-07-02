import path from 'node:path';
import { getContentSource } from '../config.js';
import { createJsonStore } from './json-store.js';
import { createMysqlStore } from './mysql-store.js';

export function createContentStore({ root = process.cwd(), env = process.env } = {}) {
  const source = getContentSource(env);
  if (source === 'json') {
    return createJsonStore({ dataDir: path.join(root, 'data') });
  }
  if (source === 'db') {
    return createMysqlStore();
  }
  throw new Error(`Unsupported CONTENT_SOURCE "${source}"`);
}

export async function loadContent(options = {}) {
  const store = createContentStore(options);
  return store.loadContent();
}
