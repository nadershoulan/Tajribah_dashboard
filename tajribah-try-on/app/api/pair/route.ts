import { bucket, SESSION_MS, NO_CACHE, failure, removeSession } from '@/lib/pair-store';
export async function POST(request:Request){
  if(request.headers.get('Sec-Fetch-Site')==='cross-site')return new Response(null,{status:403});
  try{
    const id=crypto.randomUUID().replaceAll('-','');const expiresAt=Date.now()+SESSION_MS;
    // Opportunistically clear abandoned, expired sessions without a background job.
    const old=await bucket().list({prefix:'sessions/',limit:100});
    await Promise.all(old.objects.filter(o=>o.uploaded.getTime()<Date.now()-SESSION_MS).map(o=>removeSession(o.key.slice(9,-5))));
    await bucket().put(`sessions/${id}.json`,JSON.stringify({expiresAt}),{httpMetadata:{contentType:'application/json'}});
    return Response.json({id,expiresAt},{status:201,headers:NO_CACHE});
  }catch(e){return failure(e);}
}
