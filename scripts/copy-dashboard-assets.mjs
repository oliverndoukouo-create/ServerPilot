import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../src/dashboard/', import.meta.url));
const destination = fileURLToPath(new URL('../dist/dashboard/', import.meta.url));
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });
