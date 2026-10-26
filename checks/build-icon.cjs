// Run with: electron checks/build-icon.cjs. Render the approved vector locally;
// Windows ICO embeds individually rendered PNGs (16..256), including alpha.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path');
app.whenReady().then(async()=>{
 let win;
 try{
  const root=path.resolve(__dirname,'../client/withu-window');
  const svg=await fs.readFile(path.join(root,'withu-icon.svg'),'utf8');
  win=new BrowserWindow({show:false,width:1024,height:1024,useContentSize:true,backgroundColor:'#00000000',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  const html=`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>html,body{margin:0;width:100%;height:100%;background:transparent}img{display:block;width:100%;height:100%}</style><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`;
  await win.loadURL('data:text/html;base64,'+Buffer.from(html).toString('base64'));
  const sizes=[16,20,24,32,48,64,128,256],frames=[];
  const image=await win.webContents.capturePage({x:0,y:0,width:1024,height:1024});
  for(const size of [...sizes,1024]){
   const png=image.resize({width:size,height:size,quality:'best'}).toPNG();
   if(size===1024)await fs.writeFile(path.join(root,'withu-icon.png'),png);
   else frames.push({size,png});
  }
  const header=Buffer.alloc(6+16*frames.length);header.writeUInt16LE(1,2);header.writeUInt16LE(frames.length,4);
  let offset=header.length;
  frames.forEach(({size,png},i)=>{const pos=6+i*16;header[pos]=size===256?0:size;header[pos+1]=header[pos];header.writeUInt16LE(1,pos+4);header.writeUInt16LE(32,pos+6);header.writeUInt32LE(png.length,pos+8);header.writeUInt32LE(offset,pos+12);offset+=png.length;});
  await fs.writeFile(path.join(root,'withu-icon.ico'),Buffer.concat([header,...frames.map(f=>f.png)]));
  console.log('Built approved Withu logo PNG and ICO: '+sizes.join(', '));win.destroy();app.exit(0);
 }catch(error){console.error(error);win?.destroy();app.exit(1);}
});
