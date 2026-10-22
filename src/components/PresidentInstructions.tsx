import * as Shared from '@coco/announcements';
import {withAnnouncementHost} from './AnnouncementHost';
export const InstructionCenter=withAnnouncementHost(Shared.InstructionCenter,true);
export const InstructionHomePanel=withAnnouncementHost(Shared.InstructionHomePanel,true);
export const InstructionBanner=withAnnouncementHost(Shared.InstructionBanner);
export const InstructionShortcut=withAnnouncementHost(Shared.InstructionShortcut);
export {sortPresidentInstructions,pendingInstructionSummary} from '@coco/announcements';
