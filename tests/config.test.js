import test from "node:test";
import assert from "node:assert/strict";
import { parseEnvFile } from "../server/config.js";

test("parseEnvFile strips inline comments from unquoted values", () => {
  const env = parseEnvFile(`
    PORT=3000 # service port
    HOST="127.0.0.1" # local host
    TOKEN=value#not-comment
    SECRET=abc	# comment with tab
    FOO='bar # kept inside quotes' # trailing comment
  `);

  assert.equal(env.PORT, "3000");
  assert.equal(env.HOST, "127.0.0.1");
  assert.equal(env.TOKEN, "value#not-comment");
  assert.equal(env.SECRET, "abc");
  assert.equal(env.FOO, "bar # kept inside quotes");
});
