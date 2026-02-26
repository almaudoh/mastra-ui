import path, { dirname } from 'path';
import { fileURLToPath } from 'url';


export function getDbPath() {
  if (import.meta.url) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(dirname(dirname(__filename)));
    return path.resolve(__dirname, './workspace/database');
  }
}
