import {AnnouncementProvider,InstructionAttachmentLink as Shared,type AnnouncementsApi} from '@coco/announcements';
import type {ComponentProps} from 'react';
import * as api from '../services/api';
export function InstructionAttachmentLink(props:ComponentProps<typeof Shared>){return <AnnouncementProvider value={{profile:null,locale:props.locale==='zh-CN'?'zh-CN':'ja',api}}><Shared {...props}/></AnnouncementProvider>;}
