import { env } from 'cloudflare:workers';
import type { StoreBrand } from './tryon-config';
export const SESSION_MS=30*60*1000;
export const NO_CACHE={'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer'};
export function bucket(){if(!env.BUCKET)throw new Error('Photo transfer storage is unavailable');return env.BUCKET;}
export function validToken(token:string){return /^[a-f0-9]{32}$/.test(token);}
export async function readSession(token:string){
  if(!validToken(token))return null;
  const obj=await bucket().get(`sessions/${token}.json`);if(!obj)return null;
  const session=await obj.json<{expiresAt:number;brand?:StoreBrand|null}>();
  if(Date.now()>session.expiresAt){await removeSession(token);return null;}
  return session;
}
export async function removeSession(token:string){if(validToken(token))await bucket().delete([`sessions/${token}.json`,`photos/${token}.jpg`]);}
export function failure(e:unknown){console.error('Photo transfer unavailable',e instanceof Error?e.message:'Unknown error');return Response.json({error:'Photo transfer is temporarily unavailable. Please try again.'},{status:503,headers:NO_CACHE});}
