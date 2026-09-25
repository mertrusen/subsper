"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../../js/main.js"), "utf8");
const match = source.match(/^function switchTab\(name\) \{[\s\S]*?^\}/m);
assert.ok(match, "switchTab must exist");

const calls = [];
const context = {
    window: { ui2Open: key => calls.push(["open", key]) },
    switchMainTab: key => calls.push(["main", key]),
    switchSubTab: (key, sub) => calls.push(["sub", key, sub]),
};
vm.runInNewContext(match[0] + "\nswitchTab('setup');", context);
assert.deepEqual(calls, [["open", "settings"], ["sub", "setup", "install"]]);
console.log("error Setup action opens Settings → Installation");
