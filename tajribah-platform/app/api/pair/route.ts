import { bucket, SESSION_MS, NO_CACHE, failure, removeSession } from '@site/lib/pair-store';
import { pairingOf } from '@site/lib/pair-brand';
export async function POST(request:Request){
  if(request.headers.get('Sec-Fetch-Site')==='cross-site')return new Response(null,{status:403});
  try{
    const id=crypto.randomUUID().replaceAll('-','');const expiresAt=Date.now()+SESSION_MS;
    // T61/T134.3: the store (its name; its logo under white-label) and the product for the phone page, read on the
    // server from where the pairing started — never from the request (the studio's body names only the guide's kind, and on the demo which demo product).
    const length=Number(request.headers.get('content-length')??0);
    const body=length>0&&length<=1024?await request.text():'';
    const branding=pairingOf(request,body);
    // Opportunistically clear abandoned, expired sessions without a background job.
    const old=await bucket().list({prefix:'sessions/',limit:100});
    await Promise.all(old.objects.filter(o=>o.uploaded.getTime()<Date.now()-SESSION_MS).map(o=>removeSession(o.key.slice(9,-5))));
    const {brand,product,kind}=await branding;
    await bucket().put(`sessions/${id}.json`,JSON.stringify({expiresAt,brand,product,kind}),{httpMetadata:{contentType:'application/json'}});
    return Response.json({id,expiresAt},{status:201,headers:NO_CACHE});
  }catch(e){return failure(e);}
}
