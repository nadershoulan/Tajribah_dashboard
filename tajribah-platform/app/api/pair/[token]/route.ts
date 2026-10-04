import { bucket, readSession, removeSession, NO_CACHE, failure, validToken } from '@site/lib/pair-store';
type Context={params:Promise<{token:string}>};
export async function GET(request:Request,context:Context){
  try{
    const {token}=await context.params;const session=await readSession(token);
    if(!session)return Response.json({error:'This session has expired.'},{status:404,headers:NO_CACHE});
    if(new URL(request.url).searchParams.has('image')){const image=await bucket().get(`photos/${token}.jpg`);if(!image)return Response.json({error:'No photo yet.'},{status:404,headers:NO_CACHE});return new Response(image.body,{headers:{...NO_CACHE,'Content-Type':'image/jpeg','X-Content-Type-Options':'nosniff'}});}
    const image=await bucket().head(`photos/${token}.jpg`);return Response.json({ready:!!image,expiresAt:session.expiresAt},{headers:NO_CACHE});
  }catch(e){return failure(e);}
}
export async function POST(request:Request,context:Context){
  if(request.headers.get('Sec-Fetch-Site')==='cross-site')return new Response(null,{status:403});
  try{
    const {token}=await context.params;if(!await readSession(token))return Response.json({error:'This session has expired. Scan a new code.'},{status:404,headers:NO_CACHE});
    if(request.headers.get('content-type')!=='image/jpeg')return Response.json({error:'Please choose a supported photo.'},{status:415,headers:NO_CACHE});
    if(Number(request.headers.get('content-length'))>4*1024*1024)return Response.json({error:'Photo is too large.'},{status:413,headers:NO_CACHE});
    const reader=request.body?.getReader();if(!reader)return new Response(null,{status:400});const chunks:Uint8Array[]=[];let total=0;
    for(;;){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>4*1024*1024){await reader.cancel();return Response.json({error:'Photo is too large.'},{status:413,headers:NO_CACHE});}chunks.push(value);}
    const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
    if(total<4||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)return Response.json({error:'Invalid photo format.'},{status:415,headers:NO_CACHE});
    await bucket().put(`photos/${token}.jpg`,bytes,{httpMetadata:{contentType:'image/jpeg'}});
    return Response.json({sent:true},{headers:NO_CACHE});
  }catch(e){return failure(e);}
}
export async function DELETE(request:Request,context:Context){
  if(request.headers.get('Sec-Fetch-Site')==='cross-site')return new Response(null,{status:403});
  try{const {token}=await context.params;if(!validToken(token))return new Response(null,{status:400});await removeSession(token);return new Response(null,{status:204,headers:NO_CACHE});}catch(e){return failure(e);}
}
