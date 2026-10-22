import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
vi.mock('../auth',()=>({useAuth:()=>({profile:{uid:'fixture'}})}));
vi.mock('../i18n',()=>({useI18n:()=>({locale:'ja'})}));
vi.mock('../services/api',()=>({}));
vi.mock('./BusinessFeatureEntry',()=>({BusinessLinkText:({text}:{text:string})=>text}));
import {InstructionCenter,InstructionShortcut} from './PresidentInstructions';
afterEach(()=>{cleanup();vi.unstubAllEnvs();});
describe('legacy announcement retirement',()=>{
 it('provides the COCO destination instead of editable notices after the accepted cutover',()=>{
  vi.stubEnv('VITE_ANNOUNCEMENTS_LEGACY_RETIRED','true');render(<InstructionCenter open instructions={[]} users={[]} onClose={vi.fn()} notify={vi.fn()}/>);expect(screen.getByRole('link',{name:'COCOのお知らせを開く'})).toHaveAttribute('href','https://coco.cbc-azabudai.com/#/announcements');expect(screen.queryByRole('button',{name:'投稿'})).not.toBeInTheDocument();
 });
 it('hides the old shortcut and a closed announcement dialog',()=>{
  vi.stubEnv('VITE_ANNOUNCEMENTS_LEGACY_RETIRED','true');const {container}=render(<><InstructionShortcut instructions={[]} onOpen={vi.fn()}/><InstructionCenter open={false} instructions={[]} users={[]} onClose={vi.fn()} notify={vi.fn()}/></>);expect(container).toBeEmptyDOMElement();
 });
});
