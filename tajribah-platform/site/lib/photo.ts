export async function preparePhoto(blob:Blob):Promise<{dataUrl:string;blob:Blob}>{
  if(blob.size>20*1024*1024)throw new Error('Image exceeds 20 MB');
  const url=URL.createObjectURL(blob);
  try{
    const img=await new Promise<HTMLImageElement>((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=url;});
    const factor=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
    const c=document.createElement('canvas');c.width=Math.round(img.naturalWidth*factor);c.height=Math.round(img.naturalHeight*factor);
    const ctx=c.getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);
    const dataUrl=c.toDataURL('image/jpeg',.88);
    const processed=await new Promise<Blob>((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('Image conversion failed')),'image/jpeg',.88));
    return {dataUrl,blob:processed};
  }finally{URL.revokeObjectURL(url);}
}
