import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { announcementSourceHash } from './prepare-announcements.mjs';

export function checkAnnouncements(host=process.cwd(),canonical){
  const config=path.join(host,'announcement-host.json');
  canonical=canonical|| (fs.existsSync(config)?path.resolve(host,JSON.parse(fs.readFileSync(config)).canonicalRoot):host);
  const manifest=JSON.parse(fs.readFileSync(path.join(canonical,'packages/announcements/release.json')));
  if(announcementSourceHash(canonical)!==manifest.sourceHash)throw Error('共通ソースが固定パッケージと一致しません。announcements:syncを実行してください。');
  const archive=fs.readFileSync(path.join(canonical,manifest.packageFile));
  if('sha512-'+createHash('sha512').update(archive).digest('base64')!==manifest.integrity)throw Error('共通パッケージの内容が固定記録と一致しません。');
  for(const prefix of ['','functions']){
    const base=path.join(host,prefix),pkg=JSON.parse(fs.readFileSync(path.join(base,'package.json'))),lock=JSON.parse(fs.readFileSync(path.join(base,'package-lock.json')));
    const expected=`file:${manifest.packageFile}`;
    if(pkg.dependencies['@coco/announcements']!==expected||lock.packages[''].dependencies['@coco/announcements']!==expected)throw Error('両プロジェクトで共通パッケージの版を揃えてください。');
    if(lock.packages['node_modules/@coco/announcements']?.integrity!==manifest.integrity)throw Error('依存関係の固定ハッシュが一致しません。');
    for(const [file,digest] of Object.entries(manifest.distFiles)){
      const actual=path.join(base,'node_modules/@coco/announcements',file);
      if(!fs.existsSync(actual)||createHash('sha256').update(fs.readFileSync(actual)).digest('hex')!==digest)throw Error(`インストール済み共通部品が一致しません: ${prefix||'frontend'}/${file}`);
    }
  }
  for(const name of ['PresidentInstructions','InstructionChat','InstructionReminder','InstructionAttachmentLink']){
    const content=fs.readFileSync(path.join(host,`src/components/${name}.tsx`),'utf8');
    if(!content.includes('@coco/announcements')||content.split('\n').length>30)throw Error(`共通画面の接続部分に独立した実装があります: ${name}`);
  }
  const server=fs.readFileSync(path.join(host,'functions/src/index.ts'),'utf8');
  if(server.includes('const instructionInputSchema =')||server.includes('export const createPresidentInstruction ='))throw Error('旧お知らせ実装が残っています。共通APIへの接続を確認してください。');
  for(const name of fs.readdirSync(path.join(canonical,'packages/announcements/src'),{recursive:true})){
    const file=path.join(canonical,'packages/announcements/src',name);if(!fs.statSync(file).isFile()||!name.endsWith('.ts')&&!name.endsWith('.tsx'))continue;
    const source=fs.readFileSync(file,'utf8');
    if(/(?:from|import\()\s*['"]\.\.?\/[^'"]*(?:\/auth(?:\.|['"])|\/coco\/|\/src\/|BusinessFeatureEntry)/.test(source)||source.includes('import.meta.env'))throw Error(`共通部品にホスト固有の依存があります: ${name}`);
  }
  return {version:manifest.version,sourceHash:manifest.sourceHash,apiVersion:manifest.apiVersion};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const release=checkAnnouncements(path.resolve(process.argv[2]||process.cwd()));console.log(`Announcement consistency verified: ${release.sourceHash.slice(0,12)}`);
}
