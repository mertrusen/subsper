"use strict";
const assert = require("node:assert/strict");
const Ajv = require("ajv");
const schema = require("app-builder-lib/scheme.json");
const config = require("../../package.json").build;

const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
assert.ok(validate(config), JSON.stringify(validate.errors, null, 2));
console.log("electron-builder configuration passed schema validation");
