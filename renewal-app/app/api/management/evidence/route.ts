import {binding,viewer,reply,checkOrigin,failure} from '@/lib/http';
import {addEvidence,downloadEvidence,MAX_EVIDENCE} from '@/lib/management-store';
import {problem} from '@/lib/management-domain';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function POST(request:Request){try{
 const user=await viewer();checkOrigin(request);const type=request.headers.get('content-type')||'';
 if(!type.startsWith('multipart/form-data;'))problem('Choose an evidence file to upload.');
 const limit=MAX_EVIDENCE+64*1024,reader=request.body?.getReader();if(!reader)problem('The file could not be read.');
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();problem('Choose a file no larger than 5 MB.',413)}chunks.push(value)}}finally{reader.releaseLock()}
 const form=await new Response(Buffer.concat(chunks),{headers:{'content-type':type}}).formData(),file=form.get('file');if(!(file instanceof File))problem('Choose one evidence file.');
 if(form.getAll('file').length!==1)problem('Upload one evidence file at a time.');
 return reply(await addEvidence(binding(),user,{id:form.get('id'),version:Number(form.get('version')),requestId:form.get('requestId'),name:file.name},Buffer.from(await file.arrayBuffer())));
}catch(error){return failure(error)}}
export async function GET(request:Request){try{await viewer();const file=await downloadEvidence(binding(),new URL(request.url).searchParams.get('id')||'');return new Response(new Uint8Array(file.content),{headers:{'Content-Type':file.mime,'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(file.name),'Content-Length':String(file.size),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}})}catch(error){return failure(error)}}
