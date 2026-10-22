import { getApp } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { createAnnouncementPushClient } from '@coco/announcements/push';
import { auth, functions, prepareCallableSecurityContext, preparePublicCallableSecurityContext } from '../firebase';
import { invokeWithVerifiedSecurityContext } from '../lib/callable';
import * as pushStore from '../lib/pushStorage';

const client=createAnnouncementPushClient({app:getApp(),auth,get vapidKey(){return import.meta.env.VITE_FIREBASE_VAPID_KEY||'';},emulators:import.meta.env.VITE_USE_FIREBASE_EMULATORS==='true',store:pushStore,messaging:()=>import('firebase/messaging'),
  call:async<T>(name:string,data:unknown):Promise<T>=>{const call=httpsCallable<unknown,T>(functions,name);return (await invokeWithVerifiedSecurityContext(prepareCallableSecurityContext,()=>call(data))).data;},
  revoke:async(data)=>{const call=httpsCallable(functions,'unregisterAnnouncementPushDevice',{timeout:10000});return invokeWithVerifiedSecurityContext(preparePublicCallableSecurityContext,()=>call(data));}
});
export const {getPushEnvironment,flushPushRevocations,disableAnnouncementPush,enableAnnouncementPush,sendAnnouncementPushTest,startAnnouncementPushSession,pushSettingsChanged}=client;
