import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

export function archive(file, kind, entries) {
  const script = `
import sys,json,zipfile,tarfile,io,gzip
data=json.load(sys.stdin)
if data["kind"]=="zip":
 with zipfile.ZipFile(data["file"],"w",compression=zipfile.ZIP_DEFLATED) as a:
  for name,content in data["entries"]: a.writestr(name,content)
else:
 with tarfile.open(data["file"],"w" if data["kind"]=="gem" else "w:gz") as a:
  for name,content in data["entries"]:
   raw=gzip.compress(content.encode()) if data["kind"]=="gem" and name=="metadata.gz" else content.encode()
   entry=tarfile.TarInfo(name); entry.size=len(raw); a.addfile(entry,io.BytesIO(raw))
  if data["kind"]=="gem":
   contents=io.BytesIO()
   with tarfile.open(fileobj=contents,mode="w:gz"): pass
   raw=contents.getvalue()
   entry=tarfile.TarInfo("data.tar.gz"); entry.size=len(raw); a.addfile(entry,io.BytesIO(raw))
`;
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-I', '-c', script], {
    encoding: 'utf8', input: JSON.stringify({ file, kind, entries }), timeout: 30000
  });
  if (result.status !== 0) throw new Error(result.stderr || 'Could not create package fixture.');
}

export function artifactManifest(directory, ecosystem, version, names) {
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({
    ecosystem, version, files: names.map((name) => ({ name,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex') }))
  }));
}
