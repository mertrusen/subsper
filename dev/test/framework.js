// Tiny assertion framework. Deliberately dependency-free and written in plain
// ES5-compatible syntax so the same bundle runs under Node (CI) and under
// macOS JavaScriptCore via osascript (a dev machine with no Node installed).

var _pass = 0, _fail = 0, _group = "";
var _failures = [];

function group(name) { _group = name; console.log("\n— " + name + " —"); }

function ok(name, cond) {
    if (cond) { _pass++; console.log("  ok   " + name); }
    else {
        _fail++; _failures.push(_group + " › " + name);
        console.log("  FAIL " + name);
    }
}

function eq(name, got, want) {
    var g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { _pass++; console.log("  ok   " + name); return; }
    _fail++;
    _failures.push(_group + " › " + name);
    console.log("  FAIL " + name);
    console.log("        got  " + g);
    console.log("        want " + w);
}

function near(name, got, want, tol) {
    var d = Math.abs(got - want);
    if (d <= (tol || 0.0005)) { _pass++; console.log("  ok   " + name); return; }
    _fail++;
    _failures.push(_group + " › " + name);
    console.log("  FAIL " + name + "  got " + got + ", want ~" + want);
}

function throws(name, fn) {
    try { fn(); } catch (e) { _pass++; console.log("  ok   " + name); return; }
    _fail++; _failures.push(_group + " › " + name);
    console.log("  FAIL " + name + " (expected a throw, got none)");
}

function reportAndExit() {
    console.log("\n" + _pass + " passed, " + _fail + " failed");
    if (_fail) {
        console.log("\nfailing:");
        for (var i = 0; i < _failures.length; i++) console.log("  · " + _failures[i]);
    }
    // Node gets a real exit code so CI fails; JSC just prints.
    if (typeof process !== "undefined" && process.exit) process.exit(_fail ? 1 : 0);
}
