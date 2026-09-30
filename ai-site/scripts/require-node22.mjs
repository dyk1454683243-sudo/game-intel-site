/**
 * Wrangler 4 and the export scripts require Node >= 22.
 * Importing this module exits when the running Node is older.
 */
export function nodeSatisfiesPublish(version = process.versions.node) {
  const major = Number.parseInt(String(version).replace(/^v/, ""), 10);
  return Number.isFinite(major) && major >= 22;
}

if (!nodeSatisfiesPublish()) {
  console.error(
    `ERROR: Node ${process.version} is too old. Use Node >=22 (Wrangler 4 and export scripts).`
  );
  process.exit(1);
}
