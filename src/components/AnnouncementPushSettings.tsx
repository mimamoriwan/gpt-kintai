import { AnnouncementProvider, AnnouncementPushSettings as Shared, type AnnouncementsApi } from '@coco/announcements';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import * as api from '../services/api';
import * as push from '../services/announcementPush';
import {getPushState} from '../lib/pushStorage';

export function AnnouncementPushSettings(){
  const {profile}=useAuth(),{locale}=useI18n();
  return <AnnouncementProvider value={{profile,locale,api,push:{...push,getPushState}}}><Shared/></AnnouncementProvider>;
}
