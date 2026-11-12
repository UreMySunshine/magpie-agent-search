// Credential selection is explicit; an incomplete pair never falls back to Bearer.
export function yuanbaoCredentialMode(e={}){
 const id=typeof e.secretId==='string'?e.secretId.trim():'';
 const secret=typeof e.secretKey==='string'?e.secretKey.trim():'';
 if(Boolean(id)!==Boolean(secret))return 'incomplete';
 if(id&&secret)return 'tc3';
 return typeof e.key==='string'&&e.key.trim()?'bearer':'missing';
}
