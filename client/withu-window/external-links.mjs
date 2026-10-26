export const approvedExternalDomains=Object.freeze(['support.claude.com','github.com','developers.openai.com']);
export function validateExternalUrl(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!approvedExternalDomains.includes(u.hostname))throw new Error('外部链接已阻断：域名未批准');return u.href;}
