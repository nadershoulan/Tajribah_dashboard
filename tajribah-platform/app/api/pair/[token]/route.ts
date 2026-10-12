import { bucket, readSession, removeSession, NO_CACHE, failure, validToken } from '@site/lib/pair-store';
import { POSE_HEADER, poseFromHeader } from '@site/lib/pair-pose';
import { PHOTO_HEADER, addPhoto, photoKey, validPhotoId, waitingPhotos } from '@site/lib/pair-photos';
type Context={params:Promise<{token:string}>};
export async function GET(request:Request,context:Context){
  try{
    const {token}=await context.params;const session=await readSession(token);
    if(!session)return Response.json({error:'This session has expired.'},{status:404,headers:NO_CACHE});
    // T139: several photos wait, oldest first; `?image=<id>` takes one, `?image=1` the oldest (the studio before T139)
    const waiting=await waitingPhotos(bucket(),token);
    const asked=new URL(request.url).searchParams.get('image');
    if(asked!==null){
      const id=asked==='1'?waiting[0]:asked;
      const image=id&&validPhotoId(id)?await bucket().get(photoKey(token,id)):null;
      if(!image)return Response.json({error:'No photo yet.'},{status:404,headers:NO_CACHE});
      // T134.7: where the shopper left the product on their phone, checked again on the way out
      const pose=poseFromHeader(image.customMetadata?.pose);
      return new Response(image.body,{headers:{...NO_CACHE,'Content-Type':'image/jpeg','X-Content-Type-Options':'nosniff',[PHOTO_HEADER]:id!,...(pose?{[POSE_HEADER]:image.customMetadata!.pose!}:{})}});
    }
    return Response.json({ready:waiting.length>0,photos:waiting,expiresAt:session.expiresAt},{headers:NO_CACHE});
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
    // T134.7: the shopper's own fit travels with the photo (a short, checked header); none — the computer places it itself
    const pose=request.headers.get(POSE_HEADER);
    // T139: one more in the session's queue — the session stays open for the next
    const added=await addPhoto(bucket(),token,bytes,poseFromHeader(pose)?pose:null);
    if('full' in added)return Response.json({error:'Several photos are waiting for your screen. Open it to receive them, then send more.'},{status:429,headers:NO_CACHE});
    return Response.json({sent:true,id:added.id},{headers:NO_CACHE});
  }catch(e){return failure(e);}
}
export async function DELETE(request:Request,context:Context){
  if(request.headers.get('Sec-Fetch-Site')==='cross-site')return new Response(null,{status:403});
  try{
    const {token}=await context.params;if(!validToken(token))return new Response(null,{status:400});
    // T139: `?image=<id>` — the computer has that photo: it goes; without it, the whole session
    const id=new URL(request.url).searchParams.get('image');
    if(id!==null){if(!validPhotoId(id))return new Response(null,{status:400});await bucket().delete(photoKey(token,id));return new Response(null,{status:204,headers:NO_CACHE});}
    await removeSession(token);return new Response(null,{status:204,headers:NO_CACHE});
  }catch(e){return failure(e);}
}
