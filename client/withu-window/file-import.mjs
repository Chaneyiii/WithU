import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
// Renderer supplies file bytes, never a destination path or an arbitrary RPC channel.
export async function importSelectedFiles(owner,dataDir,files){
 if(!Array.isArray(files)||!files.length||files.length>20)throw new Error('Select between 1 and 20 files');
 let total=0;const validated=files.map(file=>{
  if(!file||typeof file.name!=='string'||!file.name||file.name.length>255||typeof file.base64!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64))throw new Error('Invalid file');
  const bytes=Buffer.from(file.base64,'base64');total+=bytes.length;if(total>16777216)throw new Error('Files must total 16 MB or less');
  return {name:path.basename(file.name.replaceAll('\\','/')),bytes};
 });
 const root=path.resolve(dataDir,'imports');await mkdir(root,{recursive:true});const result=[];
 for(const file of validated){const id=randomUUID(),destination=path.join(root,id);await writeFile(destination,file.bytes,{flag:'wx'});try{const object={schema_version:1,id,name:file.name,path:destination,size:file.bytes.length,type:path.extname(file.name).slice(1),modified:new Date().toISOString(),version:1};result.push((await owner.request('withu:library:update',{object,expected_version:0})).object);}catch(e){await unlink(destination);throw e;}}
 return result;
}
