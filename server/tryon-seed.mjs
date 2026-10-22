import {randomInt} from 'node:crypto';

export const MAX_TRYON_SEED=2147483647;
export const isTryOnSeed=value=>Number.isInteger(value)&&value>=0&&value<=MAX_TRYON_SEED;
// Resolve only while creating a new task. Persist the returned value and pass
// it unchanged to inference; polling/recovery must never create a fresh seed.
export function resolveTryOnSeed(value){
  if(value===undefined)return randomInt(MAX_TRYON_SEED+1);
  if(!isTryOnSeed(value))throw Object.assign(new Error('种子须为 0–2147483647 的整数。'),{code:'INVALID_SEED'});
  return value;
}
