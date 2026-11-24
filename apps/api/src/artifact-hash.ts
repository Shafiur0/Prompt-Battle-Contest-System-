import { createHash } from 'node:crypto';
export const ARTIFACT_DIGEST_VERSION='sha256-json-c14n-v1';
export function canonicalJson(value:unknown):string{
 if(value===null)return 'null';
 if(typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number')return Number.isFinite(value)?JSON.stringify(value):'null';
 if(value instanceof Date)return canonicalJson(value.toJSON());
 if(Array.isArray(value))return '['+value.map(v=>v===undefined?'null':canonicalJson(v)).join(',')+']';
 if(typeof value==='object'){
  const object=value as Record<string,unknown>;
  return '{'+Object.keys(object).filter(k=>object[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonicalJson(object[k])).join(',')+'}';
 }
 throw new Error('Unsupported artifact hash value');
}
export const artifactDigest=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:canonicalJson(value)).digest('hex');
export const legacyRequestDigest=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
