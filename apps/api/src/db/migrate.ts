import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pool } from './index';
async function main() {
 const sql=readFileSync(resolve(__dirname,'migrations/001_initial.sql'),'utf8');
 await pool.query(sql);
 const upgrade=readFileSync(resolve(__dirname,'migrations/002_automatic_revision.sql'),'utf8');
 await pool.query(upgrade);
 console.log('Backend database migration applied.');
 await pool.end();
}
main().catch(async(error:unknown)=>{
 const e=error as {code?:string;message?:string};
 const message=(e.message||'Unknown error').replace(/postgres(?:ql)?:\/\/[^\s]+/g,'[redacted database connection]');
 console.error('Database migration failed ['+(e.code||'UNKNOWN')+']: '+message);
 await pool.end().catch(()=>{});process.exitCode=1;
});
