import type { ComponentType, ComponentProps } from 'react';
import { AnnouncementProvider, AnnouncementTransferNotice, type AnnouncementsApi } from '@coco/announcements';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import * as api from '../services/api';
import { BusinessLinkText } from './BusinessFeatureEntry';

/** The host supplies identity/transport; all announcement behaviour lives in the package. */
export function withAnnouncementHost<C extends ComponentType<any>>(Component:C,showTransfer=false) {
  return function AnnouncementHost(props:ComponentProps<C>) {
    const {profile}=useAuth(),{locale}=useI18n();
    if(import.meta.env.VITE_ANNOUNCEMENTS_LEGACY_RETIRED==='true')return showTransfer&&props.open!==false?<AnnouncementTransferNotice locale={locale} href="https://coco.cbc-azabudai.com/#/announcements"/>:null;
    return <AnnouncementProvider value={{profile,locale,api,LinkText:BusinessLinkText}}><Component {...props} /></AnnouncementProvider>;
  };
}
