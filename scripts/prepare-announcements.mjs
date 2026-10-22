import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function announcementSourceHash(root = repository) {
  const base = path.join(root, 'packages/announcements');
  const files = fs.readdirSync(path.join(base, 'src'), { recursive: true }).filter(name => !name.endsWith('release.ts') && fs.statSync(path.join(base, 'src', name)).isFile()).map(name => `src/${name}`).concat(['package.json','tsconfig.json','tsconfig.server.json']).sort();
  const hash = createHash('sha256');
  for (const name of files) hash.update(name).update('\0').update(fs.readFileSync(path.join(base, name))).update('\0');
  return hash.digest('hex');
}
export function prepareAnnouncements() {
  const base = path.join(repository, 'packages/announcements');
  const pkg = JSON.parse(fs.readFileSync(path.join(base,'package.json')));
  const release = { version: pkg.version, sourceHash: announcementSourceHash(), apiVersion: 1 };
  fs.writeFileSync(path.join(base,'src/release.ts'), `export const ANNOUNCEMENT_RELEASE = Object.freeze(${JSON.stringify(release)});\n`);
  for(const folder of ['dist','dist-cjs'])fs.rmSync(path.join(base,folder),{recursive:true,force:true});
  execFileSync(process.execPath, [path.join(repository,'node_modules/typescript/bin/tsc'), '-p', path.join(base,'tsconfig.json')], {stdio:'inherit'});
  execFileSync(process.execPath, [path.join(repository,'node_modules/typescript/bin/tsc'), '-p', path.join(base,'tsconfig.server.json')], {stdio:'inherit'});
  fs.writeFileSync(path.join(base,'dist-cjs/package.json'),JSON.stringify({type:'commonjs'})+'\n');
  fs.copyFileSync(path.join(base,'src/frontend/styles.css'), path.join(base,'dist/frontend/styles.css'));
  fs.mkdirSync(path.join(repository,'vendor'), {recursive:true});
  const npm = process.env.npm_execpath || '/usr/local/lib/node_modules/npm/bin/npm-cli.js';
  const result = JSON.parse(execFileSync(process.execPath,[npm,'pack','--json','--ignore-scripts','--cache',path.join(repository,'tmp/npm-cache'),'--pack-destination',path.join(repository,'vendor')],{cwd:base,encoding:'utf8'}));
  const packed = path.join(repository,'vendor',result[0].filename);
  const filename = `coco-announcements-${release.version}-${release.sourceHash.slice(0,12)}.tgz`;
  fs.renameSync(packed,path.join(repository,'vendor',filename));
  const integrity = 'sha512-'+createHash('sha512').update(fs.readFileSync(path.join(repository,'vendor',filename))).digest('base64');
  const distFiles={};
  for(const folder of ['dist','dist-cjs'])for(const name of fs.readdirSync(path.join(base,folder),{recursive:true})){const file=path.join(base,folder,name);if(fs.statSync(file).isFile())distFiles[`${folder}/${name}`]=createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
  const manifest = {...release,packageFile:`vendor/${filename}`,integrity,distFiles};
  fs.writeFileSync(path.join(repository,'packages/announcements/release.json'),JSON.stringify(manifest,null,2)+'\n');
  for(const prefix of ['','functions']){
    const p=path.join(repository,prefix,'package.json');const m=JSON.parse(fs.readFileSync(p));
    if(prefix){fs.mkdirSync(path.join(repository,prefix,'vendor'),{recursive:true});fs.copyFileSync(path.join(repository,'vendor',filename),path.join(repository,prefix,'vendor',filename));}
    m.dependencies['@coco/announcements']=`file:vendor/${filename}`;
    fs.writeFileSync(p,JSON.stringify(m,null,2)+'\n');
    execFileSync(process.execPath,[npm,'install','--offline','--ignore-scripts','--legacy-peer-deps','--no-audit','--no-fund','--cache',path.join(repository,'tmp/npm-cache')],{cwd:path.dirname(p),stdio:'inherit'});
  }
  fs.writeFileSync(path.join(repository,'public/announcement-release.json'),JSON.stringify(release)+'\n');
  fs.writeFileSync(path.join(repository,'coco/public/announcement-release.json'),JSON.stringify(release)+'\n');
  console.log(`Announcement package prepared: ${release.version} / ${release.sourceHash.slice(0,12)}`);
  return manifest;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))prepareAnnouncements();
