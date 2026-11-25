#!/usr/bin/env node
const path = require("path");
const { spawn } = require("child_process");

const server = path.join(__dirname, "..", "server.js");
const child = spawn("node", [server], {
  stdio: "inherit",
  env: process.env
});

child.on("exit", (code) => process.exit(code));
