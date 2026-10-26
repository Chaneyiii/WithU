const assets=import.meta.glob('../assets/provider-logos/*.{svg,png}',{eager:true,query:'?url',import:'default'});
export default function ProviderLogo({icon}) {
 const name=icon==='longcat'?'longcat-color':icon;
 const src=assets[`../assets/provider-logos/${name}.svg`]||assets[`../assets/provider-logos/${name}.png`];
 return src?<img className="provider-logo" src={src} alt="" aria-hidden="true"/>:null;
}
