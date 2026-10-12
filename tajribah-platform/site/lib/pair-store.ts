import { env } from 'cloudflare:workers';
import type { StoreBrand } from './tryon-config';
import type { PairKind, PairProduct } from './pair-product';
import { removePhotos } from './pair-photos';
export const SESSION_MS=30*60*1000;
export const NO_CACHE={'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer'};
// Its own private bucket, never the merchants' public one (`BUCKET`, served by the CDN): a shopper's
// photo must not be reachable by a URL (moved from tajribah-try-on, where BUCKET held only these).
export function bucket(){if(!env.PAIR_BUCKET)throw new Error('Photo transfer storage is unavailable');return env.PAIR_BUCKET;}
export function validToken(token:string){return /^[a-f0-9]{32}$/.test(token);}
export async function readSession(token:string){
  if(!validToken(token))return null;
  const obj=await bucket().get(`sessions/${token}.json`);if(!obj)return null;
  const session=await obj.json<{expiresAt:number;brand?:StoreBrand|null;product?:PairProduct|null;kind?:PairKind;link?:string|null;track?:{store:string;product:string}|null}>();
  if(Date.now()>session.expiresAt){await removeSession(token);return null;}
  return session;
}
// T139: a session's photos wait under photos/<token>/ (several from the phone in one pairing); all go with it
export async function removeSession(token:string){if(!validToken(token))return;await removePhotos(bucket(),token);await bucket().delete(`sessions/${token}.json`);}
export function failure(e:unknown){console.error('Photo transfer unavailable',e instanceof Error?e.message:'Unknown error');return Response.json({error:'Photo transfer is temporarily unavailable. Please try again.'},{status:503,headers:NO_CACHE});}
