"use client";

// ponytail: unauthenticated API calls return a 401 object that pages then crash on (e.g.
// `.filter` of a non-array) — show the 404 + login button instead of the raw error.
// Fix properly (throw on !res.ok in the query fns) if this boundary hides real bugs.
export { default } from "../not-found";
