export async function reserveAccount(db:any,participantId:string,tokens:number){
 if(!Number.isSafeInteger(tokens)||tokens<=0)throw new Error('Invalid reservation bound');
 const result=await db.query('UPDATE token_accounts SET reserved=reserved+$2 WHERE participant_id=$1 AND state=\'OPEN\' AND reserved=0 AND consumed+reserved+$2<=allowance RETURNING *',[participantId,tokens]);
 return result.rows[0]||null;
}
