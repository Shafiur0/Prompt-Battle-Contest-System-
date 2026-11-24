import { Injectable,HttpException } from '@nestjs/common';
import { Issuer,generators,BaseClient } from 'openid-client';
import { createHash,randomBytes } from 'node:crypto';
import type { Request,Response } from 'express';
import { config } from './config';
import { pool,transaction } from './db';
export interface AppUser {id:string;alias:string;isOrganizer:boolean;}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const options={httpOnly:true,sameSite:'lax' as const,secure:config.secureCookies,path:'/'};
const loginOptions={...options,path:'/api/v1/auth'};
export const LOGIN_FLOW_TTL_MS=30*60*1000;
export const loginCookieName=(state:string)=>'pb_login_'+hash(state).slice(0,24);
@Injectable()
export class AuthService {
 private clientPromise?:Promise<BaseClient>;
 private client(){
  if(!this.clientPromise)this.clientPromise=Issuer.discover(config.issuer).then(i=>new i.Client({client_id:config.clientId,client_secret:config.clientSecret,redirect_uris:[config.origin+'/api/v1/auth/callback'],response_types:['code'],token_endpoint_auth_method:'client_secret_basic'})).catch(error=>{this.clientPromise=undefined;throw error;});
  return this.clientPromise;
 }
 private recover(res:Response,reason:'expired'|'failed'){return res.redirect(new URL('/?auth='+reason,config.origin).toString());}
 async user(req:Request):Promise<AppUser|null>{
  const token=req.cookies?.pb_session;if(typeof token!=='string'||token.length>200)return null;
  const row=(await pool.query('SELECT u.id,u.alias,u.is_organizer FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>clock_timestamp()',[hash(token)])).rows[0];
  return row?{id:row.id,alias:row.alias,isOrganizer:row.is_organizer}:null;
 }
 async requireUser(req:Request){const u=await this.user(req);if(!u)throw new HttpException('Sign in to continue.',401);return u;}
 async requireOrganizer(req:Request){const u=await this.requireUser(req);if(!u.isOrganizer)throw new HttpException('Organizer access is required.',403);return u;}
 assertOrigin(req:Request){if(req.headers.origin!==config.origin)throw new HttpException('The request origin is not permitted.',403);}
 async login(res:Response){
  try{
   const client=await this.client(),flow=randomBytes(32).toString('base64url'),state=generators.state(),nonce=generators.nonce(),verifier=generators.codeVerifier();
   await pool.query('DELETE FROM auth_flows WHERE expires_at<clock_timestamp()');
   await pool.query('INSERT INTO auth_flows(token_hash,state,nonce,verifier,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval \'30 minutes\')',[hash(flow),state,nonce,verifier]);
   res.cookie(loginCookieName(state),flow,{...loginOptions,maxAge:LOGIN_FLOW_TTL_MS});
   res.redirect(client.authorizationUrl({scope:'openid profile email',prompt:'login',state,nonce,code_challenge:generators.codeChallenge(verifier),code_challenge_method:'S256'}));
  }catch{return this.recover(res,'failed');}
 }
 async callback(req:Request,res:Response){
  const state=req.query?.state;
  if(typeof state!=='string'||!state||state.length>512)return this.recover(res,'failed');
  const name=loginCookieName(state),specific=req.cookies?.[name],legacy=req.cookies?.pb_login;
  const usingLegacy=typeof specific!=='string'&&typeof legacy==='string',token=usingLegacy?legacy:specific;
  if(typeof token!=='string'||!token||token.length>200)return this.recover(res,'expired');
  try{
   // A mismatched callback must not consume another attempt's cookie-bound flow.
   const row=(await pool.query('DELETE FROM auth_flows WHERE token_hash=$1 AND state=$2 AND expires_at>clock_timestamp() RETURNING *',[hash(token),state])).rows[0];
   if(!row){if(!usingLegacy)res.clearCookie(name,loginOptions);return this.recover(res,'expired');}
   res.clearCookie(usingLegacy?'pb_login':name,usingLegacy?options:loginOptions);
   const client=await this.client();
   const tokens=await client.callback(config.origin+'/api/v1/auth/callback',client.callbackParams(req),{state:row.state,nonce:row.nonce,code_verifier:row.verifier});
   const claims=tokens.claims() as Record<string,any>;
   if(typeof claims.sub!=='string'||claims.iss!==config.issuer)throw new Error('Identity mismatch');
   const organizer=Array.isArray(claims.realm_access?.roles)&&claims.realm_access.roles.includes('organizer');
   const alias=typeof claims.preferred_username==='string'?claims.preferred_username:'participant';
   const sessionToken=randomBytes(32).toString('base64url');
   await transaction(async db=>{
    const u=(await db.query('INSERT INTO users(issuer,subject,alias,is_organizer) VALUES($1,$2,$3,$4) ON CONFLICT(issuer,subject) DO UPDATE SET alias=EXCLUDED.alias,is_organizer=EXCLUDED.is_organizer RETURNING id',[config.identityIssuer,claims.sub,alias,organizer])).rows[0];
    await db.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,clock_timestamp()+interval \'8 hours\')',[hash(sessionToken),u.id]);
   });
   res.cookie('pb_session',sessionToken,{...options,maxAge:28800000});res.redirect(config.origin);
  }catch{return this.recover(res,'failed');}
 }
 async logout(req:Request,res:Response){this.assertOrigin(req);const token=req.cookies?.pb_session;if(typeof token==='string')await pool.query('DELETE FROM sessions WHERE token_hash=$1',[hash(token)]);res.clearCookie('pb_session',options);res.json({ok:true});}
}
