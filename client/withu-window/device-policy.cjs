function trustedGuiUrl(url,entry,dev) {
 try {const parsed=new URL(url);if(dev){const allowed=new URL(dev);return parsed.origin===allowed.origin&&parsed.pathname===allowed.pathname;}return parsed.protocol==='file:'&&decodeURIComponent(parsed.pathname).replace(/^\//,'').replaceAll('/','\\').toLowerCase()===entry.toLowerCase();}catch{return false;}
}
function permitsAudio({trusted,visible,armed,permission,isMainFrame,mediaTypes,mediaType}) {
 return Boolean(trusted&&visible&&armed&&permission==='media'&&isMainFrame===true&&(mediaTypes?mediaTypes.length===1&&mediaTypes[0]==='audio':mediaType==='audio'));
}
module.exports={trustedGuiUrl,permitsAudio};
