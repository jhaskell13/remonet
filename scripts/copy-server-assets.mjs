import { cpSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { URL, fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../server/persistence/migrations/', import.meta.url));
const destination = fileURLToPath(new URL('../dist/server/server/persistence/migrations/', import.meta.url));
mkdirSync(dirname(destination), { recursive: true });
cpSync(source, destination, { recursive: true });
