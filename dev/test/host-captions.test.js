// The Premiere API is unavailable in CI. This checks our import contract at
// the host boundary: a verified new track, zero-second offset, no old deletion.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../../extension/jsx/host.jsx'), 'utf8');
function run(createResult) {
  function collection(items) {
    Object.defineProperty(items, 'numItems', { get() { return this.length; } });
    return items;
  }
  const old = { name: 'Existing styled captions', nodeId: 'old' };
  const root = { children: collection([old]), createBin(name) {
    const bin = { name, nodeId: 'bin-new', children: collection([]) };
    this.children.push(bin);
    return bin;
  }};
  const calls = [];
  const seq = { createCaptionTrack(item, start) { calls.push({ item, start }); return createResult; } };
  function File(filename) {
    this.fsName = filename;
    this.exists = true;
    this.parent = { exists: true, fsName: '/tmp' };
    this.open = () => true;
    this.close = () => {};
    this.write = () => {};
  }
  const context = vm.createContext({
    File,
    app: { project: { path: '/tmp/subsper-test.prproj', activeSequence: seq, rootItem: root,
      importFiles(files, suppress, target) {
        target.children.push({ name: files[0].split('/').pop(), nodeId: 'new-srt' });
        return true;
      } } },
    $: { getenv: () => '/tmp' },
    Date, JSON,
  });
  vm.runInContext(source, context, { filename: 'host.jsx' });
  const result = JSON.parse(context.importSRTToProject('1\n00:00:00,000 --> 00:00:01,000\nTest\n'));
  assert.strictEqual(root.children[0], old, 'existing caption asset stays untouched');
  assert.strictEqual(calls.length, 1, 'only caption-track API is attempted');
  assert.strictEqual(calls[0].start, 0, 'SRT starts at zero seconds');
  return result;
}
assert.strictEqual(run(true).autoAdded, true, 'confirmed new caption track is reported');
assert.strictEqual(run(undefined).autoAdded, false, 'undefined API response is not a success');
assert.strictEqual(run(false).autoAdded, false, 'rejected placement leaves SRT for manual import');
console.log('3 Premiere caption import contracts passed');
