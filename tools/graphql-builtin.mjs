#!/usr/bin/env node
// Prints the GRAPHQL_BUILTIN_KEYS and GRAPHQL_BUILTIN constants of src/interception.js from a
// registry table the extension saved, so the built-in copy of x.com's query ids and feature keys
// can be refreshed in one step:
//   1. in a logged-in TweetDeck tab, run  copy(localStorage.OTDgraphqlOperations)  in the console
//   2. save the clipboard to a file, e.g. table.json
//   3. node tools/graphql-builtin.mjs table.json  >  paste over the two constants
// Operations with the same feature keys share one named list; the names come from the first
// operation (in the file's order) that uses each list.
import fs from "node:fs";

const ORDER = [
    "HomeLatestTimeline", "NotificationsTimeline", "CreateTweet", "CreateRetweet", "DeleteRetweet",
    "DeleteTweet", "FavoriteTweet", "UnfavoriteTweet", "TweetDetail", "SearchTimeline", "Likes",
    "UserTweetsAndReplies", "UserByRestId", "UserByScreenName", "UsersByRestIds",
    "ListLatestTweetsTimeline", "ListMembers", "ListAddMember", "ListRemoveMember", "Bookmarks",
    "CombinedLists", "BlockedAccountsAll", "MutedAccounts", "ConversationControlChange",
];

const file = process.argv[2];
if (!file) {
    console.error("usage: node tools/graphql-builtin.mjs <saved OTDgraphqlOperations as JSON>");
    process.exit(2);
}
const table = JSON.parse(fs.readFileSync(file, "utf8"));
if (!table || typeof table.main !== "string" || !table.ops || !table.values) {
    console.error("not a registry table: expected { main, ops, values }");
    process.exit(2);
}
const CDN = "https://abs.twimg.com/responsive-web/client-web/";
const main = /^https?:/.test(table.main) ? table.main : CDN + table.main; // the registry compares the full URL
const names = [...ORDER.filter((op) => table.ops[op]), ...Object.keys(table.ops).filter((op) => !ORDER.includes(op)).sort()];
const lists = new Map(); // JSON of the keys -> list name
const lines = ["const GRAPHQL_BUILTIN_KEYS = {"];
for (const op of names) {
    const keys = table.ops[op].features || [];
    if (!keys.length) continue;
    const json = JSON.stringify(keys);
    if (lists.has(json)) continue;
    const name = op[0].toLowerCase() + op.slice(1);
    lists.set(json, name);
    lines.push(`    ${name}: ${json},`);
}
lines.push("};");
const date = table.fetchedAt ? new Date(table.fetchedAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
lines.push("const GRAPHQL_BUILTIN = {");
lines.push(`    date: ${JSON.stringify(date)},`);
lines.push(`    main: ${JSON.stringify(main)},`);
lines.push("    ops: {");
for (const op of names) {
    const { id, features = [], chunk } = table.ops[op];
    const list = features.length ? JSON.stringify(lists.get(JSON.stringify(features))) : "[]";
    lines.push(`        ${op}: { id: ${JSON.stringify(id)}, features: ${list}, chunk: ${JSON.stringify(chunk ?? "main")} },`);
}
lines.push("    },");
const used = new Set();
for (const op of names) for (const key of table.ops[op].features || []) used.add(key);
// a key the page's config does not list is sent as false (graphqlFeaturesFor), so it is false here too
const values = Object.fromEntries([...used].sort().map((k) => [k, table.values[k] === true]));
lines.push(`    values: ${JSON.stringify(values)},`);
lines.push("};");
process.stdout.write(lines.join("\n") + "\n");
