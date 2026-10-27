const { reviewApp } = await import("./agents/verify.mjs");
const res = await reviewApp("docs");
console.log(JSON.stringify(res, null, 1));
