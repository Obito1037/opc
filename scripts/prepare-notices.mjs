import {copyFile} from 'node:fs/promises';
await copyFile(new URL('../THIRD_PARTY_NOTICES.md',import.meta.url),new URL('../public/THIRD_PARTY_NOTICES.txt',import.meta.url));
