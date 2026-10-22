import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { ANNOUNCEMENT_RELEASE, createAnnouncementService, type AnnouncementOperation } from '@coco/announcements/server';
import { requireWorkAuth } from './passwordChange.js';
import * as logger from 'firebase-functions/logger';

const key=defineSecret('OPENAI_API_KEY');
function endpoint(operation:AnnouncementOperation){
  const translation=['createPresidentInstruction','replacePresidentInstruction','retryPresidentInstructionTranslation'].includes(operation);
  return onCall({region:'asia-northeast1',invoker:'public',enforceAppCheck:process.env.FUNCTIONS_EMULATOR!=='true',...(translation?{secrets:[key],timeoutSeconds:120}:{})},request=>{
    const db=getFirestore();
    return createAnnouncementService({db,source:'gpt-kintai',trace:entry=>logger.info('Announcement stage',{...entry,release:ANNOUNCEMENT_RELEASE}),getApiKey:()=>key.value(),authorize:async(auth,tx)=>{
      const read=async(path:string)=>(await(tx?tx.get(db.doc(path)):db.doc(path).get())).data();
      const context=await requireWorkAuth(auth,uid=>read('users/'+uid));
      const settings=await read('cocoSettings/announcements');
      if(settings?.legacyWritesEnabled===false && operation!=='listAnnouncementRecipients')throw new HttpsError('failed-precondition','お知らせはCOCOから利用してください。');
      return context;
    }}).execute(operation,request.auth,request.data);
  });
}
export const createPresidentInstruction=endpoint('createPresidentInstruction');
export const replacePresidentInstruction=endpoint('replacePresidentInstruction');
export const acknowledgePresidentInstruction=endpoint('acknowledgePresidentInstruction');
export const completePresidentInstruction=endpoint('completePresidentInstruction');
export const cancelPresidentInstruction=endpoint('cancelPresidentInstruction');
export const replyToPresidentInstruction=endpoint('replyToPresidentInstruction');
export const remindPresidentInstruction=endpoint('remindPresidentInstruction');
export const retryPresidentInstructionTranslation=endpoint('retryPresidentInstructionTranslation');
export const listAnnouncementRecipients=endpoint('listAnnouncementRecipients');
