import { bucket, SESSION_MS, NO_CACHE, failure, removeSession } from '@/lib/pair-store';
import { brandOfPairing } from '@/lib/pair-brand';
export async function POST(request:Request){
  if(request.headers.get('Sec-Fetch-Site')==='cross-site')return new Response(null,{status:403});
  try{
    const id=crypto.randomUUID().replaceAll('-','');const expiresAt=Date.now()+SESSION_MS;
    // T61: an Enterprise store's own name and logo for the phone page (null: Tajribah's), read alongside the sweep.
    const branding=brandOfPairing(request);
    // Opportunistically clear abandoned, expired sessions without a background job.
    const old=await bucket().list({prefix:'sessions/',limit:100});
    await Promise.all(old.objects.filter(o=>o.uploaded.getTime()<Date.now()-SESSION_MS).map(o=>removeSession(o.key.slice(9,-5))));
    const brand=await branding;
    await bucket().put(`sessions/${id}.json`,JSON.stringify({expiresAt,brand}),{httpMetadata:{contentType:'application/json'}});
    return Response.json({id,expiresAt},{status:201,headers:NO_CACHE});
  }catch(e){return failure(e);}
}
