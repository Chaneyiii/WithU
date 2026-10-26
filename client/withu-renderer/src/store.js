import {desktopBridge} from "./desktop-bridge";
export const newId=()=>crypto.randomUUID();
export const initialView={schema_version:1,id:'client',voice:{enabled:false},theme:'light',themeColor:'avatar',language:'简体中文',active:{comfort:null,cowork:null},expanded:[],scroll:{comfort:0,cowork:0},overrides:{},sceneEdits:{},version:1};
export async function pickFiles(){if(!desktopBridge())throw new Error('Desktop bridge unavailable');return desktopBridge().pickFiles();}
export async function exportData(){return desktopBridge().exportData();}
export async function openExternal(url){return desktopBridge().openExternal(url);}
export const api=(method,payload={})=>{if(!desktopBridge()?.[method])return Promise.reject(new Error('Desktop bridge unavailable'));return desktopBridge()[method](payload);};
