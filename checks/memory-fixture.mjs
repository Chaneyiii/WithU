import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

export async function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {windowsHide:true, stdio:['ignore','pipe','pipe']});
    let stdout='', stderr='';
    child.stdout.on('data', chunk => stdout+=chunk);
    child.stderr.on('data', chunk => stderr+=chunk);
    child.once('error', reject);
    child.once('exit', code => code===0 ? resolve(stdout) : reject(new Error(`${command} exited ${code}\n${stderr}`)));
  });
}
export const fixtureBinary=path.resolve('target/debug/examples/d3-memory-fixture'+(process.platform==='win32'?'.exe':''));
export const serverBinary=process.env.WITHU_SERVER_BINARY || path.resolve('target/debug/withu-server'+(process.platform==='win32'?'.exe':''));
export async function isolatedDirectory(label) {
  const output=path.resolve('output/d3',label);
  await mkdir(output,{recursive:true});
  const root=await mkdtemp(path.join(output,'run-'));
  await writeFile(path.join(root,'D3_TEST_FIXTURE'),'Synthetic D3 fixture only; no credentials or user data.\n');
  return root;
}
export async function buildFixture() {
  await run('cargo',['build','-p','withu-server','-p','withu-memory','--example','d3-memory-fixture']);
  // An explicit binary target keeps the owner/server test tied to the current source.
  await run('cargo',['build','-p','withu-server']);
}
export const seedFixture=root=>run(fixtureBinary,['--test-fixture',root]);
export const inspectFixture=async root=>JSON.parse(await run(fixtureBinary,['--test-fixture',root,'--inspect']));
