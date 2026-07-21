import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

const packageJson = JSON.parse(
  await readFile(resolve(import.meta.dirname, "..", "package.json"), "utf8")
)
const expectedTag = `v${packageJson.version}`
const actualTag = process.env.GITHUB_REF_NAME

assert.equal(
  actualTag,
  expectedTag,
  `release tag ${actualTag || "<missing>"} must match package version ${expectedTag}`
)

console.log(`Release tag ${actualTag} matches ${packageJson.name}@${packageJson.version}`)
