export const ORB_LABELS=Object.freeze({idle:'平静',wink:'问候',happy:'开心',sleepy:'困倦',music:'唱歌',curious:'好奇',angry:'生气',sad:'委屈',waiting:'思考',listening:'倾听',speaking:'回应'});
export const ORB_STATES=Object.freeze(Object.keys(ORB_LABELS));
export const MOOD_TO_ORB=Object.freeze({idle:'idle',happy:'happy',confused:'curious',thinking:'waiting',listening:'listening',speaking:'speaking',error:'sad',sleep:'sleepy',singing:'music',normal:'idle'});
// Operational cues take priority during a call. They do not diagnose user emotion.
export const PRESENCE_TO_ORB=Object.freeze({idle:'idle',listening:'listening',thinking:'waiting',speaking:'speaking',interrupted:'waiting',reconnecting:'waiting',degraded:'sad',ended:'happy'});
export function resolveOrbState(mood,presence){return presence&&presence!=='idle'?PRESENCE_TO_ORB[presence]||'sad':MOOD_TO_ORB[mood]||(ORB_STATES.includes(mood)?mood:'idle');}
